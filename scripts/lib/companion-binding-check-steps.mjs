/**
 * check-companion-bindings.mjs orchestration: three independent checks (dead
 * path references in .pfdsl/*.md companions, dead file-relative markdown links
 * across all of them, and the required headings of each binding in
 * REQUIRED_BINDING_HEADINGS that exists) merged into one errorCount and one
 * final exit-code branch, none of which was tested (#645) — only the pure
 * extractors/matchers in lib/companion-binding-check.mjs had tests.
 *
 * The two link checks differ in scope on purpose; see the comments on each
 * loop for which files they cover and why.
 *
 * `listFiles`/`readFile`/`exists` are injected, already bound to the repo
 * root by the caller (so callers pass root-relative paths, matching git
 * ls-files output), so a test can supply canned files/content/existence
 * without touching git or the filesystem.
 */

import { posix } from "node:path";

import {
	extractPathReferences,
	extractRelativeMarkdownLinks,
	findMissingHeadings,
	resolveCheckTarget,
} from "./companion-binding-check.mjs";

const REQUIRED_BINDING_HEADINGS = [
	{
		path: ".pfdsl/bindings/pfd-retro.md",
		headings: ["pfd-retro バインディング"],
		reason: "pfd-retro's audit protocol depends on it",
	},
	{
		path: ".pfdsl/bindings/pfd-ops.md",
		headings: ["ワークサイクルの追加手順"],
		reason: "pfd-ops' work cycle reads its repo-level steps from it",
	},
];

/**
 * @param {{
 *   listFiles: () => string[],
 *   readFile: (file: string) => string,
 *   exists: (path: string) => boolean,
 * }} deps
 * @returns {{exitCode: 0|1, stdoutLines: string[], stderrLines: string[]}}
 */
export function runCompanionBindingsCheck({ listFiles, readFile, exists }) {
	const allFiles = listFiles();
	// Historical cases preserve paths and evidence from their original revision.
	// Their current procedures live in the binding, which is still checked.
	const files = allFiles.filter(
		(file) => !file.startsWith(".pfdsl/bindings/pfd-retro-patterns/"),
	);
	const stderrLines = [];
	let errorCount = 0;

	// Relative links run over every file, the exempt cases included: the
	// exemption covers repo-relative references frozen at the revision a case
	// was written, while a link relative to the case itself points a reader at
	// a live document and has to keep resolving.
	for (const file of allFiles) {
		const dir = posix.dirname(file);
		for (const ref of extractRelativeMarkdownLinks(readFile(file))) {
			const target = posix.normalize(posix.join(dir, ref));
			if (!exists(target)) {
				stderrLines.push(
					`${file}: dead relative link \`${ref}\` (resolved: ${target})`,
				);
				errorCount++;
			}
		}
	}

	for (const file of files) {
		const text = readFile(file);
		for (const ref of extractPathReferences(text)) {
			const target = resolveCheckTarget(ref);
			if (target === null) continue; // placeholder, not a concrete path
			if (!exists(target)) {
				stderrLines.push(
					`${file}: dead path reference \`${ref}\` (resolved: ${target})`,
				);
				errorCount++;
			}
		}
	}

	for (const { path, headings, reason } of REQUIRED_BINDING_HEADINGS) {
		if (!exists(path)) continue;
		const text = readFile(path);
		for (const heading of findMissingHeadings(text, headings)) {
			stderrLines.push(
				`${path}: missing required heading "${heading}" (${reason})`,
			);
			errorCount++;
		}
	}

	if (errorCount > 0) {
		stderrLines.push(`\ncheck-companion-bindings: ${errorCount} error(s)`);
		return { exitCode: 1, stdoutLines: [], stderrLines };
	}
	return {
		exitCode: 0,
		stdoutLines: ["check-companion-bindings: all passed"],
		stderrLines: [],
	};
}
