/**
 * check-companion-bindings.mjs orchestration: three independent checks (dead
 * file-relative markdown links within .pfdsl/, dead repo-relative path
 * references in the companions outside the case store, and the required
 * headings of each binding in REQUIRED_BINDING_HEADINGS that exists) merged
 * into one errorCount and one final exit-code branch, none of which was tested
 * (#645) — only the pure extractors/matchers in lib/companion-binding-check.mjs
 * had tests.
 *
 * The two link checks partition targets by where each one resolves; see the
 * comments inside the loop for the boundary and why it sits there.
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

// The tree listFiles draws from. A relative link resolving outside it has left
// the companions behind and belongs to the dead-path check's territory.
const COMPANION_ROOT = ".pfdsl";
const CASE_STORE = ".pfdsl/bindings/pfd-retro-patterns";

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
	const stderrLines = [];
	let errorCount = 0;

	for (const file of listFiles()) {
		const text = readFile(file);
		const dir = posix.dirname(file);

		// Relative links are checked everywhere, the exempt cases included: a
		// link resolving to another companion points a reader at a live
		// document, not at the frozen repo paths the exemption below covers.
		// The split is by where a target lands, not by how it was spelled — a
		// repo path written `../../../docs/x.md` is still a repo path, and in a
		// case file it is exactly the frozen evidence the exemption protects.
		for (const ref of extractRelativeMarkdownLinks(text)) {
			const target = posix.join(dir, ref);
			if (!target.startsWith(`${COMPANION_ROOT}/`)) continue;
			if (!exists(target)) {
				stderrLines.push(
					`${file}: dead relative link \`${ref}\` (resolved: ${target})`,
				);
				errorCount++;
			}
		}

		// Historical cases preserve paths and evidence from their original
		// revision. Their current procedures live in the binding, which is
		// still checked.
		if (file.startsWith(`${CASE_STORE}/`)) continue;

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
