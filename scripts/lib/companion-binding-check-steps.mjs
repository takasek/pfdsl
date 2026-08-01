/**
 * check-companion-bindings.mjs orchestration: two independent checks (dead
 * path references in .pfdsl/*.md companions, and a required heading in
 * .pfdsl/bindings/pfd-retro.md when it exists) merged into one errorCount and
 * one final exit-code branch, none of which was tested (#645) — only the pure
 * extractors/matchers in lib/companion-binding-check.mjs had tests.
 *
 * `listFiles`/`readFile`/`exists` are injected, already bound to the repo
 * root by the caller (so callers pass root-relative paths, matching git
 * ls-files output), so a test can supply canned files/content/existence
 * without touching git or the filesystem.
 */

import { extractPathReferences, findMissingHeadings, resolveCheckTarget } from "./companion-binding-check.mjs";

const REQUIRED_PFD_RETRO_BINDING_HEADINGS = ["pfd-retro バインディング"];
const PFD_RETRO_BINDING_PATH = ".pfdsl/bindings/pfd-retro.md";

/**
 * @param {{
 *   listFiles: () => string[],
 *   readFile: (file: string) => string,
 *   exists: (path: string) => boolean,
 * }} deps
 * @returns {{exitCode: 0|1, stdoutLines: string[], stderrLines: string[]}}
 */
export function runCompanionBindingsCheck({ listFiles, readFile, exists }) {
	const files = listFiles();
	const stderrLines = [];
	let errorCount = 0;

	for (const file of files) {
		const text = readFile(file);
		for (const ref of extractPathReferences(text)) {
			const target = resolveCheckTarget(ref);
			if (target === null) continue; // placeholder, not a concrete path
			if (!exists(target)) {
				stderrLines.push(`${file}: dead path reference \`${ref}\` (resolved: ${target})`);
				errorCount++;
			}
		}
	}

	if (exists(PFD_RETRO_BINDING_PATH)) {
		const text = readFile(PFD_RETRO_BINDING_PATH);
		for (const heading of findMissingHeadings(text, REQUIRED_PFD_RETRO_BINDING_HEADINGS)) {
			stderrLines.push(
				`${PFD_RETRO_BINDING_PATH}: missing required heading "${heading}" (pfd-retro's audit protocol depends on it)`,
			);
			errorCount++;
		}
	}

	if (errorCount > 0) {
		stderrLines.push(`\ncheck-companion-bindings: ${errorCount} error(s)`);
		return { exitCode: 1, stdoutLines: [], stderrLines };
	}
	return { exitCode: 0, stdoutLines: ["check-companion-bindings: all passed"], stderrLines: [] };
}
