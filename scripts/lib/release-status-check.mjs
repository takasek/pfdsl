/**
 * Pure functions for release-status comparison and formatting.
 * Network I/O lives in the main script; this module stays testable.
 */

/** @returns {'equal' | 'local-ahead' | 'published-ahead'} */
export function compareVersions(local, published) {
	const parse = (v) => v.split(".").map(Number);
	const [lMaj, lMin, lPat] = parse(local);
	const [pMaj, pMin, pPat] = parse(published);
	if (lMaj !== pMaj) return lMaj > pMaj ? "local-ahead" : "published-ahead";
	if (lMin !== pMin) return lMin > pMin ? "local-ahead" : "published-ahead";
	if (lPat !== pPat) return lPat > pPat ? "local-ahead" : "published-ahead";
	return "equal";
}

/**
 * @param {Array<{name: string, registry: string, localVersion: string, publishedVersion: string, status: string, commitsAhead?: number}>} results
 * @returns {string}
 */
export function formatResults(results) {
	return results
		.map(({ name, registry, localVersion, publishedVersion, status, commitsAhead }) => {
			let label;
			if (status === "local-ahead") {
				label = "! behind (needs publish)";
			} else if (status === "published-ahead") {
				label = "! published-ahead (unexpected)";
			} else if (status === "error") {
				label = "! error";
			} else if (commitsAhead > 0) {
				label = `! commits-ahead (${commitsAhead} commit(s), needs version bump)`;
			} else {
				label = "✓ up-to-date";
			}
			return `  ${name.padEnd(24)} local=${localVersion}  ${registry}=${publishedVersion}  ${label}`;
		})
		.join("\n");
}

/**
 * .claude/skills and .claude/commands are bundled into @pfdsl/cli's dist at
 * build time and only reach adopting repos via a CLI release — editing them
 * doesn't show up as a packages/cli/package.json change, so the ordinary
 * commits-ahead check misses this drift. sinceTag is null when no CLI tag
 * exists yet (nothing to compare against, so nothing to report).
 * @param {number} commitCount
 * @param {string | null} sinceTag
 * @returns {string}
 */
export function formatSkillBundleStatus(commitCount, sinceTag) {
	const name = "@pfdsl/cli bundle (.claude/skills, .claude/commands)";
	if (commitCount > 0) {
		return `  ${name} ! commits-ahead (${commitCount} commit(s) since ${sinceTag}, needs CLI release)`;
	}
	const suffix = sinceTag ? ` (no changes since ${sinceTag})` : "";
	return `  ${name} ✓ up-to-date${suffix}`;
}
