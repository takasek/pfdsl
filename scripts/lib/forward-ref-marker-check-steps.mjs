/**
 * check-forward-ref-markers.mjs orchestration: the argv-vs-git-ls-files file
 * list, the per-file read loop, and the resolved/none message branch were
 * untested (#645) — only the pure matchers in lib/forward-ref-marker-check.mjs
 * had tests. `listFiles`/`readFile` are injected so a test can supply canned
 * file lists and contents without touching git or the filesystem.
 *
 * Returns `{lines}` — one entry per top-level console.log call in the
 * original script — so the top-level wrapper can reproduce the exact output
 * (including the blank line the resolved-branch prints between its header and
 * its detail block) without this module doing any printing itself.
 */

import {
	findForwardRefMarkers,
	findImplementsMarkers,
	formatResolvedForwardRefs,
	matchResolvedForwardRefs,
} from "./forward-ref-marker-check.mjs";

/**
 * @param {{args: string[], listFiles: () => string[], readFile: (file: string) => string}} deps
 * @returns {{lines: string[]}}
 */
export function runForwardRefMarkerCheck({ args, listFiles, readFile }) {
	const files = args.length > 0 ? args : listFiles();

	const forwardRefHits = [];
	const implementsHits = [];
	for (const file of files) {
		const text = readFile(file);
		for (const hit of findForwardRefMarkers(text))
			forwardRefHits.push({ file, ...hit });
		for (const hit of findImplementsMarkers(text))
			implementsHits.push({ file, ...hit });
	}

	const resolved = matchResolvedForwardRefs(forwardRefHits, implementsHits);

	if (resolved.length > 0) {
		return {
			lines: [
				`check-forward-ref-markers: ${resolved.length} forward-ref marker(s) likely resolved — confirm and update the referenced text:\n`,
				formatResolvedForwardRefs(resolved),
			],
		};
	}
	return {
		lines: ["check-forward-ref-markers: no resolved forward-ref markers found"],
	};
}
