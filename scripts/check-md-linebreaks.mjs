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
import { git } from "./lib/run-exec.mjs";
import { runMdLinebreaksCheck } from "./lib/md-linebreaks-steps.mjs";

const args = process.argv.slice(2);
const listFiles = () => git(["ls-files", "*.md"]).trim().split('\n').filter(Boolean);

const { exitCode, messages } = runMdLinebreaksCheck({
  args,
  listFiles,
  readFile: (file) => readFileSync(file, 'utf8'),
});
for (const { stream, text } of messages) {
  if (stream === 'log') console.log(text);
  else console.error(text);
}
process.exit(exitCode);
