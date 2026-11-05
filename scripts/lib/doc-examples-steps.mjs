/**
 * check-doc-examples.mjs orchestration: the file loop, the per-block
 * subprocess check (originally a direct spawnSync call), and the
 * failures-count + final exit-code branch were untested (#645). `exec` is
 * injected — it receives a block and returns `{status, stdout, stderr}`, the
 * shape of node:child_process's spawnSync result — so a test can supply
 * canned per-block results without writing temp files or spawning a real
 * process.
 *
 * Returns an ordered `messages` array (one entry per original console/stream
 * write) tagged with which stream it belongs to, so the top-level wrapper can
 * reproduce the exact original output without this module doing any printing
 * itself.
 */

import { extractBlocks } from "./doc-examples.mjs";

/**
 * @param {{
 *   files: string[],
 *   readFile: (file: string) => string,
 *   exec: (block: {startLine: number, content: string, filePath: string}) => {status: number, stdout?: string, stderr?: string},
 * }} deps
 * @returns {{exitCode: 0|1, messages: Array<{stream: "log"|"error"|"stdout"|"stderr", text: string}>}}
 */
export function runDocExamplesCheck({ files, readFile, exec }) {
	const messages = [];
	let totalBlocks = 0;
	let failures = 0;

	for (const file of files) {
		let text;
		try {
			text = readFile(file);
		} catch (e) {
			messages.push({
				stream: "error",
				text: `Error reading ${file}: ${e.message}`,
			});
			return { exitCode: 1, messages };
		}

		for (const block of extractBlocks(file, text)) {
			totalBlocks++;
			const result = exec(block);

			if (result.status !== 0) {
				failures++;
				messages.push({
					stream: "error",
					text: `${file}:${block.startLine}: pfdsl block check FAILED`,
				});
				if (result.stdout)
					messages.push({ stream: "stdout", text: result.stdout });
				if (result.stderr)
					messages.push({ stream: "stderr", text: result.stderr });
			}
		}
	}

	messages.push({
		stream: "log",
		text: `check-doc-examples: checked ${totalBlocks} block(s) across ${files.length} file(s)`,
	});
	if (failures > 0) {
		messages.push({ stream: "error", text: `${failures} block(s) failed.` });
		return { exitCode: 1, messages };
	}
	messages.push({ stream: "log", text: "check-doc-examples: OK" });
	return { exitCode: 0, messages };
}
