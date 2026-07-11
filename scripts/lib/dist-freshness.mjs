#!/usr/bin/env node
// Checks whether a dist file (e.g. packages/cli/dist/cli.js) is stale
// relative to its sibling src/ directory (packages/cli/src/), so drift
// checks in scripts/pre-commit can skip instead of trusting a leftover
// build from before a source change (see #450).
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

function newestMtimeUnder(dir) {
	let newest = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		const mtime = entry.isDirectory()
			? newestMtimeUnder(full)
			: statSync(full).mtimeMs;
		if (mtime > newest) newest = mtime;
	}
	return newest;
}

// distFile is stale if it's missing, or older than the newest file under
// its sibling src/ directory. Fresh (false) if src/ doesn't exist to
// compare against, since there's nothing to detect drift from.
export function isDistStale(distFile) {
	if (!existsSync(distFile)) return true;
	const srcDir = join(dirname(dirname(distFile)), "src");
	if (!existsSync(srcDir)) return false;
	return statSync(distFile).mtimeMs < newestMtimeUnder(srcDir);
}

// CLI mode: exit 0 if fresh, 1 if stale/absent. Usage: node dist-freshness.mjs <distFile>
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	const distFile = process.argv[2];
	process.exit(isDistStale(distFile) ? 1 : 0);
}
