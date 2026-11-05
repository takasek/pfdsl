#!/usr/bin/env node
// Verify the complete generator contract without regenerating the checkout.
// Usage: node scripts/check-generation.mjs --gen-plugin <consumer> [--samples]
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { genPluginDriftPathspecs } from "./lib/gen-plugin-outputs.mjs";
import { withIndexSnapshot } from "./lib/index-snapshot.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let isolated = false;
function run(cwd, argv, env) {
	const result = spawnSync(process.execPath, argv, {
		cwd,
		env,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			"Generation verification failed. Follow the preceding diagnostics; if outputs are stale, regenerate them, review the diff, and commit the intended files before retrying.",
		);
}
try {
	const { values } = parseArgs({
		options: {
			"gen-plugin": { type: "string" },
			samples: { type: "boolean" },
		},
		strict: true,
	});
	if (!values["gen-plugin"])
		throw new Error(
			"Usage: check-generation.mjs --gen-plugin <consumer> [--samples]",
		);
	const paths = genPluginDriftPathspecs(values["gen-plugin"]);
	if (values.samples) paths.push("docs/samples", "docs/examples");
	const committed =
		values["gen-plugin"] === "push" || values["gen-plugin"] === "release";
	// Terminal/push/release inspect pending output edits too; unlike pre-commit
	// these entrances must not silently ignore an unstaged generated edit.
	run(root, ["scripts/check-generated-drift.mjs", "--", ...paths], process.env);
	if (committed) {
		const pending = spawnSync(
			"git",
			["diff", "--quiet", "HEAD", "--", ...paths],
			{ cwd: root, encoding: "utf8" },
		);
		if (pending.error) throw pending.error;
		if (pending.status !== 0)
			throw new Error(
				pending.status === 1
					? "Generated outputs differ from HEAD. Commit the intended changes before retrying."
					: pending.stderr,
			);
	}
	withIndexSnapshot(
		root,
		(snapshot, env) => {
			isolated = true;
			run(snapshot, ["scripts/gen-plugin.mjs"], env);
			if (values.samples) run(snapshot, ["scripts/gen-samples.mjs"], env);
			run(
				snapshot,
				[
					"scripts/check-generated-drift.mjs",
					"--gen-plugin",
					values["gen-plugin"],
				],
				env,
			);
			if (values.samples)
				run(
					snapshot,
					[
						"scripts/check-generated-drift.mjs",
						"--",
						"docs/samples",
						"docs/examples",
					],
					env,
				);
		},
		process.env,
		{ committed },
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	if (isolated)
		console.error(
			"The preceding generator diagnostics refer to an isolated checkout. Isolated verification data are discarded; the original checkout is unchanged. Existing recovery data in the original checkout remain preserved.",
		);
	process.exit(1);
}
