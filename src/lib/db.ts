import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Argument, Assessment, Debate, Stance } from './types';
import { AppError, type Command } from './validation';
import { summaryRevision } from './stance-summary';

export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS debates (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stances (id TEXT PRIMARY KEY, debateId TEXT NOT NULL REFERENCES debates(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL, summary TEXT, summaryKey TEXT);
    CREATE TABLE IF NOT EXISTS arguments (id TEXT PRIMARY KEY, stanceId TEXT NOT NULL REFERENCES stances(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL, assessment TEXT, model TEXT, scoredAt TEXT, error TEXT, scoringStarted INTEGER, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  ensureSummaryColumns(db);
  ensureSharingColumns(db);
  return db;
}
function ensureSummaryColumns(db: DatabaseSync) {
  const stanceColumns = new Set((db.prepare('PRAGMA table_info(stances)').all() as { name: string }[]).map(column => column.name));
  if (!stanceColumns.has('summary')) db.exec('ALTER TABLE stances ADD COLUMN summary TEXT');
  if (!stanceColumns.has('summaryKey')) db.exec('ALTER TABLE stances ADD COLUMN summaryKey TEXT');
}
function ensureSharingColumns(db: DatabaseSync) {
  const columns = new Set((db.prepare('PRAGMA table_info(debates)').all() as { name: string }[]).map(column => column.name));
  if (!columns.has('ownerToken')) db.exec('ALTER TABLE debates ADD COLUMN ownerToken TEXT');
  if (!columns.has('publishedAt')) db.exec('ALTER TABLE debates ADD COLUMN publishedAt TEXT');
}
const globalDb = globalThis as unknown as { debateDb?: DatabaseSync; summaryMigrationDone?: boolean };
export function database() {
  if (!globalDb.debateDb) {
    globalDb.debateDb = openDatabase(process.env.DEBATE_DB_PATH || path.join(process.cwd(), 'data', 'debates.sqlite'));
  }
  if (!globalDb.summaryMigrationDone) { ensureSummaryColumns(globalDb.debateDb); ensureSharingColumns(globalDb.debateDb); globalDb.summaryMigrationDone = true; }
  return globalDb.debateDb;
}
function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function readDebates(db = database()): Debate[] {
  const debates = db.prepare('SELECT id, title, description, createdAt, publishedAt FROM debates ORDER BY createdAt DESC, rowid DESC').all() as unknown as Omit<Debate, 'stances'>[];
  const stances = db.prepare('SELECT * FROM stances ORDER BY rowid').all() as unknown as Omit<Stance, 'arguments'>[];
  const args = db.prepare('SELECT * FROM arguments ORDER BY createdAt, rowid').all().map(row => ({ ...row, sources: JSON.parse(row.sources as string), assessment: row.assessment ? JSON.parse(row.assessment as string) : null })) as Argument[];
  return debates.map(d => ({ ...d, stances: stances.filter(s => s.debateId === d.id).map(s => {
    const stance = { ...s, arguments: args.filter(a => a.stanceId === s.id) };
    const revision = summaryRevision(d, stance);
    return { ...stance, summaryRevision: revision, summaryFresh: Boolean(stance.summary && revision && stance.summaryKey === revision) };
  }) }));
}
export const sharingEnabled = () => process.env.PUBLIC_SHARING === '1';
export function readVisibleDebates(ownerToken: string, db = database()): Debate[] {
  const visibleIds = new Set((db.prepare('SELECT id FROM debates WHERE publishedAt IS NOT NULL OR ownerToken = ? ORDER BY createdAt DESC').all(ownerToken) as { id: string }[]).map(row => row.id));
  return readDebates(db).filter(debate => visibleIds.has(debate.id));
}
export function purgeExpiredDrafts(db = database()) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM debates WHERE ownerToken IS NOT NULL AND publishedAt IS NULL AND createdAt < ?').run(cutoff);
}
export function assertReadable(entity: 'debate' | 'stance' | 'argument', id: string, ownerToken: string, db = database()) {
  const relation = entity === 'debate' ? 'debates d WHERE d.id = ?' : entity === 'stance' ? 'stances s JOIN debates d ON d.id = s.debateId WHERE s.id = ?' : 'arguments a JOIN stances s ON s.id = a.stanceId JOIN debates d ON d.id = s.debateId WHERE a.id = ?';
  const row = db.prepare(`SELECT d.ownerToken, d.publishedAt FROM ${relation}`).get(id) as { ownerToken: string | null; publishedAt: string | null } | undefined;
  if (!row || (row.ownerToken !== ownerToken && !row.publishedAt)) throw new AppError('This debate is not available.', 404);
  return row;
}
export function assertEditable(entity: 'debate' | 'stance' | 'argument', id: string, ownerToken: string, db = database()) {
  const row = assertReadable(entity, id, ownerToken, db);
  if (row.ownerToken !== ownerToken || row.publishedAt) throw new AppError('Published debates are read-only.', 403);
}
function requireRow(db: DatabaseSync, table: string, id: string) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new AppError('This item no longer exists. Refresh and try again.', 404);
  return row;
}
export function mutate(command: Command, db = database(), ownerToken?: string): string {
  return transaction(db, () => {
    const id = 'id' in command ? command.id : randomUUID();
    const now = new Date().toISOString();
    if (ownerToken) {
      if (command.action === 'createStance') assertEditable('debate', command.debateId, ownerToken, db);
      else if (command.action === 'createArgument') assertEditable('stance', command.stanceId, ownerToken, db);
      else if (command.action !== 'createDebate') assertEditable(command.action === 'delete' ? command.entity : command.action === 'updateStance' ? 'stance' : command.action === 'updateArgument' ? 'argument' : 'debate', id, ownerToken, db);
    }
    switch (command.action) {
      case 'createDebate': db.prepare('INSERT INTO debates (id, title, description, createdAt, ownerToken) VALUES (?, ?, ?, ?, ?)').run(id, command.title, command.description, now, ownerToken ?? null); break;
      case 'createStance': requireRow(db, 'debates', command.debateId); db.prepare('INSERT INTO stances (id, debateId, title, description) VALUES (?, ?, ?, ?)').run(id, command.debateId, command.title, command.description); break;
      case 'createArgument': requireRow(db, 'stances', command.stanceId); db.prepare('INSERT INTO arguments (id, stanceId, title, body, sources, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(id, command.stanceId, command.title, command.body, JSON.stringify(command.sources), now); break;
      case 'updateArgument':
        requireRow(db, 'arguments', id);
        db.prepare('UPDATE arguments SET title=?, body=?, sources=?, assessment=NULL, model=NULL, scoredAt=NULL, error=NULL, scoringStarted=NULL WHERE id=?').run(command.title, command.body, JSON.stringify(command.sources), id); break;
      case 'updateDebate':
        requireRow(db, 'debates', id);
        db.prepare('UPDATE debates SET title=?, description=? WHERE id=?').run(command.title, command.description, id);
        db.prepare('UPDATE arguments SET assessment=NULL, model=NULL, scoredAt=NULL, error=NULL, scoringStarted=NULL WHERE stanceId IN (SELECT id FROM stances WHERE debateId=?)').run(id); break;
      case 'updateStance':
        requireRow(db, 'stances', id);
        db.prepare('UPDATE stances SET title=?, description=? WHERE id=?').run(command.title, command.description, id);
        db.prepare('UPDATE arguments SET assessment=NULL, model=NULL, scoredAt=NULL, error=NULL, scoringStarted=NULL WHERE stanceId=?').run(id); break;
      case 'publish': db.prepare('UPDATE debates SET publishedAt=? WHERE id=? AND publishedAt IS NULL').run(now, id); break;
      case 'delete': {
        const table = { debate: 'debates', stance: 'stances', argument: 'arguments' }[command.entity];
        requireRow(db, table, id); db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); break;
      }
    }
    return id;
  });
}
export function getScoringContext(id: string, db = database()) {
  for (const debate of readDebates(db)) for (const stance of debate.stances) {
    const argument = stance.arguments.find(a => a.id === id);
    if (argument) return { debate: { title: debate.title, description: debate.description }, stance: { title: stance.title, description: stance.description }, argument };
  }
  throw new AppError('Argument not found.', 404);
}
export function claimScore(id: string, db = database()) {
  const token = Date.now();
  const result = db.prepare('UPDATE arguments SET scoringStarted=?, error=NULL WHERE id=? AND (scoringStarted IS NULL OR scoringStarted < ?)').run(token, id, token - 120000);
  if (!result.changes) throw new AppError('This argument is already being scored. Please wait a moment.', 409);
  return token;
}
export function finishScore(id: string, token: number, result: Assessment, model: string, db = database()) {
  const updated = db.prepare('UPDATE arguments SET assessment=?, model=?, scoredAt=?, error=NULL, scoringStarted=NULL WHERE id=? AND scoringStarted=?').run(JSON.stringify(result), model, new Date().toISOString(), id, token);
  if (!updated.changes) throw new AppError('This argument or its context changed during scoring. Score the updated version again.', 409);
}
export function failScore(id: string, token: number, message: string, db = database()) {
  db.prepare('UPDATE arguments SET error=?, scoringStarted=NULL WHERE id=? AND scoringStarted=?').run(message, id, token);
}

export function getStanceSummaryContext(id: string, db = database()) {
  for (const debate of readDebates(db)) {
    const stance = debate.stances.find(item => item.id === id);
    if (stance) return { debate, stance, revision: stance.summaryRevision };
  }
  throw new AppError('Stance not found.', 404);
}

export function saveStanceSummary(id: string, revision: string, summary: string, db = database()): boolean {
  const current = getStanceSummaryContext(id, db);
  if (current.revision !== revision) return false;
  db.prepare('UPDATE stances SET summary=?, summaryKey=? WHERE id=?').run(summary, revision, id);
  return true;
}
