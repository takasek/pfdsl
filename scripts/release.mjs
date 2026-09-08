#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import { parseReleaseArgs } from "./lib/release-config.mjs";
import { prepareRelease, publishRelease } from "./lib/release-runner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Run one release phase. Argument parsing happens before the runner receives
 * the repository root, so malformed invocations cannot run Git or a build.
 * @param {string[]} args
 * @param {object} [deps]
 * @returns {number}
 */
export function main(args = process.argv.slice(2), deps = {}) {
	try {
		const parsed = parseReleaseArgs(args);
		const options = { root, kindArg: parsed.kindArg, ...deps };
		if (parsed.phase === "prepare") {
			prepareRelease({ ...options, version: parsed.version });
		} else {
			publishRelease({ ...options, commit: parsed.commit });
		}
		return 0;
	} catch (error) {
		console.error(
			`error: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	}
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	process.exitCode = main();
}
