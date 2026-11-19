#!/usr/bin/env node
// Check current references outside the specification's Markdown corpus.
// No arguments: inspect tracked authoring inputs. Explicit files let callers
// validate a draft without enrolling it in the tracked source corpus.
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gitLsFiles } from "./lib/run-exec.mjs";
import { findSpecIdDefinitions } from "./lib/spec-id-check.mjs";
import {
	checkExternalSpecReferences,
	selectSpecReferenceSources,
} from "./lib/spec-reference-check.mjs";

try {
	const { positionals } = parseArgs({ allowPositionals: true, strict: true });
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const tracked = gitLsFiles([], { cwd: root });
	const definitionFiles = tracked.filter((file) => /^docs\/.*\.md$/.test(file));
	const definitions = definitionFiles.flatMap((file) =>
		findSpecIdDefinitions(readFileSync(resolve(root, file), "utf8")).map(
			(definition) => ({ ...definition, file }),
		),
	);
	const files = positionals.length
		? positionals
		: selectSpecReferenceSources(tracked);
	if (!definitions.length || !files.length)
		throw new Error(
			"No specification definitions or reference sources to check.",
		);
	const sources = files.map((file) => ({
		file: positionals.length
			? relative(root, resolve(file)).split(sep).join("/")
			: file,
		text: readFileSync(positionals.length ? file : resolve(root, file), "utf8"),
	}));
	const result = checkExternalSpecReferences(sources, definitions);
	if (result.violations.length) {
		console.error(result.violations.join("\n"));
		process.exitCode = 1;
	} else {
		console.log(
			`check-spec-references: OK (${files.length} sources, ${result.references} ID references, ${result.literals} literal lines)`,
		);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 2;
}
