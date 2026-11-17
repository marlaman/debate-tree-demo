'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import { Plus, ArrowUpRight, LoaderCircle, Sparkles } from 'lucide-react';
import { layoutDebate, type GraphItem } from '@/lib/graph';
import { caseQuality } from '@/lib/outcome';
import { asDebateQuestion, type Debate } from '@/lib/types';
import { Score } from './dialogs';

type TreeNodeData = GraphItem & { busy: boolean; filling: boolean; fillDisabled: boolean; readOnly: boolean; onOpen: (id: string) => void; onAdd: (id: string, kind: 'debate' | 'stance') => void; onAutoFill: (id: string, kind: 'debate' | 'stance') => void };
type TreeNode = Node<TreeNodeData, 'tree'>;
function TreeCard({ data }: NodeProps<TreeNode>) {
  const isDebate = data.kind === 'debate';
  const displayTitle = isDebate ? asDebateQuestion(data.title) : data.title;
  const scoreTone = data.kind === 'argument' && data.score !== null ? data.score > 50 ? 'score-high' : 'score-low' : '';
  return <div className={`tree-card ${data.kind} ${scoreTone}`} style={data.kind === 'stance' ? { height: data.cardHeight } : undefined}>
    {data.parentId && <Handle type="target" position={Position.Top} isConnectable={false} />}
    <div className="node-label"><span>{data.kind === 'stance' ? 'position' : data.kind}</span>{data.kind === 'stance' ? <span className="stance-average">{data.score === null ? 'No score' : `${data.score}% avg`}</span> : data.kind === 'argument' && (data.busy ? <LoaderCircle size={13} className="spin" aria-label="Scoring" /> : <Score value={data.score} />)}</div>
    <button className="node-title nodrag" onClick={() => data.onOpen(data.id)} aria-label={`Open ${data.kind}: ${data.title}`}>{displayTitle}</button>
    {data.kind === 'stance' && <div className="stance-readout" aria-label={`Case quality: ${caseQuality(data.score)}${data.standing ? `, ${data.standing.toLowerCase()}` : ''}`}><div><span>CASE QUALITY</span><strong>{caseQuality(data.score)}</strong></div>{data.standing && <span className="stance-standing">{data.standing}</span>}</div>}
    {data.outcome && <div className={`node-outcome ${data.outcome.label.startsWith('LEADING CASE') ? 'is-leading' : ''}`} aria-live="polite"><span className="node-outcome-label">{data.outcome.label}</span><span className="node-outcome-text">{data.outcome.text}</span></div>}
    <div className="node-footer">{data.kind !== 'argument' ? !data.readOnly && <div className="node-actions"><button className="nodrag" onClick={() => data.onAdd(data.id, data.kind as 'debate' | 'stance')}><Plus size={13} />{isDebate ? 'Add stance' : 'Add argument'}</button><button className="nodrag" disabled={data.fillDisabled} onClick={() => data.onAutoFill(data.id, data.kind as 'debate' | 'stance')}>{data.filling ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}{data.filling ? 'Filling…' : 'Auto fill'}</button></div> : <span>{data.score === null ? 'Not scored' : 'AI-assessed quality'}</span>}{!isDebate && <button className="nodrag node-open" aria-label={`Details for ${data.title}`} onClick={() => data.onOpen(data.id)}><ArrowUpRight size={14} /></button>}</div>
    {data.kind === 'stance' && <div className="stance-meter" aria-label={data.score === null ? 'No scored arguments' : `Average argument score ${data.score} out of 100`}><span style={{ width: `${data.score ?? 0}%` }} /></div>}
    {data.kind !== 'argument' && <Handle type="source" position={Position.Bottom} isConnectable={false} />}
  </div>;
}
const nodeTypes = { tree: TreeCard };
function FitGraph({ topology, selectedId, items }: { topology: string; selectedId: string | null; items: GraphItem[] }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const item = items.find(node => node.id === selectedId);
  const focusIds = (item?.kind === 'debate'
    ? items.filter(node => node.kind === 'debate' || node.kind === 'stance')
    : item?.kind === 'stance'
      ? items.filter(node => node.kind === 'debate' || node.id === item.id || node.parentId === item.id)
      : item ? items.filter(node => node.id === item.parentId || node.parentId === item.parentId) : []).map(node => node.id).join('|');
  useEffect(() => {
    if (!initialized) return;
    if (!selectedId) { void fitView({ padding: 0.2, maxZoom: 1, duration: 400 }); return; }
    const timer = window.setTimeout(() => {
      if (!focusIds) return;
      void fitView({ nodes: focusIds.split('|').map(id => ({ id })), padding: 0.12, minZoom: 0.4, maxZoom: 1.08, duration: 450 });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [initialized, topology, selectedId, focusIds, fitView]);
  return null;
}
function Canvas({ debate, scoring, fillingId, selectedId, onOpen, onAdd, onAutoFill }: { debate: Debate; scoring: Set<string>; fillingId: string | null; selectedId: string | null; onOpen: TreeNodeData['onOpen']; onAdd: TreeNodeData['onAdd']; onAutoFill: TreeNodeData['onAutoFill'] }) {
  const items = useMemo(() => layoutDebate(debate), [debate]);
  const topology = items.map(item => `${item.id}:${item.y}:${item.cardHeight ?? ''}`).join('|');
  const previousTopology = useRef(topology);
  const [nodes, setNodes, onNodesChange] = useNodesState<TreeNode>([]);
  useEffect(() => {
    const changed = previousTopology.current !== topology;
    setNodes(old => items.map(item => ({ id: item.id, type: 'tree', position: changed ? { x: item.x, y: item.y } : old.find(node => node.id === item.id)?.position || { x: item.x, y: item.y }, data: { ...item, busy: scoring.has(item.id), filling: fillingId === item.id, fillDisabled: fillingId !== null, readOnly: Boolean(debate.publishedAt), onOpen, onAdd, onAutoFill } })));
    previousTopology.current = topology;
  }, [items, topology, scoring, fillingId, onOpen, onAdd, onAutoFill, setNodes, debate.publishedAt]);
  const edges = useMemo(() => items.filter(item => item.parentId).map(item => ({ id: `${item.parentId}-${item.id}`, source: item.parentId!, target: item.id, type: 'default', selectable: false })), [items]);
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} minZoom={0.68} maxZoom={1.8}>
    <Background color="#dfdfdf" gap={24} size={1} /><Controls showInteractive={false} /><FitGraph topology={topology} selectedId={selectedId} items={items} />
  </ReactFlow>;
}
export function DebateGraph(props: Parameters<typeof Canvas>[0]) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
