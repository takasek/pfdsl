/**
 * check-md-linebreaks.mjs orchestration: the argv-vs-git-ls-files file list,
 * the per-file read loop, the violation-printing, and the `total > 0`
 * exit-code branch were untested (#645) — checkFile itself was untestable at
 * all before lib/md-linebreaks.mjs existed (see that file's header).
 *
 * `listFiles`/`readFile` are injected so a test can supply canned file lists
 * and contents without touching git or the filesystem.
 *
 * Returns an ordered `messages` array (one entry per original console call)
 * tagged with which stream it belongs to, so the top-level wrapper can
 * reproduce the exact original output without this module doing any
 * printing itself.
 */

import { checkFile } from "./md-linebreaks.mjs";

/**
 * @param {{args: string[], listFiles: () => string[], readFile: (file: string) => string}} deps
 * @returns {{exitCode: 0|1, messages: Array<{stream: "log"|"error", text: string}>}}
 */
export function runMdLinebreaksCheck({ args, listFiles, readFile }) {
	const files = args.length > 0 ? args : listFiles();

	const messages = [];
	let total = 0;
	for (const file of files) {
		let text;
		try {
			text = readFile(file);
		} catch (e) {
			return { exitCode: 1, messages: [{ stream: "error", text: `Error reading ${file}: ${e.message}` }] };
		}

		for (const v of checkFile(file, text)) {
			messages.push({ stream: "log", text: `${v.file}:${v.line}: mid-sentence line break` });
			messages.push({ stream: "log", text: `  prev: …${v.prev.slice(-80)}` });
			messages.push({ stream: "log", text: `  cont: ${v.cont.slice(0, 80)}` });
			total++;
		}
	}

	if (total > 0) {
		messages.push({ stream: "error", text: `\n${total} violation(s) found.` });
		return { exitCode: 1, messages };
	}
	messages.push({ stream: "log", text: "check-md-linebreaks: OK" });
	return { exitCode: 0, messages };
}
