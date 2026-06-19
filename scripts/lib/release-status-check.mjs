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
 * @param {Array<{name: string, registry: string, localVersion: string, publishedVersion: string, status: string}>} results
 * @returns {string}
 */
export function formatResults(results) {
	return results
		.map(({ name, registry, localVersion, publishedVersion, status }) => {
			const label =
				status === "local-ahead"
					? "! behind (needs publish)"
					: status === "published-ahead"
						? "! published-ahead (unexpected)"
						: status === "error"
							? "! error"
							: "✓ up-to-date";
			return `  ${name.padEnd(24)} local=${localVersion}  ${registry}=${publishedVersion}  ${label}`;
		})
		.join("\n");
}
