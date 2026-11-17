'use client';

import type { ReactNode } from 'react';
import { ArrowUpRight, LoaderCircle, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { Argument, Debate, Stance } from '@/lib/types';
import { asDebateQuestion, averageScore } from '@/lib/types';
import { debateOutcome, stanceOutcome } from '@/lib/outcome';
import { Score } from './dialogs';

export type FillProgress = { id: string; phase: string; completed: number; total: number };
type Props = {
  item: Debate | Stance | Argument;
  debate: Debate;
  kind: 'debate' | 'stance' | 'argument';
  scoringConfigured: boolean;
  scoring: boolean;
  filling: FillProgress | null;
  autoFillBusy: boolean;
  readOnly: boolean;
  onClose: () => void;
  onReshape: () => void;
  onAdd: () => void;
  onAutoFill: () => void;
  onDelete: () => void;
  onScore: () => void;
  onConfigure: () => void;
  children?: ReactNode;
};

export function NodeInspector({ item, debate, kind, scoringConfigured, scoring, filling, autoFillBusy, readOnly, onClose, onReshape, onAdd, onAutoFill, onDelete, onScore, onConfigure, children }: Props) {
  const argument = kind === 'argument' ? item as Argument : null;
  const stance = kind === 'stance' ? item as Stance : null;
  const description = 'description' in item ? item.description : '';
  const average = stance ? averageScore(stance.arguments) : null;
  const outcome = kind === 'debate' ? debateOutcome(debate) : stance ? stanceOutcome(stance) : null;
  return <aside className="node-inspector" aria-label={`${kind} details`}>
    <div className="inspector-heading"><span>{kind}</span><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={18} /></button></div>
    <div className="inspector-scroll">
      <h2>{kind === 'debate' ? asDebateQuestion(item.title) : item.title}</h2>
      {readOnly && <p className="published-note">Published · read-only</p>}
      {outcome && <div className="inspector-outcome" aria-live="polite"><span>{outcome.label}</span><strong>{outcome.text}</strong></div>}
      {kind === 'stance' && <div className="inspector-average"><div><span>Average argument score</span><strong>{average === null ? '—' : `${average}%`}</strong></div><div className="stance-meter"><span style={{ width: `${average ?? 0}%` }} /></div></div>}
      {argument && <div className="inspector-score"><Score value={argument.assessment?.score ?? null} /><span>AI-assessed argument</span></div>}
      {(argument?.body || description) && <p className="inspector-description">{argument?.body || description}</p>}
      {argument?.sources.length ? <div className="detail-sources"><h3>Sources <small>user-provided · not verified</small></h3>{argument.sources.map((source, index) => <div key={index}><a href={source.url} target="_blank" rel="noreferrer">{new URL(source.url).hostname}<ArrowUpRight size={12} /></a>{source.excerpt && <blockquote>{source.excerpt}</blockquote>}</div>)}</div> : null}
      {argument?.assessment && <div className="assessment-panel"><h3>Why this score?</h3><p>{argument.assessment.explanation}</p>{argument.assessment.strengths.length > 0 && <><h4>Strengths</h4><ul>{argument.assessment.strengths.map((text, i) => <li key={i}>{text}</li>)}</ul></>}{argument.assessment.weaknesses.length > 0 && <><h4>Weaknesses</h4><ul>{argument.assessment.weaknesses.map((text, i) => <li key={i}>{text}</li>)}</ul></>}<small>AI-assessed quality · {argument.model}</small></div>}
      {argument?.error && <p className="form-error">{argument.error}</p>}
      {argument && !argument.assessment && !readOnly && <button className="secondary-button" disabled={scoring} onClick={scoringConfigured ? onScore : onConfigure}>{scoring ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{scoring ? 'Scoring…' : scoringConfigured ? 'Score with Grok' : 'Connect Grok to score'}</button>}
      {filling && <div className="fill-progress" role="status"><LoaderCircle size={15} className="spin" /><span>{filling.phase}{filling.total ? ` · ${filling.completed}/${filling.total}` : ''}</span></div>}
      {!readOnly && <div className="inspector-actions"><button onClick={onReshape}><Pencil size={15} />Reshape</button>{kind !== 'argument' && <><button onClick={onAdd}><Plus size={15} />{kind === 'debate' ? 'Add stance' : 'Add argument'}</button><button onClick={onAutoFill} disabled={autoFillBusy}><Sparkles size={15} />Auto fill</button></>}<button className="delete-action" onClick={onDelete}><Trash2 size={15} />Delete</button></div>}
      {children}
    </div>
  </aside>;
}
