/**
 * check-spec-ids.mjs orchestration: the argv-vs-git-ls-files file list, the
 * per-file read loop, and the `duplicates.length > 0 || dangling.length > 0`
 * exit-code branch were untested (#645) — only the pure matchers in
 * lib/spec-id-check.mjs had tests. That `||` is the exact branch #645 calls
 * out as unverified: flipping it to `&&` would wrongly pass a file with
 * duplicates only or dangling refs only, since neither alone would satisfy an
 * `&&`. Tests below cover each independently for that reason.
 *
 * `listFiles`/`readFile` are injected so a test can supply canned file lists
 * and contents without touching git or the filesystem.
 */

import {
	findDanglingStrictRefs,
	findDuplicateDefinitions,
	findSpecIdDefinitions,
	findStrictRefs,
	formatSpecIdViolations,
} from "./spec-id-check.mjs";

/**
 * @param {{args: string[], listFiles: () => string[], readFile: (file: string) => string}} deps
 * @returns {{exitCode: 0|1, stdoutLines: string[], stderrLines: string[]}}
 */
export function runSpecIdCheck({ args, listFiles, readFile }) {
	const files = args.length > 0 ? args : listFiles();

	const definitionHits = [];
	const strictRefHits = [];
	for (const file of files) {
		const text = readFile(file);
		for (const hit of findSpecIdDefinitions(text))
			definitionHits.push({ file, ...hit });
		for (const hit of findStrictRefs(text))
			strictRefHits.push({ file, ...hit });
	}

	const duplicates = findDuplicateDefinitions(definitionHits);
	const dangling = findDanglingStrictRefs(strictRefHits, definitionHits);

	if (duplicates.length > 0 || dangling.length > 0) {
		return {
			exitCode: 1,
			stdoutLines: [],
			stderrLines: [
				`check-spec-ids: ${duplicates.length} duplicate definition(s), ${dangling.length} dangling strict reference(s):\n`,
				formatSpecIdViolations(duplicates, dangling),
			],
		};
	}
	return {
		exitCode: 0,
		stdoutLines: ["check-spec-ids: no violations found"],
		stderrLines: [],
	};
}
