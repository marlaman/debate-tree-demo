import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDebate } from '../src/lib/graph';
import { mutate, openDatabase, readDebates } from '../src/lib/db';
test('new workspace is empty and stays empty after deleting a debate', () => {
  const db = openDatabase(':memory:');
  try {
    assert.deepEqual(readDebates(db), []);
    const id = mutate({action:'createDebate',title:'Temporary test',description:''}, db);
    mutate({action:'delete',entity:'debate',id}, db);
    assert.deepEqual(readDebates(db), []);
  } finally { db.close(); }
});
test('graph preserves parent connections and allocates non-overlapping argument columns', () => {
  const db = openDatabase(':memory:');
  try {
    const debateId = mutate({action:'createDebate',title:'Temporary test',description:''}, db);
    for (let s=0;s<3;s++) {
      const stanceId = mutate({action:'createStance',debateId,title:`Stance ${s}`,description:''}, db);
      for(let a=0;a<s+1;a++) mutate({action:'createArgument',stanceId,title:`Argument ${s}-${a}`,body:'Temporary argument for layout testing.',sources:[]},db);
    }
    const graph = layoutDebate(readDebates(db)[0]);
    assert.equal(graph.length,10);
    assert.equal(graph[0].kind,'debate');
    const argumentsOnly=graph.filter(n=>n.kind==='argument');
    assert.equal(new Set(argumentsOnly.map(n=>n.x)).size,6);
    for(const node of graph.filter(n=>n.parentId)) {
      const parent=graph.find(n=>n.id===node.parentId);
      assert.ok(parent);
      assert.ok(parent.y < node.y);
      assert.equal(parent.kind,node.kind==='stance'?'debate':'stance');
    }
  } finally { db.close(); }
});

test('long stance summaries keep argument nodes below the full card', () => {
  const db = openDatabase(':memory:');
  try {
    const debateId = mutate({ action: 'createDebate', title: 'Should parks be free?', description: '' }, db);
    const stanceId = mutate({ action: 'createStance', debateId, title: 'Parks should be free.', description: '' }, db);
    mutate({ action: 'createArgument', stanceId, title: 'Access matters', body: 'Free access allows more people to use public parks.', sources: [] }, db);
    const debate = readDebates(db)[0];
    debate.stances[0].summary = 'Public access is the strongest point, because a fee could exclude people with little money. The argument still lacks evidence that fees actually reduce visits, or that other funding would cover the costs.';
    debate.stances[0].summaryFresh = true;
    const nodes = layoutDebate(debate);
    const stance = nodes.find(node => node.kind === 'stance')!;
    const argument = nodes.find(node => node.kind === 'argument')!;
    assert.ok(stance.cardHeight && stance.cardHeight > 280);
    assert.ok(argument.y > stance.y + stance.cardHeight);
  } finally { db.close(); }
});
