import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const processId = 'i1525_revise_boundary_test';
const beside = name => new URL(name, import.meta.url);

try {
  const snapshot = JSON.parse(await readFile(beside('snapshot.json'), 'utf8'));
  const ready = JSON.parse(await readFile(beside('ready.json'), 'utf8'));

  if (ready.ok !== true || !Array.isArray(ready.ready)) {
    throw new Error('ready.json must contain a successful CLI result with a ready array');
  }

  const versions = {};
  for (const key of ['model', 'artifacts', 'criteria']) {
    const value = snapshot.versions?.[key];
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
      throw new Error(`snapshot.versions.${key} must be a SHA-256 digest`);
    }
    versions[key] = value;
  }

  const reason = ready.ready.some(item => item?.id === processId)
    ? `${processId} is ready, but no separately approved execution entrypoint was supplied; execution stopped.`
    : `${processId} is absent from the CLI ready list; execution stopped.`;

  const evidence = {
    schemaVersion: 0,
    runId: randomUUID(),
    processId,
    workItemIds: ['1525'],
    versions,
    changedPaths: [],
    transitions: [],
    deviations: [{ type: 'execution-failure', reason }],
    acceptanceEvidence: []
  };

  await writeFile(beside('evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(reason);
} catch (error) {
  console.error(`Stopped: ${error.message}`);
  process.exitCode = 2;
}