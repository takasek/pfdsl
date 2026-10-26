#!/usr/bin/env node
// Pre-cutover preparation against local fixture/previously acquired repositories.
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareEdit } from "./lib/wiki-roadmap-edit.mjs";
import { acquire } from "./lib/wiki-roadmap-spike.mjs";

const names = [
	"repo",
	"wiki",
	"repo-revision",
	"expected-wiki-revision",
	"expected-page-hash",
	"replacement",
	"output",
];
let snapshot;
try {
	const { values } = parseArgs({
		options: Object.fromEntries(
			names.map((name) => [name, { type: "string" }]),
		),
	});
	if (names.some((name) => !values[name]))
		throw new Error(
			`Required options: ${names.map((name) => `--${name}`).join(" ")}`,
		);
	snapshot = acquire({
		repo: values.repo,
		wiki: values.wiki,
		repoRevision: values["repo-revision"],
	});
	const result = prepareEdit({
		snapshot,
		expectedRevision: values["expected-wiki-revision"],
		expectedPageHash: values["expected-page-hash"],
		replacement: readFileSync(values.replacement, "utf8"),
		output: resolve(values.output),
		cli: resolve(import.meta.dirname, "../packages/cli/dist/cli.js"),
	});
	console.log(JSON.stringify(result, null, 2));
} catch (error) {
	console.error(String(error.stderr || error.message));
	process.exitCode = 1;
} finally {
	if (snapshot) rmSync(snapshot.root, { recursive: true, force: true });
}
