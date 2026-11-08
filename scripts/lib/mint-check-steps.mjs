/**
 * mint-check.mjs orchestration: argv-defaulting, the per-file read loop, and
 * the exit-code/message branch were untested (#645) — only the pure finders
 * in lib/mint-check.mjs had tests. lib/mint-check.mjs documents itself as
 * I/O-free, so this sibling file holds the injectable, I/O-shaped wrapper
 * instead of putting it there.
 *
 * `listFiles` and `readFile` are injected so a test can supply tracked paths
 * and canned file contents without touching git or the filesystem.
 */

import {
	findOccurrencesInText,
	formatOccurrences,
	mintCheckExitCode,
	normalizeId,
} from "./mint-check.mjs";

const USAGE = "usage: node scripts/mint-check.mjs <slug> [files...]";

/**
 * @param {{slugArg?: string, fileArgs: string[], listFiles: () => string[], readFile: (file: string) => string}} args
 * @returns {{exitCode: 0|1|2, stdout: string|null, stderr: string}}
 */
export function runMintCheck({ slugArg, fileArgs, listFiles, readFile }) {
	if (!slugArg) {
		return { exitCode: 2, stdout: null, stderr: USAGE };
	}

	const id = normalizeId(slugArg);
	const files = fileArgs.length > 0 ? fileArgs : listFiles();
	if (files.length === 0) {
		// An empty corpus would report every slug as safe to mint.
		return {
			exitCode: 2,
			stdout: null,
			stderr:
				"mint-check: no docs/**/*.md files to scan — run inside the repository or pass files explicitly.",
		};
	}

	const occurrences = [];
	for (const file of files) {
		const text = readFile(file);
		occurrences.push(...findOccurrencesInText(id, file, text));
	}

	const exitCode = mintCheckExitCode(occurrences);
	if (exitCode === 0) {
		return {
			exitCode,
			stdout: null,
			stderr: `mint-check: "${id}" has no prior occurrence — safe to mint.`,
		};
	}
	return {
		exitCode,
		stdout: formatOccurrences(occurrences),
		stderr: `mint-check: "${id}" already occurs ${occurrences.length} time(s) — resolve before minting.`,
	};
}
