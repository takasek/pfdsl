// Checks whether a dist file (e.g. packages/cli/dist/cli.js) is stale
// relative to its sibling src/ directory (packages/cli/src/), so the drift
// gates in scripts/check-drift-gates.mjs can skip instead of trusting a
// leftover build from before a source change (see #450), and so the hook in
// scripts/stale-dist-guard.mjs can warn about one (#642). scripts/pre-commit
// had checks of its own that asked the same question in sh; they moved into
// the drift gates script (#755, #759).
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

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
//
// The path must be absolute. A relative one would be resolved against
// process.cwd(), so a caller started from another directory asked about a
// dist file under *that* tree, found nothing, and read "stale" — which the
// drift gates spell as "skip this check and say so", printing a note and
// exiting 0 (#771). Refusing is what makes that impossible: a call site that
// forgets to resolve now crashes, where before it read as a passing run.
export function isDistStale(distFile) {
	if (!isAbsolute(distFile)) {
		throw new Error(
			`isDistStale needs an absolute path, got: ${distFile}. Resolve it against the repository root before asking.`,
		);
	}
	if (!existsSync(distFile)) return true;
	const srcDir = join(dirname(dirname(distFile)), "src");
	if (!existsSync(srcDir)) return false;
	return statSync(distFile).mtimeMs < newestMtimeUnder(srcDir);
}
