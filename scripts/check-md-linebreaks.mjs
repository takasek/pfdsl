#!/usr/bin/env node
/**
 * check-md-linebreaks.mjs
 *
 * Detects mid-sentence line breaks in markdown prose and list-item continuations.
 * A line break is a violation when the preceding line does not end at a sentence
 * boundary (Japanese punctuation 。、！？…, English .!?:, or closing brackets).
 *
 * Skips:
 *   - fenced code blocks (``` or ~~~)
 *   - sub-bullet lines (the continuation itself starts with a list marker)
 *   - continuations preceded by a blank line (indented code block / loose list para)
 *
 * Usage:
 *   node scripts/check-md-linebreaks.mjs [files...]
 *   (no args → all git-tracked *.md files)
 *
 * Exit 0 = clean, Exit 1 = violations found.
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const BOUNDARY = new Set([...'。！？」』）…～.!?:*']);
const CLOSE = new Set([...'`])}'  ]);
const LIST_RE = /^(\s*)([-*+]|\d+[.)]) /;

function endsAtBoundary(line) {
  const r = line.trimEnd();
  if (!r) return true;
  const c = r[r.length - 1];
  return BOUNDARY.has(c) || CLOSE.has(c);
}

function checkFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const violations = [];
  let inFence = false;
  // Track YAML frontmatter (--- ... ---)
  let inFrontmatter = lines[0]?.trim() === '---';

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trimStart();

    // Close frontmatter on second ---
    if (inFrontmatter) {
      if (stripped === '---') inFrontmatter = false;
      continue;
    }

    // Fence delimiters toggle state and are skipped themselves
    if (stripped.startsWith('```') || stripped.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Only check indented continuation lines that are not list markers
    if (!line || line[0] !== ' ' || !stripped || LIST_RE.test(stripped)) continue;

    const prev = lines[i - 1];

    // Blank line before → indented code block or loose list paragraph; skip
    if (!prev || !prev.trim()) continue;

    if (!endsAtBoundary(prev)) {
      violations.push({
        file: filePath,
        line: i + 1,
        prev: prev.trimEnd(),
        cont: stripped,
      });
    }
  }

  return violations;
}

const args = process.argv.slice(2);
const files = args.length > 0
  ? args
  : execSync('git ls-files "*.md"', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

let total = 0;
for (const file of files) {
  let violations;
  try {
    violations = checkFile(file);
  } catch (e) {
    console.error(`Error reading ${file}: ${e.message}`);
    process.exit(1);
  }
  for (const v of violations) {
    console.log(`${v.file}:${v.line}: mid-sentence line break`);
    console.log(`  prev: …${v.prev.slice(-80)}`);
    console.log(`  cont: ${v.cont.slice(0, 80)}`);
    total++;
  }
}

if (total > 0) {
  console.error(`\n${total} violation(s) found.`);
  process.exit(1);
}
console.log('check-md-linebreaks: OK');
