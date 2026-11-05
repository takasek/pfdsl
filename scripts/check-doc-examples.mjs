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

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runDocExamplesCheck } from "./lib/doc-examples-steps.mjs";
import { gitLsFiles } from "./lib/run-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "packages", "cli", "dist", "cli.js");

const args = process.argv.slice(2);
const defaultFiles = [
	"docs/spec/spec.md",
	...gitLsFiles(["docs/spec/proposals/*.md"]),
];
const files = args.length > 0 ? args : defaultFiles;

let blockCounter = 0;
const exec = (block) => {
	blockCounter++;
	const tmpPath = join(
		tmpdir(),
		`pfdsl-doc-check-${process.pid}-${blockCounter}.pfdsl`,
	);
	writeFileSync(tmpPath, block.content, "utf8");
	const result = spawnSync("node", [CLI, "check", tmpPath], {
		encoding: "utf8",
	});
	unlinkSync(tmpPath);
	return result;
};

const { exitCode, messages } = runDocExamplesCheck({
	files,
	readFile: (file) => readFileSync(file, "utf8"),
	exec,
});

for (const { stream, text } of messages) {
	if (stream === "log") console.log(text);
	else if (stream === "error") console.error(text);
	else if (stream === "stdout") process.stdout.write(text);
	else if (stream === "stderr") process.stderr.write(text);
}
process.exit(exitCode);
