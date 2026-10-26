import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureResult, checkEvidence, snapshot } from './check.mjs';

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
context.outputPaths = { output: ['result.txt'] };
const valid = () => ({ schemaVersion: 0, runId: 'test', processId: 'work', workItemIds: ['1526'], versions: context.versions, changedPaths: ['result.txt'], transitions: [{ artifactId: 'output', from: 'todo', to: 'wip' }], deviations: [], acceptanceEvidence: [] });
const after = snapshot(source.replace('Output, status: todo', 'Output, status: wip'), [], { 'result.txt': 'def' });
const completed = () => ({ ...valid(), resultVersions: after.versions });
test('checks execution results against a separately captured after snapshot', () => {
 assert.deepEqual(checkEvidence(completed(), context, after), []);
});
test('requires the after snapshot and its matching versions together', () => {
 assert.ok(checkEvidence(completed(), context).includes('RESULT_SNAPSHOT_MISSING'));
 assert.ok(checkEvidence(valid(), context, after).includes('RESULT_VERSION_MISMATCH'));
 const corrupted = { ...after, artifacts: { 'result.txt': 'tampered' } };
 assert.ok(checkEvidence(completed(), context, corrupted).includes('RESULT_VERSION_MISMATCH'));
});
test('rejects claimed changes when the actual contents did not change', () => {
 const unchanged = snapshot(after.modelSource, [], context.artifacts);
 assert.ok(checkEvidence({ ...completed(), resultVersions: unchanged.versions }, context, unchanged).includes('CHANGED_PATHS_MISMATCH'));
});
test('rejects omitted changes, duplicates, and a different capture scope', () => {
 assert.ok(checkEvidence({ ...completed(), changedPaths: [] }, context, after).includes('CHANGED_PATHS_MISMATCH'));
 assert.ok(checkEvidence({ ...completed(), changedPaths: ['result.txt', 'result.txt'] }, context, after).includes('CHANGED_PATHS_MISMATCH'));
 const different = snapshot(after.modelSource, [], { 'other.txt': 'abc' });
 assert.ok(checkEvidence({ ...completed(), resultVersions: different.versions }, context, different).includes('ARTIFACT_SCOPE_MISMATCH'));
});
test('compares transitions with actual final statuses and accepts an ordered completion chain', () => {
 assert.ok(checkEvidence(completed(), context, { ...after, modelSource: source }).includes('RESULT_STATUS_MISMATCH'));
 const done = snapshot(source.replace('Output, status: todo', 'Output, status: done'), [], after.artifacts);
 const evidence = { ...completed(), resultVersions: done.versions, transitions: [...valid().transitions, { artifactId: 'output', from: 'wip', to: 'done' }], acceptanceEvidence: ['result.txt'] };
 assert.deepEqual(checkEvidence(evidence, context, done), []);
 assert.ok(checkEvidence({ ...evidence, transitions: [...evidence.transitions].reverse() }, context, done).includes('TRANSITION_INVALID'));
 assert.ok(checkEvidence({ ...evidence, acceptanceEvidence: [] }, context, done).includes('ACCEPTANCE_MISSING'));
 assert.ok(checkEvidence({ ...completed(), transitions: [] }, context, after).includes('RESULT_STATUS_MISMATCH'));
});
test('does not accept changed acceptance criteria or non-output status changes', () => {
 const changed = snapshot(after.modelSource.replace('Observable result', 'Weaker result').replace('Input, status: done', 'Input, status: todo'), [], after.artifacts);
 const errors = checkEvidence({ ...completed(), resultVersions: changed.versions }, context, changed);
 assert.ok(errors.includes('RESULT_CRITERIA_CHANGED'));
 assert.ok(errors.includes('RESULT_STATUS_MISMATCH'));
});
test('can pin created and deleted files with explicit null versions', () => {
 const before = snapshot(source, context.ready, { 'new.txt': null, 'old.txt': 'abc' });
 before.outputPaths = { output: ['new.txt', 'old.txt'] };
 const result = snapshot(after.modelSource, [], { 'new.txt': 'def', 'old.txt': null });
 assert.deepEqual(checkEvidence({ ...completed(), versions: before.versions, resultVersions: result.versions, changedPaths: ['new.txt', 'old.txt'] }, before, result), []);
});
test('requires output bindings and ties done acceptance to an existing bound result', () => {
 assert.ok(checkEvidence(completed(), { ...context, processId: 'another' }, after).includes('PROCESS_MISMATCH'));
 assert.ok(checkEvidence(completed(), { ...context, outputPaths: undefined }, after).includes('OUTPUT_PATHS_MISSING'));
 const done = snapshot(source.replace('Output, status: todo', 'Output, status: done'), [], after.artifacts);
 assert.ok(checkEvidence({ ...completed(), resultVersions: done.versions, transitions: [...valid().transitions, { artifactId: 'output', from: 'wip', to: 'done' }], acceptanceEvidence: ['unrelated.txt'] }, context, done).includes('ACCEPTANCE_UNPINNED'));
});
test('rejects changes to graph structure after the ready snapshot', () => {
 const changed = snapshot(after.modelSource.replace('input >> work -> output', 'input >> work -> [output, extra]'), [], after.artifacts);
 assert.ok(checkEvidence({ ...completed(), resultVersions: changed.versions }, context, changed).includes('RESULT_MODEL_CHANGED'));
});
test('CLI reads actual result files, detects later tampering, and writes nothing', () => {
 const dir = mkdtempSync(join(tmpdir(), 'pfd-e0-result-'));
 const hash = value => createHash('sha256').update(value).digest('hex');
 try {
  const pre = { ...snapshot(source, context.ready, { 'result.txt': hash('before') }), modelPath: 'roadmap.pfdsl', outputPaths: context.outputPaths };
  writeFileSync(join(dir, 'roadmap.pfdsl'), after.modelSource);
  writeFileSync(join(dir, 'result.txt'), 'after');
  const result = captureResult(pre, dir);
  const evidence = { ...completed(), versions: pre.versions, resultVersions: result.versions };
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(pre));
  writeFileSync(join(dir, 'evidence.json'), JSON.stringify(evidence));
  const paths = ['roadmap.pfdsl', 'result.txt', 'snapshot.json', 'evidence.json'];
  const contents = () => paths.map(path => readFileSync(join(dir, path), 'utf8'));
  const beforeCheck = contents();
  const checker = fileURLToPath(new URL('./check.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [checker, join(dir, 'evidence.json'), join(dir, 'snapshot.json'), dir], { encoding: 'utf8' });
  const passed = run();
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.equal(JSON.parse(passed.stdout).status, 'PASS');
  assert.deepEqual(contents(), beforeCheck);
  writeFileSync(join(dir, 'result.txt'), 'tampered');
  const failed = run();
  assert.equal(failed.status, 1);
  assert.ok(JSON.parse(failed.stdout).errors.includes('RESULT_VERSION_MISMATCH'));
  assert.throws(() => captureResult({ ...pre, modelPath: '../escape.pfdsl' }, dir), /relative/);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('preparation writes a new trial directory and refuses to replace it', () => {
 const dir = mkdtempSync(join(tmpdir(), 'pfd-e0-prepare-'));
 try {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const target = join(dir, 'checkout');
  mkdirSync(join(target, '.pfdsl'), { recursive: true });
  mkdirSync(join(target, 'packages/cli'), { recursive: true });
  symlinkSync(join(root, 'packages/cli/dist'), join(target, 'packages/cli/dist'));
  writeFileSync(join(target, '.pfdsl/roadmap.pfdsl'), source);
  writeFileSync(join(target, 'result.txt'), 'before');
  execFileSync('git', ['init', target], { stdio: 'ignore' });
  execFileSync('git', ['-C', target, '-c', 'user.name=E0 Test', '-c', 'user.email=e0@example.invalid', 'commit', '--allow-empty', '-m', 'test: initialize capture fixture'], { stdio: 'ignore' });
  const prepare = fileURLToPath(new URL('./prepare.mjs', import.meta.url));
  const plan = join(dir, 'plan.json');
  const output = join(dir, 'trial');
  const capturePlan = { processId: 'work', paths: ['result.txt', 'new.txt'], outputPaths: { output: ['result.txt', 'new.txt'] } };
  writeFileSync(plan, JSON.stringify(capturePlan));
  const run = () => spawnSync(process.execPath, [prepare, target, output, plan], { encoding: 'utf8' });
  const prepared = run();
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const saved = readFileSync(join(output, 'snapshot.json'), 'utf8');
  const pinned = JSON.parse(saved);
  assert.equal(pinned.modelPath, '.pfdsl/roadmap.pfdsl');
  assert.equal(pinned.artifacts['result.txt'].length, 64);
  assert.equal(pinned.artifacts['new.txt'], null);
  assert.equal(pinned.processId, capturePlan.processId);
  assert.equal(pinned.requiresResult, true);
  assert.ok(checkEvidence({ ...valid(), versions: pinned.versions }, pinned).includes('RESULT_SNAPSHOT_MISSING'));
  assert.deepEqual(pinned.outputPaths.output, ['result.txt', 'new.txt']);
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(join(output, 'snapshot.json'), 'utf8'), saved);
  writeFileSync(join(target, '.pfdsl/roadmap.pfdsl'), source.replace('Output, status: todo', 'Output, status: wip'));
  const stopped = spawnSync(process.execPath, [prepare, target, join(dir, 'not-ready'), plan], { encoding: 'utf8' });
  assert.notEqual(stopped.status, 0);
  assert.match(stopped.stderr, /not ready/);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
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
