// Decides whether a Bash command is about to trust a stale build.
//
// Switching branches in the same checkout leaves dist/ as the previous
// branch built it. `pnpm -r typecheck` resolves cross-package imports
// through those dist/ type declarations, so a reference added on the new
// branch can typecheck locally and fail in CI, which builds first (#642).
// The same applies to a test run that imports a sibling package's build.
//
// This is advisory: it prints what is stale and lets the command run. A
// guard that blocked here would be wrong as often as it was right — reading
// a stale build on purpose is a normal thing to do while debugging.

/** Commands that resolve cross-package imports through dist/. */
const TRUSTS_BUILD_OUTPUT =
	/\b(typecheck|tsgo|vitest|node --test)\b|\b(pnpm|npm|yarn)\b[^&|;]*\btest\b/;

/** A build step in the same command line means the staleness is about to be fixed. */
const REBUILDS_FIRST = /\bbuild\b/;

/**
 * Whether this command should be checked against build freshness at all.
 * @param {string} command
 * @returns {boolean}
 */
export function trustsBuildOutput(command) {
	if (typeof command !== "string") return false;
	if (REBUILDS_FIRST.test(command)) return false;
	return TRUSTS_BUILD_OUTPUT.test(command);
}

/**
 * The packages whose build output is older than their sources.
 * `isStale` is injected so this is testable without a filesystem — the hook
 * passes lib/dist-freshness.mjs' isDistStale.
 * @param {Array<{name: string, distFile: string}>} packages
 * @param {(distFile: string) => boolean} isStale
 * @returns {string[]} names, in the order given
 */
export function stalePackages(packages, isStale) {
	return packages.filter((p) => isStale(p.distFile)).map((p) => p.name);
}

/**
 * The advisory text, or undefined when nothing is stale. Names the packages
 * rather than saying "something is stale" so the reader can tell at a glance
 * whether the ones they care about are involved.
 * @param {string[]} stale
 * @returns {string | undefined}
 */
export function formatStaleWarning(stale) {
	if (stale.length === 0) return undefined;
	const subject =
		stale.length === 1
			? `${stale[0]} has a build older than its sources`
			: `${stale.join(", ")} have builds older than their sources`;
	return (
		`note: ${subject}. ` +
		"Cross-package types and imports resolve through dist/, so this run can pass here and fail in CI. " +
		"Run 'pnpm -r build' first if the result is meant to predict CI."
	);
}
