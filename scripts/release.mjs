#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import { parseReleaseArgs } from "./lib/release-config.mjs";
import { prepareRelease, publishRelease } from "./lib/release-runner.mjs";
import { acquireConfiguredRoadmap } from "./lib/roadmap-consumer.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Run one release phase. Argument parsing happens before the runner receives
 * the repository root, so malformed invocations cannot run Git or a build.
 * @param {string[]} args
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(args = process.argv.slice(2), deps = {}) {
	let roadmap;
	try {
		const parsed = parseReleaseArgs(args);
		const options = { root, kindArg: parsed.kindArg, ...deps };
		if (parsed.phase === "prepare") {
			prepareRelease({ ...options, version: parsed.version });
		} else {
			if (parsed.sourceConfig !== undefined)
				roadmap = await acquireConfiguredRoadmap({
					root: options.root,
					sourceConfig: parsed.sourceConfig,
				});
			publishRelease({ ...options, commit: parsed.commit, roadmap });
		}
		return 0;
	} catch (error) {
		console.error(
			`error: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	} finally {
		roadmap?.dispose();
	}
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	process.exitCode = await main();
}
