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
import { execSync, spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'packages', 'cli', 'dist', 'cli.js');
const NOCHECK_RE = /<!--\s*pfdsl-nocheck\s*-->/;

function extractBlocks(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const blocks = [];
  let inBlock = false;
  let startLine = 0;
  let buf = [];
  let skip = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock) {
      if (line.trimStart().startsWith('```pfdsl')) {
        // Check the immediately preceding non-blank line for nocheck annotation
        let prev = i - 1;
        while (prev >= 0 && lines[prev].trim() === '') prev--;
        skip = prev >= 0 && NOCHECK_RE.test(lines[prev]);
        inBlock = true;
        startLine = i + 1;
        buf = [];
      }
    } else if (line.trimStart().startsWith('```')) {
      if (!skip) {
        blocks.push({ startLine, content: buf.join('\n'), filePath });
      }
      inBlock = false;
      buf = [];
      skip = false;
    } else {
      buf.push(line);
    }
  }

  return blocks;
}

const args = process.argv.slice(2);
const defaultFiles = [
  'docs/spec/spec.md',
  ...execSync('git ls-files "docs/spec/proposals/*.md"', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean),
];
const files = args.length > 0 ? args : defaultFiles;

let totalBlocks = 0;
let failures = 0;

for (const file of files) {
  let blocks;
  try {
    blocks = extractBlocks(file);
  } catch (e) {
    console.error(`Error reading ${file}: ${e.message}`);
    process.exit(1);
  }

  for (const block of blocks) {
    totalBlocks++;
    const tmpPath = join(tmpdir(), `pfdsl-doc-check-${process.pid}-${totalBlocks}.pfdsl`);
    writeFileSync(tmpPath, block.content, 'utf8');
    const result = spawnSync('node', [CLI, 'check', tmpPath], { encoding: 'utf8' });
    unlinkSync(tmpPath);

    if (result.status !== 0) {
      failures++;
      console.error(`${file}:${block.startLine}: pfdsl block check FAILED`);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
  }
}

console.log(`check-doc-examples: checked ${totalBlocks} block(s) across ${files.length} file(s)`);
if (failures > 0) {
  console.error(`${failures} block(s) failed.`);
  process.exit(1);
}
console.log('check-doc-examples: OK');
