// Gives ADR-0029 (adoption-day probe) the operating trigger it was accepted
// without. The method was decided in 2026-07, run once, and then slept: nothing
// in the skills, companions, scripts, CI or Makefile referenced it, which is
// the "dormant capability" shape the retro D-layer audits for.
//
// The trigger is the publish boundary, not the cycle boundary. Adopters are
// only exposed when a bundle ships, publishes are rare, and a rare gate does
// not create pressure to satisfy it with a shallow run — the failure mode a
// per-cycle requirement would have had.
//
// Scope note: the probe's observation 1 (grep the tree for repo-local-only
// paths) is the observation with a hit on record — it is what caught #417,
// while the fresh-agent observation reported the same run as completed and
// missed it. That rule now runs on every CI as check-bundle-paths. What this
// gate keeps alive is the rest: guidance executability and idempotency, which
// no static check reaches.

/** Newest `対象バージョン: ... vX.Y.Z` recorded in the probe log. */
export function latestProbedVersion(logText) {
	const versions = [...logText.matchAll(/対象バージョン:[^\n]*?v(\d+)\.(\d+)\.(\d+)/g)].map((m) =>
		[m[1], m[2], m[3]].map(Number),
	);
	if (versions.length === 0) return undefined;
	return versions.sort(compare).at(-1);
}

/** @param {number[]} a @param {number[]} b */
function compare(a, b) {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** @param {string} v e.g. "0.0.24" */
export function parseVersion(v) {
	const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
	return m ? [m[1], m[2], m[3]].map(Number) : undefined;
}

/**
 * The probe must cover what adopters already hold. Shipping one release after
 * a probe is fine; shipping a second means the bundle in the wild has never
 * been walked end to end.
 *
 * @param {string} logText contents of the probe execution log
 * @param {string} publishedVersion the plugin version adopters currently get
 * @returns {{ok: boolean, probed?: string, published: string, reason?: string}}
 */
export function checkProbeCurrency(logText, publishedVersion) {
	const published = parseVersion(publishedVersion);
	if (!published) throw new Error(`unparseable published version: ${publishedVersion}`);
	const probed = latestProbedVersion(logText);
	if (!probed) {
		return { ok: false, published: publishedVersion, reason: "the probe log records no run" };
	}
	const fmt = probed.join(".");
	if (compare(probed, published) < 0) {
		return {
			ok: false,
			probed: fmt,
			published: publishedVersion,
			reason: `the newest probe covers v${fmt}, but adopters already hold v${publishedVersion}`,
		};
	}
	return { ok: true, probed: fmt, published: publishedVersion };
}
