import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, captureResult } from '../check.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../..');
const processId = 'i542_migrate_spec_id_refs';
const newId = 'SPEC_single_producer_constraint';
const roadmap = '.pfdsl/roadmap.pfdsl';
const specPath = path.join(target, 'docs/spec/spec.md');
const allowed = new Set(['docs/spec/spec.md', roadmap]);
const heading = '### 15.1 単一生成元制約';
const refPattern = /§15\.1(?![\d.])/g;
const checks = [];
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const idsOf = (o) => (o.ready ?? o).map((r) => r.id);
function run(name, args) {
  const r = spawnSync(process.execPath, args, { cwd: target, encoding: 'utf8' });
  checks.push({ name, args, status: r.status, stdout: r.stdout, stderr: r.stderr });
  return r;
}
function main() {
  const pre = readJson(path.join(here, 'snapshot.json'));
  const frozenReady = readJson(path.join(here, 'ready.json'));
  must(typeof snapshot === 'function', 'snapshot import unavailable');
  const live = run('status ready', ['packages/cli/dist/cli.js', 'status', 'ready', roadmap, '--json']);
  must(live.status === 0, 'live status ready failed');
  const liveReady = JSON.parse(live.stdout);
  must(liveReady.ok === true, 'live ready ok is not true');
  must(idsOf(liveReady).includes(processId), 'process missing from live ready');
  must(idsOf(frozenReady).includes(processId), 'process missing from frozen ready');
  const preCapture = captureResult(pre, target);
  const keys = Object.keys(pre.versions);
  must(keys.length === 3, 'expected three frozen versions');
  for (const k of keys) must(preCapture.versions[k] === pre.versions[k], `version mismatch: ${k}`);
  const absent = run('get-spec-id absent', ['scripts/get-spec-id.mjs', newId]);
  must(absent.status === 1 && /not defined|未定義/i.test(absent.stdout + absent.stderr), 'new id is not absent');
  must(run('mint-check', ['scripts/mint-check.mjs', 'single_producer_constraint']).status === 0, 'mint-check failed');
  const original = readFileSync(specPath, 'utf8');
  must(original.split(heading).length === 2, 'heading must occur exactly once');
  must((original.match(refPattern) ?? []).length === 2, 'section 15.1 references must occur exactly twice');
  must(run('meta set wip', ['packages/cli/dist/cli.js', 'meta', 'set', roadmap, 'spec_id_refs', 'status', 'wip']).status === 0, 'meta set failed');
  writeFileSync(specPath, original.replace(heading, `${heading} (${newId})`).replace(refPattern, `[[${newId}]]`));
  must(run('check-spec-ids', ['scripts/check-spec-ids.mjs']).status === 0, 'check-spec-ids failed');
  const fetched = run('get-spec-id', ['scripts/get-spec-id.mjs', newId]);
  must(fetched.status === 0, 'get-spec-id failed');
  const start = original.indexOf(heading);
  const end = original.indexOf('### 15.2');
  must(end > start, 'section 15.2 boundary not found');
  const firstLine = original.slice(start + heading.length, end).split('\n').find((l) => l.trim());
  must(firstLine && fetched.stdout.includes(firstLine), 'fetched block lacks unchanged rule');
  must(!/^### 15\.2/m.test(fetched.stdout), 'fetched block reaches section 15.2');
  const post = captureResult(pre, target);
  const changedPaths = Object.keys(pre.artifacts).filter((p) => pre.artifacts[p] !== post.artifacts[p]);
  must(changedPaths.every((p) => allowed.has(p)), `unexpected changed paths: ${changedPaths}`);
  const evidence = {
    schemaVersion: 0,
    runId: randomUUID(),
    processId,
    workItemIds: ['542'],
    versions: pre.versions,
    resultVersions: post.versions,
    changedPaths,
    transitions: [{ artifactId: 'spec_id_refs', from: 'todo', to: 'wip' }],
    acceptanceEvidence: ['experiments/evidence-roundtrip/safe-mode-20261026/checks.json'],
    deviations: [{ type: 'unchanged', reason: 'No model revision is requested: issue #542 explicitly allows staged migration; only the section 15.1 cluster was migrated and the complete artifact criteria remain unmet, so spec_id_refs stays wip.' }],
  };
  const evidencePath = path.join(here, 'evidence.json');
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  const chk = spawnSync(process.execPath, [path.join(here, '..', 'check.mjs'), evidencePath, path.join(here, 'snapshot.json'), target], { encoding: 'utf8' });
  let result;
  try { result = JSON.parse(chk.stdout); } catch { result = { status: 'ERROR', stdout: chk.stdout, stderr: chk.stderr }; }
  writeFileSync(path.join(here, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  must(chk.status === 0 && result.status === 'PASS', `checker did not PASS: ${chk.stderr}`);
  console.log(`PASS runId=${evidence.runId} changed=${changedPaths.join(',')}`);
}
try { main(); } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
finally { writeFileSync(path.join(here, 'checks.json'), JSON.stringify({ checks }, null, 2) + '\n'); }
