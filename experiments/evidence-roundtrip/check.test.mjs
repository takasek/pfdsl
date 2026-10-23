import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEvidence, snapshot } from './check.mjs';

const source = `---
artifact:
  input: {label: Input, status: done}
  output: {label: Output, status: todo, criteria: Observable result}
process:
  work: {label: Work}
---
input >> work -> output
`;
const context = snapshot(source, [{ id: 'work', inputs: ['input'], outputs: ['output'] }], { 'result.txt': 'abc' });
const valid = () => ({ schemaVersion: 0, runId: 'test', processId: 'work', workItemIds: ['1526'], versions: context.versions, changedPaths: ['result.txt'], transitions: [{ artifactId: 'output', from: 'todo', to: 'wip' }], deviations: [], acceptanceEvidence: [] });
test('accepts matching versions and supplied CLI ready', () => assert.deepEqual(checkEvidence(valid(), context), []));
test('rejects nonexistent process', () => assert.ok(checkEvidence({ ...valid(), processId: 'missing' }, context).includes('PROCESS_MISSING')));
test('rejects input blocked by the actual CLI ready set', () => assert.ok(checkEvidence(valid(), { ...context, ready: [] }).includes('NOT_READY')));
test('rejects version mismatch', () => assert.ok(checkEvidence({ ...valid(), versions: { ...context.versions, model: 'old' } }, context).includes('VERSION_MISMATCH')));
test('rejects missing criteria', () => {
 const noCriteria = snapshot(source.replace(', criteria: Observable result', ''), context.ready, {});
 assert.ok(checkEvidence({ ...valid(), versions: noCriteria.versions }, noCriteria).includes('CRITERIA_MISSING'));
});
test('rejects unrelated and false transitions', () => {
 for (const transition of [{artifactId:'input',from:'todo',to:'wip'}, {artifactId:'output',from:'done',to:'todo'}]) {
  assert.ok(checkEvidence({...valid(),transitions:[transition]},context).includes('TRANSITION_INVALID'));
 }
});
test('done requires references but does not prove their substantive validity', () => {
 const current = snapshot(source.replace('status: todo', 'status: wip'), context.ready, {});
 assert.ok(checkEvidence({...valid(),versions:current.versions,transitions:[{artifactId:'output',from:'wip',to:'done'}]},current).includes('ACCEPTANCE_MISSING'));
});
test('rejects malformed evidence and unknown deviation types', () => {
 assert.deepEqual(checkEvidence(null,context), ['SCHEMA_INVALID']);
 assert.ok(checkEvidence({...valid(),deviations:[{type:'anything',reason:'x'}]},context).includes('SCHEMA_INVALID'));
});
test('requires work item IDs for this backend-adopting repository', () => {
 assert.ok(checkEvidence({...valid(),workItemIds:[]},context).includes('SCHEMA_INVALID'));
 const located = snapshot(source.replace('work: {label: Work}','work: {label: Work, location: https://github.com/takasek/pfdsl/issues/1526}'),context.ready,context.artifacts);
 assert.ok(checkEvidence({...valid(),versions:located.versions,workItemIds:['999']},located).includes('WORK_ITEM_MISMATCH'));
});
test('existing CLI accepts done input and rejects unfinished input', () => {
 const dir = mkdtempSync(join(tmpdir(),'pfd-e0-ready-'));
 try {
  const file = join(dir,'roadmap.pfdsl');
  const cli = fileURLToPath(new URL('../../packages/cli/dist/cli.js',import.meta.url));
  for (const blocked of [false,true]) {
   const model = source.replace('---\n','---\ntype: roadmap\n').replace('Input, status: done',blocked ? 'Input, status: todo' : 'Input, status: done');
   writeFileSync(file,model);
   const actual = JSON.parse(execFileSync(process.execPath,[cli,'status','ready',file,'--json'],{encoding:'utf8'}));
   assert.equal(actual.ok,true);
   const current = snapshot(model,actual.ready,{'result.txt':'abc'});
   const errors = checkEvidence({...valid(),versions:current.versions},current);
   assert.equal(errors.includes('NOT_READY'),blocked);
  }
  writeFileSync(file,source.replace('Input, status: done','Input'));
  const legacy = JSON.parse(execFileSync(process.execPath,[cli,'status','ready',file,'--json'],{encoding:'utf8'}));
  assert.ok(legacy.ready.some(p => p.id === 'work'));
  writeFileSync(file,source.replace('---\n','---\ntype: roadmap\n').replace('Input, status: done','Input'));
  assert.throws(() => execFileSync(process.execPath,[cli,'status','ready',file,'--json'],{encoding:'utf8'}),error => JSON.parse(error.stdout).diagnostics.some(d => d.code === 'V035'));
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
