#!/usr/bin/env node
// Common repository hook bootstrap. Script location selects the code host;
// ordinary hooks retain the harness cwd and receive stdin unchanged.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [target, ...extra] = process.argv.slice(2);
const fail = (message) => {
	console.error(`[pfdsl] ${message}`);
	process.exit(2);
};
const execute = (command, args, cwd) =>
	spawnSync(command, args, { cwd, stdio: "inherit" }).status === 0;

if (!existsSync(`${root}.git`)) fail("repository hook root is unavailable");
if (extra.length || !target) fail("repository hook target is invalid");

if (target === "--setup") {
	const check = `${root}scripts/setup-completion.mjs`;
	if (!existsSync(check)) fail("repository hook failed to run");
	if (!execute(process.execPath, [check, "check"], root)) {
		console.log(
			"[pfdsl] setup completion marker is missing or stale in this worktree - running make setup",
		);
		if (!execute("make", ["setup"], root))
			fail("repository hook failed to run");
	}
} else {
	if (!/^(scripts|hooks)\/[\w-]+\.mjs$/.test(target))
		fail("repository hook target is invalid");
	if (!execute(process.execPath, [`${root}${target}`]))
		fail("repository hook failed to run");
}
