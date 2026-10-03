#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	classifyTrackedPfdsl,
	pfdslCheckPlan,
} from "./lib/pfdsl-check-inventory.mjs";
import { splitNulSeparated, tryRun } from "./lib/run-exec.mjs";

try {
	const { values } = parseArgs({
		options: { run: { type: "string" }, json: { type: "boolean" } },
		strict: true,
		allowPositionals: false,
	});
	const cwd = process.cwd();
	const listing = tryRun("git", ["ls-files", "-z"], {
		cwd,
		captureStderr: true,
	});
	if (!listing.ok)
		throw new Error(`could not enumerate tracked files: ${listing.out}`);
	const inventory = classifyTrackedPfdsl(splitNulSeparated(listing.out));
	if (inventory.errors.length) throw new Error(inventory.errors.join("\n"));
	if (values.json) console.log(JSON.stringify(inventory, null, 2));
	else
		console.log(
			`pfdsl inventory: ${inventory.entries.length} tracked file(s) classified; use --json for assignments`,
		);
	if (values.run) {
		const plan = pfdslCheckPlan(inventory, values.run);
		for (const { path, args } of plan) {
			console.log(args.join(" "));
			const result = tryRun(
				process.execPath,
				[resolve(cwd, "packages/cli/dist/cli.js"), ...args],
				{ cwd, captureStderr: true },
			);
			if (!result.ok) throw new Error(`${path}: ${result.out}`);
			if (args[0] !== "render" && result.out.trim())
				console.log(result.out.trim());
		}
		console.log(`${values.run}: all passed (${plan.length} check(s))`);
	}
} catch (error) {
	console.error(`pfdsl inventory: ${error.message}`);
	process.exitCode = 1;
}
