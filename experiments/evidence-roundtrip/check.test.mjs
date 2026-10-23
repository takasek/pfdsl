import assert from 'node:assert/strict';
import test from 'node:test';
import { checkEvidence, snapshot } from './check.mjs';

const source = `---
artifact:
  input: {label: Input}
  output: {label: Output, status: todo, criteria: Observable result}
process:
  work: {label: Work}
---
input >> work -> output
`;
const context = snapshot(source, [{ id: 'work', inputs: ['input'], outputs: ['output'] }], { 'result.txt': 'abc' });
const valid = () => ({ schemaVersion: 0, runId: 'test', processId: 'work', workItemIds: ['1526'], versions: context.versions, changedPaths: ['result.txt'], transitions: [{ artifactId: 'output', from: 'todo', to: 'wip' }], deviations: [], acceptanceEvidence: [] });
test('accepts matching versions and CLI ready with omitted input status', () => assert.deepEqual(checkEvidence(valid(), context), []));
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
