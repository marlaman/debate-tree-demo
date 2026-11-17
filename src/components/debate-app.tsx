'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, Check, CircleHelp, GitBranch, LoaderCircle, Menu, Plus, RotateCw, Settings2, X } from 'lucide-react';
import { asDebateQuestion, type Argument, type Debate, type Stance, type Workspace } from '@/lib/types';
import type { Draft } from '@/lib/compose';
import type { Suggestion } from '@/lib/autofill';
import { debateOutcome } from '@/lib/outcome';
import { pickDebateIdeas } from '@/lib/debate-ideas';
import { runAutoMode } from '@/lib/auto-mode';
import { DebateGraph } from './debate-graph';
import { Dialog, EditorModal, type ModalState } from './dialogs';
import { NodeInspector, type FillProgress } from './node-inspector';

type PromptTarget = { kind: 'debate'; item?: Debate } | { kind: 'stance'; debateId: string; item?: Stance } | { kind: 'argument'; stanceId: string; item?: Argument };
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}
function initialWords(target: PromptTarget) {
  if (!target.item) return '';
  return target.kind === 'argument' ? `${target.item.title}. ${target.item.body}` : `${target.item.title}${target.item.description ? `. ${target.item.description}` : ''}`;
}
function suggestedSources(text: string) {
  const matches = text.match(/https?:\/\/[^\s<>"']+/g) || [];
  return [...new Set(matches.map(url => url.replace(/[.,;!?)]*$/, '')))].slice(0, 5).map(url => ({ url, excerpt: '' }));
}

export function DebateApp() {
  const [workspace, setWorkspace] = useState<Workspace>({ debates: [], scoringConfigured: false });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [publishPrompt, setPublishPrompt] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [scoring, setScoring] = useState<Set<string>>(new Set());
  const [filling, setFilling] = useState<FillProgress | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [autoBuildingId, setAutoBuildingId] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [target, setTarget] = useState<PromptTarget>({ kind: 'debate' });
  const [words, setWords] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [composerError, setComposerError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const summaryAttempts = useRef(new Set<string>());
  const active = workspace.debates.find(debate => debate.id === activeId);
  const stance = active?.stances.find(item => item.id === selectedId);
  const argument = active?.stances.flatMap(item => item.arguments).find(item => item.id === selectedId);
  const selected = active?.id === selectedId ? active : stance || argument;
  const selectedKind = active?.id === selectedId ? 'debate' : stance ? 'stance' : 'argument';
  const refresh = useCallback(async () => { const data = await api<Workspace>('/api/workspace'); setWorkspace(data); }, []);
  useEffect(() => { let live = true; api<Workspace>('/api/workspace').then(data => { if (live) setWorkspace(data); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, []);
  useEffect(() => { setIdeas(pickDebateIdeas()); }, []);
  useEffect(() => {
    if (!active || !workspace.scoringConfigured || autoBuildingId === active.id) return;
    const stale = active.stances.filter(stance => stance.summaryRevision && !stance.summaryFresh && !summaryAttempts.current.has(`${stance.id}:${stance.summaryRevision}`));
    if (!stale.length) return;
    for (const stance of stale) summaryAttempts.current.add(`${stance.id}:${stance.summaryRevision}`);
    void Promise.allSettled(stale.map(stance => api(`/api/stances/${stance.id}/summary`, {}))).then(async results => {
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') setError(failed.reason instanceof Error ? failed.reason.message : 'Could not summarize the stance.');
      await refresh().catch(() => {});
    });
  }, [active, workspace.scoringConfigured, autoBuildingId, refresh]);

  function choose(next: PromptTarget, keepWords = false) {
    setTarget(next); setDraft(null); setComposerError(''); setWords(keepWords ? initialWords(next) : ''); setComposerOpen(true);
    setSelectedId(next.item?.id || (next.kind === 'stance' ? next.debateId : next.kind === 'argument' ? next.stanceId : null));
    window.setTimeout(() => inputRef.current?.focus(), 20);
  }
  function openDebate(debate: Debate) {
    setActiveId(debate.id); setSidebarOpen(false); setSelectedId(null); setComposerOpen(false);
    setTarget({ kind: 'stance', debateId: debate.id }); setWords(''); setDraft(null); setComposerError('');
  }
  function beginNewDebate() {
    if (filling || scoring.size) { setError('Wait for the current arguments to finish scoring before starting a new debate.'); return; }
    if (workspace.demoMode && active) { void finishDraft('discard'); return; }
    if (workspace.sharingEnabled && active && !active.publishedAt) { setPublishError(''); setPublishPrompt(true); return; }
    setActiveId(null); setSidebarOpen(false); setSelectedId(null); choose({ kind: 'debate' });
  }
  async function finishDraft(action: 'publish' | 'discard') {
    if (!active || publishBusy) return;
    setPublishBusy(true); setPublishError('');
    try {
      const result = await api<Workspace>('/api/workspace', action === 'publish' ? { action: 'publish', id: active.id } : { action: 'delete', entity: 'debate', id: active.id });
      setWorkspace(result); setPublishPrompt(false); setActiveId(null); setSidebarOpen(false); setSelectedId(null); choose({ kind: 'debate' });
    } catch (e) { const message = e instanceof Error ? e.message : 'Could not finish this debate.'; setPublishError(message); setError(message); }
    finally { setPublishBusy(false); }
  }
  function openNode(id: string) { setSelectedId(id); setComposerOpen(false); setWords(''); setDraft(null); setComposerError(''); }
  const add = useCallback((id: string, kind: 'debate' | 'stance') => {
    choose(kind === 'debate' ? { kind: 'stance', debateId: id } : { kind: 'argument', stanceId: id });
  }, []);
  async function score(id: string) {
    setScoring(current => new Set(current).add(id));
    try { await api(`/api/arguments/${id}/score`, {}); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Scoring failed.'); await refresh().catch(() => {}); }
    finally { setScoring(current => { const next = new Set(current); next.delete(id); return next; }); }
  }
  async function autoFill(id: string, kind: 'debate' | 'stance') {
    if (filling) return;
    setError(''); setSelectedId(id); setComposerOpen(false);
    setFilling({ id, phase: 'Generating suggestions', completed: 0, total: 0 });
    try {
      const input = kind === 'debate' ? { kind: 'stances', debateId: id } : { kind: 'arguments', stanceId: id };
      const { suggestions } = await api<{ suggestions: Suggestion[] }>('/api/autofill', input);
      for (const [index, suggestion] of suggestions.entries()) {
        setFilling({ id, phase: kind === 'debate' ? 'Adding stances' : 'Adding arguments', completed: index, total: suggestions.length });
        const command = kind === 'debate'
          ? { action: 'createStance', debateId: id, title: suggestion.title, description: suggestion.description }
          : { action: 'createArgument', stanceId: id, title: suggestion.title, body: suggestion.body, sources: [] };
        const result = await api<Workspace & { id: string }>('/api/workspace', command);
        setWorkspace(result);
        if (kind === 'stance' && result.scoringConfigured) {
          setFilling({ id, phase: `Scoring argument ${index + 1}`, completed: index, total: suggestions.length });
          await score(result.id);
        }
        setFilling({ id, phase: kind === 'debate' ? 'Adding stances' : 'Adding arguments', completed: index + 1, total: suggestions.length });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Auto fill failed.'); }
    finally { setFilling(null); }
  }
  async function autoBuildDebate(debateId: string) {
    setAutoBuildingId(debateId);
    setFilling({ id: debateId, phase: 'Creating stances', completed: 0, total: 2 });
    setSelectedId(debateId);
    setComposerOpen(false);
    try {
      await runAutoMode(debateId, {
        suggestStances: async id => (await api<{ suggestions: Suggestion[] }>('/api/autofill', { kind: 'stances', debateId: id })).suggestions,
        createStance: async (id, suggestion) => {
          const result = await api<Workspace & { id: string }>('/api/workspace', { action: 'createStance', debateId: id, title: suggestion.title, description: suggestion.description });
          setWorkspace(result);
          return result.id;
        },
        suggestArguments: async id => (await api<{ suggestions: Suggestion[] }>('/api/autofill', { kind: 'arguments', stanceId: id })).suggestions,
        createArgument: async (id, suggestion) => {
          const result = await api<Workspace & { id: string }>('/api/workspace', { action: 'createArgument', stanceId: id, title: suggestion.title, body: suggestion.body, sources: [] });
          setWorkspace(result);
          return result.id;
        },
        scoreArgument: async id => { await score(id); },
      }, progress => setFilling({ id: debateId, ...progress }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Auto mode stopped before the tree was complete.'); }
    finally { setAutoBuildingId(null); setFilling(null); await refresh().catch(() => {}); }
  }
  async function processWords(event?: FormEvent, idea = words, promptTarget = target) {
    event?.preventDefault();
    if (idea.trim().length < 3 || composing) return;
    setComposing(true); setComposerError(''); setDraft(null);
    try {
      const payload = promptTarget.kind === 'debate' ? { kind: 'debate', text: idea } : promptTarget.kind === 'stance' ? { kind: 'stance', text: idea, debateId: promptTarget.debateId } : { kind: 'argument', text: idea, stanceId: promptTarget.stanceId };
      const result = await api<{ draft: Draft }>('/api/compose', payload);
      setDraft(result.draft);
    } catch (e) { setComposerError(e instanceof Error ? e.message : 'Could not process that thought.'); }
    finally { setComposing(false); }
  }
  async function acceptDraft() {
    if (!draft || saving) return;
    setSaving(true); setComposerError('');
    const command = target.kind === 'debate'
      ? { action: target.item ? 'updateDebate' : 'createDebate', id: target.item?.id, title: draft.title, description: draft.description }
      : target.kind === 'stance'
        ? { action: target.item ? 'updateStance' : 'createStance', id: target.item?.id, debateId: target.debateId, title: draft.title, description: draft.description }
        : { action: target.item ? 'updateArgument' : 'createArgument', id: target.item?.id, stanceId: target.stanceId, title: draft.title, body: draft.body, sources: target.item?.sources.length ? target.item.sources : suggestedSources(words) };
    try {
      const result = await api<Workspace & { id: string }>('/api/workspace', command);
      setWorkspace(result); setError('');
      if (target.kind === 'debate') {
        setActiveId(result.id);
        if (autoMode && !target.item) void autoBuildDebate(result.id);
        else choose({ kind: 'stance', debateId: result.id });
      }
      else if (target.kind === 'stance') { choose({ kind: 'argument', stanceId: result.id }); }
      else { setSelectedId(result.id); setComposerOpen(false); setDraft(null); setWords(''); if (result.scoringConfigured) void score(result.id); }
    } catch (e) { setComposerError(e instanceof Error ? e.message : 'Could not save your draft.'); }
    finally { setSaving(false); }
  }
  function editSelected() {
    if (!selected || !active) return;
    if (selectedKind === 'debate') choose({ kind: 'debate', item: active }, true);
    else if (stance) choose({ kind: 'stance', debateId: active.id, item: stance }, true);
    else if (argument) choose({ kind: 'argument', stanceId: argument.stanceId, item: argument }, true);
  }
  async function deleteSelected(command: Record<string, unknown>) {
    const result = await api<Workspace & { id: string }>('/api/workspace', command);
    setWorkspace(result); setModal(null); setSelectedId(null); setComposerOpen(false);
    if (command.entity === 'debate' && command.id === activeId) { setActiveId(null); setTarget({ kind: 'debate' }); setWords(''); setDraft(null); }
  }
  function handleInputKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void processWords(); }
  }
  return <div className="graph-app guided-app">
    <aside className={`debate-sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="Debates">
      <div className="sidebar-top"><span className="brand"><GitBranch size={18} /><span>debate tree</span></span><button className="icon-button" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={17} /></button></div>
      <button className="sidebar-new" onClick={beginNewDebate}><Plus size={15} />New debate</button>
      <nav className="sidebar-debates" aria-label="Saved debates">{workspace.debates.map(debate => { const answer = debateOutcome(debate); const hasLead = answer.label.startsWith('LEADING CASE'); return <button key={debate.id} className={active?.id === debate.id ? 'active' : ''} onClick={() => openDebate(debate)}>{workspace.sharingEnabled && <span className="sidebar-debate-status">{debate.publishedAt ? 'PUBLISHED' : 'YOUR DRAFT'}</span>}<span className="sidebar-debate-question">{asDebateQuestion(debate.title)}</span><span className="sidebar-debate-answer">{hasLead && <strong>Answer so far</strong>}{answer.text === 'Score two stances to compare.' ? 'No answer yet.' : answer.text}</span></button>; })}{!loading && !workspace.debates.length && <p>Your debates will appear here.</p>}</nav>
      <div className="sidebar-settings"><button onClick={() => setModal({ kind: 'help' })}><CircleHelp size={15} />Scoring</button><button onClick={() => setModal({ kind: 'settings' })}><Settings2 size={15} />Grok</button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
    <div className={`graph-workspace ${selected ? 'has-inspector' : ''}`}>
      <header className="guided-header"><button className="menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Open debates sidebar" aria-expanded={sidebarOpen}><Menu size={19} /></button><button className="home-wordmark" onClick={beginNewDebate}>debate tree<span>.</span></button><div className="header-right">{active && <button onClick={beginNewDebate}><Plus size={16} />New debate</button>}</div></header>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      <main className={`guided-main ${active ? 'has-debate' : 'is-home'}`}>
        {loading ? <div className="guided-loading"><LoaderCircle size={22} className="spin" /></div> : active ? <div className="graph-stage"><DebateGraph key={active.id} debate={active} scoring={scoring} fillingId={filling?.id ?? null} selectedId={selectedId} onOpen={openNode} onAdd={add} onAutoFill={(id, kind) => void autoFill(id, kind)} /></div> : <div className="home-center"><h1>What do you want to debate?</h1><Composer target={{ kind: 'debate' }} words={words} setWords={setWords} draft={draft} composing={composing} saving={saving} error={composerError} onSubmit={processWords} onAccept={acceptDraft} onChange={() => { setDraft(null); setComposerError(''); }} onKeyDown={handleInputKey} inputRef={inputRef} /><div className="home-options"><label className="auto-mode"><input type="checkbox" role="switch" checked={autoMode} disabled={!workspace.scoringConfigured} onChange={event => setAutoMode(event.target.checked)} /><span className="auto-mode-track" aria-hidden="true" /><span>Auto mode</span></label><span className="auto-mode-hint">Build both sides and their arguments for me</span></div><div className="debate-ideas"><div className="debate-ideas-heading"><span>OR START WITH AN IDEA</span><button onClick={() => setIdeas(pickDebateIdeas())} aria-label="Show different debate ideas"><RotateCw size={14} /> More ideas</button></div>{ideas.map(idea => <button key={idea} className="debate-idea" disabled={composing || saving} onClick={() => { setWords(idea); setDraft(null); void processWords(undefined, idea, { kind: 'debate' }); }}>{idea}<ArrowRight size={15} /></button>)}</div></div>}
      </main>
      {active && selected && <NodeInspector item={selected} debate={active} kind={selectedKind} scoringConfigured={workspace.scoringConfigured} scoring={argument ? scoring.has(argument.id) : false} filling={filling?.id === selected.id ? filling : null} autoFillBusy={Boolean(filling)} readOnly={Boolean(active.publishedAt)} onClose={() => { setSelectedId(null); setComposerOpen(false); }} onReshape={editSelected} onAdd={() => add(selected.id, selectedKind as 'debate' | 'stance')} onAutoFill={() => void autoFill(selected.id, selectedKind as 'debate' | 'stance')} onDelete={() => { setModal({ kind: 'delete', entity: selectedKind, id: selected.id, title: selected.title }); setSelectedId(null); }} onScore={() => void score(selected.id)} onConfigure={() => setModal({ kind: 'settings' })}>
        {composerOpen && <div className="inspector-composer"><Composer target={target} active={active} words={words} setWords={setWords} draft={draft} composing={composing} saving={saving} error={composerError} onSubmit={processWords} onAccept={acceptDraft} onChange={() => { setDraft(null); setComposerError(''); }} onKeyDown={handleInputKey} inputRef={inputRef} /></div>}
      </NodeInspector>}
    </div>
    {modal && <EditorModal modal={modal} onClose={() => setModal(null)} onSave={deleteSelected} configured={workspace.scoringConfigured} />}
    {publishPrompt && active && <Dialog title="Publish this debate?" onClose={() => setPublishPrompt(false)} busy={publishBusy}><p className="publish-copy">Share “{asDebateQuestion(active.title)}” as a public, read-only debate, or discard it before starting another.</p>{publishError && <p className="form-error" role="alert">{publishError}</p>}<div className="publish-actions"><button className="secondary-button" disabled={publishBusy} onClick={() => setPublishPrompt(false)}>Keep editing</button><button className="secondary-button" disabled={publishBusy} onClick={() => void finishDraft('discard')}>Discard</button><button className="primary-button" disabled={publishBusy} onClick={() => void finishDraft('publish')}>{publishBusy ? <LoaderCircle size={15} className="spin" /> : null}Publish</button></div></Dialog>}
  </div>;
}

function Composer({ target, active, words, setWords, draft, composing, saving, error, onSubmit, onAccept, onChange, onKeyDown, inputRef }: { target: PromptTarget; active?: Debate; words: string; setWords: (value: string) => void; draft: Draft | null; composing: boolean; saving: boolean; error: string; onSubmit: (event?: FormEvent) => void | Promise<void>; onAccept: () => void | Promise<void>; onChange: () => void; onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void; inputRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const stance = target.kind === 'argument' ? active?.stances.find(item => item.id === target.stanceId) : undefined;
  const question = target.kind === 'debate' ? 'What do you want to debate about?' : target.kind === 'stance' ? 'What’s a stance someone could take?' : `What makes the case for “${stance?.title || 'this stance'}”?`;
  const placeholder = target.kind === 'debate' ? 'Type anything…' : target.kind === 'stance' ? 'Your stance…' : 'Your argument…';
  return <section className={`prompt-section ${draft ? 'has-draft' : ''}`} aria-label="Shape your idea">
    {active && <div className="step-line"><span className="step-dot" />{target.kind === 'argument' ? 'ARGUMENT' : target.kind === 'debate' ? 'RESHAPE DEBATE' : 'STANCE'}<span className="step-counter">{target.kind === 'stance' ? String(active.stances.length + 1).padStart(2, '0') : ''}</span></div>}
    {active && <h2>{question}</h2>}
    <form className="idea-form" onSubmit={onSubmit}><textarea ref={inputRef} value={words} onChange={event => { setWords(event.target.value); onChange(); }} onKeyDown={onKeyDown} aria-label={question} placeholder={placeholder} maxLength={target.kind === 'argument' ? 8000 : 4000} rows={active ? 2 : 3} disabled={composing || saving} /><div className="idea-form-footer"><button type="submit" disabled={words.trim().length < 3 || composing || saving}>{composing ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={17} />}{composing ? 'Shaping…' : 'Shape it'}</button></div></form>
    {error && <p className="composer-error" role="alert">{error}</p>}
    {draft && <div className="draft-review"><div className="draft-label">DRAFT</div><h3>{draft.title}</h3>{(target.kind === 'argument' ? draft.body : draft.description) && <p>{target.kind === 'argument' ? draft.body : draft.description}</p>}<div className="draft-actions"><button className="try-again" onClick={() => void onSubmit()} disabled={composing || saving}>Try again</button><button className="accept-button" onClick={() => void onAccept()} disabled={saving}>{saving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{saving ? 'Adding…' : target.item ? 'Update the tree' : 'Add to the tree'}</button></div></div>}
  </section>;
}
