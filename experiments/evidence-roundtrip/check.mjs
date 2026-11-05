import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { analyze } from '../../packages/core/dist/index.js';
import { isCliEntrypoint } from '../../scripts/lib/cli-entrypoint.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const types = new Set(['additional-input', 'process-granularity', 'feedback', 'artifact-definition', 'criteria-observability', 'decision-boundary', 'execution-failure', 'unchanged']);
const text = (value) => typeof value === 'string' && value.length > 0;
const strings = (value) => Array.isArray(value) && value.every(text);

// Experimental pins are supplied by the preparation side, not by the driver.
export function snapshot(modelSource, ready, artifacts) {
 const model = analyze(modelSource);
 const criteria = Object.fromEntries(Object.entries(model.frontmatter?.artifact ?? {}).map(([id, value]) => [id, value.criteria ?? null]));
 return { modelSource, ready, artifacts, versions: {model: digest(modelSource), artifacts: digest(artifacts), criteria: digest(criteria)} };
}

// The preparation side fixes the read scope; the driver never supplies it.
export function captureResult(context, target) {
 const read = (path) => {
  if (!text(path) || isAbsolute(path) || relative(resolve(target), resolve(target, path)).startsWith('..')) throw new Error('Capture path must be relative to the target checkout');
  try { return readFileSync(resolve(target, path)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
 };
 const modelSource = read(context.modelPath);
 if (modelSource === null) throw new Error('Result model is missing');
 const artifacts = Object.fromEntries(Object.keys(context.artifacts).map(path => {
  const contents = read(path);
  return [path, contents === null ? null : createHash('sha256').update(contents).digest('hex')];
 }));
 return snapshot(modelSource.toString('utf8'), [], artifacts);
}

export function checkEvidence(evidence, context, resultContext) {
 if (!evidence || evidence.schemaVersion !== 0 || !text(evidence.runId) || !text(evidence.processId) ||
  !strings(evidence.workItemIds) || evidence.workItemIds.length === 0 || !strings(evidence.changedPaths) || !strings(evidence.acceptanceEvidence) ||
  !Array.isArray(evidence.transitions) || !Array.isArray(evidence.deviations) ||
  !evidence.versions || !['model','artifacts','criteria'].every(key => text(evidence.versions[key])) ||
  !evidence.transitions.every(t => t && text(t.artifactId) && text(t.from) && text(t.to)) ||
  !evidence.deviations.every(d => d && types.has(d.type) && text(d.reason))) return ['SCHEMA_INVALID'];
 const errors = [];
 if (context.processId && evidence.processId !== context.processId) errors.push('PROCESS_MISMATCH');
 const expected = snapshot(context.modelSource, context.ready, context.artifacts);
 if (['model','artifacts','criteria'].some(key => evidence.versions[key] !== expected.versions[key] || context.versions[key] !== expected.versions[key])) errors.push('VERSION_MISMATCH');
 const model = analyze(context.modelSource);
 if (model.diagnostics.some(d => d.severity === 'error')) errors.push('MODEL_INVALID');
 if (model.nodeKinds.get(evidence.processId) !== 'process') return [...errors, 'PROCESS_MISSING'];
 const location = model.frontmatter?.process?.[evidence.processId]?.location;
 const issue = typeof location === 'string' ? /^https:\/\/github\.com\/takasek\/pfdsl\/issues\/([1-9][0-9]*)$/.exec(location)?.[1] : undefined;
 if (issue && !evidence.workItemIds.includes(issue)) errors.push('WORK_ITEM_MISMATCH');
 const selected = context.ready.find(item => item.id === evidence.processId);
 if (!selected) errors.push('NOT_READY');
 const outputs = model.edges.filter(edge => edge.process === evidence.processId && edge.kind === 'output').map(edge => edge.artifact);
 const artifacts = model.frontmatter?.artifact ?? {};
 if (outputs.length === 0 || outputs.some(id => !text(artifacts[id]?.criteria))) errors.push('CRITERIA_MISSING');
 const states = Object.fromEntries(Object.entries(artifacts).map(([id, value]) => [id, value.status ?? 'unspecified']));
 for (const transition of evidence.transitions) {
  const before = resultContext ? states[transition.artifactId] : artifacts[transition.artifactId]?.status ?? 'unspecified';
  if (!outputs.includes(transition.artifactId) || before !== transition.from ||
   ![['todo','wip'],['unspecified','wip'],['wip','done']].some(([from,to]) => transition.from === from && transition.to === to)) errors.push('TRANSITION_INVALID');
  if (transition.to === 'done' && evidence.acceptanceEvidence.length === 0) errors.push('ACCEPTANCE_MISSING');
  states[transition.artifactId] = transition.to;
 }
 if (evidence.changedPaths.some(path => !Object.hasOwn(context.artifacts,path))) errors.push('ARTIFACT_UNPINNED');
 if ((context.requiresResult || evidence.resultVersions) && !resultContext) errors.push('RESULT_SNAPSHOT_MISSING');
 if (resultContext) {
  const actual = snapshot(resultContext.modelSource, [], resultContext.artifacts);
  if (['model','artifacts','criteria'].some(key => evidence.resultVersions?.[key] !== actual.versions[key] || resultContext.versions?.[key] !== actual.versions[key])) errors.push('RESULT_VERSION_MISMATCH');
  const beforePaths = Object.keys(context.artifacts).sort();
  const afterPaths = Object.keys(resultContext.artifacts).sort();
  if (digest(beforePaths) !== digest(afterPaths)) errors.push('ARTIFACT_SCOPE_MISMATCH');
  const changed = beforePaths.filter(path => context.artifacts[path] !== resultContext.artifacts[path]).sort();
  if (digest([...evidence.changedPaths].sort()) !== digest(changed)) errors.push('CHANGED_PATHS_MISMATCH');
  const resultModel = analyze(resultContext.modelSource);
  if (resultModel.diagnostics.some(d => d.severity === 'error')) errors.push('RESULT_MODEL_INVALID');
  const finalArtifacts = resultModel.frontmatter?.artifact ?? {};
  if (Object.keys({ ...artifacts, ...finalArtifacts }).some(id => !Object.hasOwn(artifacts, id) || !Object.hasOwn(finalArtifacts, id) || (finalArtifacts[id]?.status ?? 'unspecified') !== states[id])) errors.push('RESULT_STATUS_MISMATCH');
  if (actual.versions.criteria !== expected.versions.criteria) errors.push('RESULT_CRITERIA_CHANGED');
  const structure = (value) => ({ ...value.frontmatter, artifact: Object.fromEntries(Object.entries(value.frontmatter?.artifact ?? {}).map(([id, { status: _status, ...fields }]) => [id, fields])), edges: value.edges, nodeKinds: [...value.nodeKinds] });
  if (digest(structure(model)) !== digest(structure(resultModel))) errors.push('RESULT_MODEL_CHANGED');
  const bindings = context.outputPaths;
  if (!bindings || outputs.some(id => !strings(bindings[id]) || bindings[id].length === 0 || bindings[id].some(path => !Object.hasOwn(context.artifacts, path)))) errors.push('OUTPUT_PATHS_MISSING');
  for (const id of outputs.filter(id => states[id] === 'done')) {
   if (!Array.isArray(bindings?.[id]) || !bindings[id].some(path => evidence.acceptanceEvidence.includes(path) && text(resultContext.artifacts[path]))) errors.push('ACCEPTANCE_UNPINNED');
  }
 }
 return [...new Set(errors)];
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
 try {
  const [evidencePath, contextPath, resultTarget, ...extra] = process.argv.slice(2);
  if (!evidencePath || !contextPath || extra.length) throw new Error('Usage: check.mjs <evidence.json> <snapshot.json> [result-checkout]');
  const context = JSON.parse(readFileSync(contextPath,'utf8'));
  const errors = checkEvidence(JSON.parse(readFileSync(evidencePath,'utf8')), context, resultTarget ? captureResult(context, resultTarget) : undefined);
  console.log(JSON.stringify({ status: errors.length ? 'FAIL' : 'PASS', errors },null,2));
  process.exitCode = errors.length ? 1 : 0;
 } catch (error) {
  console.error(error.message);
  process.exitCode = 2;
 }
}
