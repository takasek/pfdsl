/**
 * check-spec-ids.mjs orchestration: the argv-vs-git-ls-files file list, the
 * per-file read loop, and independent failure branches are tested separately
 * from the pure matchers in lib/spec-id-check.mjs (#645). Each violation kind
 * must fail on its own, including block ownership and bare section references.
 *
 * `listFiles`/`readFile` are injected so a test can supply canned file lists
 * and contents without touching git or the filesystem.
 */

import {
	findBareSectionReferences,
	findDanglingStrictRefs,
	findDuplicateDefinitions,
	findMultipleIdsOnBlock,
	findSpecIdDefinitions,
	findStrictRefs,
	formatSpecIdViolations,
} from "./spec-id-check.mjs";

/**
 * @param {{args: string[], listFiles: () => string[], readFile: (file: string) => string}} deps
 * @returns {{exitCode: 0|1|2, stdoutLines: string[], stderrLines: string[]}}
 */
export function runSpecIdCheck({ args, listFiles, readFile }) {
	const files = args.length > 0 ? args : listFiles();
	if (files.length === 0) {
		// An empty corpus would pass every check.
		return {
			exitCode: 2,
			stdoutLines: [],
			stderrLines: [
				"check-spec-ids: no docs/**/*.md files to scan — run inside the repository or pass files explicitly.",
			],
		};
	}

	const definitionHits = [];
	const strictRefHits = [];
	const fileViolations = [];
	let multipleIdBlocks = 0;
	let bareSectionReferences = 0;
	for (const file of files) {
		const text = readFile(file);
		for (const hit of findMultipleIdsOnBlock(text)) {
			multipleIdBlocks++;
			fileViolations.push(
				`multiple ids on one block at ${file}:${hit.line}: ${hit.ids.join(", ")}`,
			);
		}
		for (const hit of findBareSectionReferences(text)) {
			bareSectionReferences++;
			fileViolations.push(
				`bare section reference §${hit.section} at ${file}:${hit.line} — section ${hit.section} has id ${hit.id}; use [[${hit.id}]]`,
			);
		}
		for (const hit of findSpecIdDefinitions(text))
			definitionHits.push({ file, ...hit });
		for (const hit of findStrictRefs(text))
			strictRefHits.push({ file, ...hit });
	}

	const duplicates = findDuplicateDefinitions(definitionHits);
	const dangling = findDanglingStrictRefs(strictRefHits, definitionHits);

	if (
		duplicates.length > 0 ||
		dangling.length > 0 ||
		fileViolations.length > 0
	) {
		return {
			exitCode: 1,
			stdoutLines: [],
			stderrLines: [
				`check-spec-ids: ${duplicates.length} duplicate definition(s), ${dangling.length} dangling strict reference(s), ${multipleIdBlocks} block(s) with multiple ids, ${bareSectionReferences} bare section reference(s):\n`,
				[formatSpecIdViolations(duplicates, dangling), ...fileViolations]
					.filter(Boolean)
					.join("\n"),
			],
		};
	}
	return {
		exitCode: 0,
		stdoutLines: ["check-spec-ids: no violations found"],
		stderrLines: [],
	};
}
