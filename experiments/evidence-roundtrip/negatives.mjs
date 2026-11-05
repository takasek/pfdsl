import { readFileSync, writeFileSync } from 'node:fs';
import { checkEvidence } from './check.mjs';
const read = name => JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const context = read('snapshot.json');
const base = read('evidence.json');
const cases = [
 ['nonexistent-process','e0_process_does_not_exist','PROCESS_MISSING'],
 ['unfinished-input','reduce_work_cycle_protocol','NOT_READY'],
];
const results = [];
for (const [name,processId,required] of cases) {
 const evidence = {...base,processId,runId:`${base.runId}-${name}`};
 const errors = checkEvidence(evidence,context);
 if (!errors.includes(required)) throw new Error(`${name} did not reject with ${required}`);
 writeFileSync(new URL(`${name}.json`,import.meta.url),`${JSON.stringify(evidence,null,2)}\n`);
 results.push({name,processId,status:'FAIL',errors});
}
writeFileSync(new URL('negative-results.json',import.meta.url),`${JSON.stringify(results,null,2)}\n`);
console.log(JSON.stringify(results));
