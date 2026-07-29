#!/usr/bin/env node
/**
 * check-doc-examples.mjs
 *
 * Extracts fenced ```pfdsl code blocks from Markdown files and validates
 * each block with the pfdsl CLI `check` command via a temp file.
 *
 * Blocks preceded by `<!-- pfdsl-nocheck -->` on the immediately preceding
 * non-blank line are skipped (use for intentional NG examples or subflow
 * blocks with unresolvable relative paths).
 *
 * Usage:
 *   node scripts/check-doc-examples.mjs [files...]
 *   (no args → docs/spec/spec.md + docs/spec/proposals/*.md)
 *
 * Exit 0 = all checked blocks valid, Exit 1 = any violation found.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { spawnSync } from 'child_process';
import { git } from './lib/run-exec.mjs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { runDocExamplesCheck } from './lib/doc-examples-steps.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'packages', 'cli', 'dist', 'cli.js');

const args = process.argv.slice(2);
const defaultFiles = [
  'docs/spec/spec.md',
  ...git(["ls-files", "docs/spec/proposals/*.md"])
    .trim()
    .split('\n')
    .filter(Boolean),
];
const files = args.length > 0 ? args : defaultFiles;

let blockCounter = 0;
const exec = (block) => {
  blockCounter++;
  const tmpPath = join(tmpdir(), `pfdsl-doc-check-${process.pid}-${blockCounter}.pfdsl`);
  writeFileSync(tmpPath, block.content, 'utf8');
  const result = spawnSync('node', [CLI, 'check', tmpPath], { encoding: 'utf8' });
  unlinkSync(tmpPath);
  return result;
};

const { exitCode, messages } = runDocExamplesCheck({
  files,
  readFile: (file) => readFileSync(file, 'utf8'),
  exec,
});

for (const { stream, text } of messages) {
  if (stream === 'log') console.log(text);
  else if (stream === 'error') console.error(text);
  else if (stream === 'stdout') process.stdout.write(text);
  else if (stream === 'stderr') process.stderr.write(text);
}
process.exit(exitCode);
