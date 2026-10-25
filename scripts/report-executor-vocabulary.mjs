#!/usr/bin/env node
/** Advisory report; findings never fail CI. Input errors still fail. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findExecutorVocabulary } from "./lib/distributed-prose.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPaths = [
	"scripts/harness-template/skills/pfd-ops/references/work-cycle.md",
];

try {
	const { values, positionals: paths } = parseArgs({
		options: { json: { type: "boolean", default: false } },
		allowPositionals: true,
		strict: true,
	});
	const selected = [...new Set(paths.length ? paths : defaultPaths)];
	const files = selected.map((path) => ({
		path,
		content: readFileSync(
			resolve(paths.length ? process.cwd() : root, path),
			"utf8",
		),
	}));
	const findings = findExecutorVocabulary(files);
	if (values.json)
		console.log(JSON.stringify({ files: selected, findings }, null, 2));
	else {
		for (const item of findings)
			console.log(
				`${item.path}:${item.line}:${item.column}: [${item.terms.join(", ")}] ${item.text}`,
			);
		console.log(
			`Executor vocabulary: ${findings.length} candidate sentence(s) in ${files.length} file(s). Advisory only; review meaning manually.`,
		);
	}
} catch (error) {
	console.error(`Executor vocabulary report: ${error.message}`);
	process.exitCode = 1;
}
