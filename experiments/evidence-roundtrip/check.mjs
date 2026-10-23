import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

export function checkEvidence(evidence, context) {
 if (!evidence || evidence.schemaVersion !== 0 || !text(evidence.runId) || !text(evidence.processId) ||
  !strings(evidence.workItemIds) || evidence.workItemIds.length === 0 || !strings(evidence.changedPaths) || !strings(evidence.acceptanceEvidence) ||
  !Array.isArray(evidence.transitions) || !Array.isArray(evidence.deviations) ||
  !evidence.versions || !['model','artifacts','criteria'].every(key => text(evidence.versions[key])) ||
  !evidence.transitions.every(t => t && text(t.artifactId) && text(t.from) && text(t.to)) ||
  !evidence.deviations.every(d => d && types.has(d.type) && text(d.reason))) return ['SCHEMA_INVALID'];
 const errors = [];
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
 for (const transition of evidence.transitions) {
  const before = artifacts[transition.artifactId]?.status ?? 'unspecified';
  if (!outputs.includes(transition.artifactId) || before !== transition.from ||
   ![['todo','wip'],['unspecified','wip'],['wip','done']].some(([from,to]) => transition.from === from && transition.to === to)) errors.push('TRANSITION_INVALID');
  if (transition.to === 'done' && evidence.acceptanceEvidence.length === 0) errors.push('ACCEPTANCE_MISSING');
 }
 if (evidence.changedPaths.some(path => !Object.hasOwn(context.artifacts,path))) errors.push('ARTIFACT_UNPINNED');
 return [...new Set(errors)];
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
 try {
  const [evidencePath, contextPath, ...extra] = process.argv.slice(2);
  if (!evidencePath || !contextPath || extra.length) throw new Error('Usage: check.mjs <evidence.json> <snapshot.json>');
  const errors = checkEvidence(JSON.parse(readFileSync(evidencePath,'utf8')), JSON.parse(readFileSync(contextPath,'utf8')));
  console.log(JSON.stringify({ status: errors.length ? 'FAIL' : 'PASS', errors },null,2));
  process.exitCode = errors.length ? 1 : 0;
 } catch (error) {
  console.error(error.message);
  process.exitCode = 2;
 }
}
