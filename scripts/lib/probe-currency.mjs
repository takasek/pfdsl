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

import { compareVersions } from "./release-status-check.mjs";

const SEMVER = /^v?(\d+\.\d+\.\d+)$/;
const LABEL = /対象バージョン:[^\n]*/g;

/**
 * Newest version recorded in the probe log, as "X.Y.Z".
 *
 * The version has to sit on the label's own line. Reading across lines instead
 * would let a label with no version silently borrow the next entry's, which
 * reads as "probe is current" — the one direction this gate must never fail in.
 * A label without a version is therefore an error, not a skip.
 *
 * @param {string} logText
 * @returns {string | undefined} undefined when the log records no run at all
 */
export function latestProbedVersion(logText) {
	const labels = logText.match(LABEL) ?? [];
	const versions = labels.map((line) => /v(\d+\.\d+\.\d+)/.exec(line)?.[1]);
	const bare = versions.findIndex((v) => !v);
	if (bare !== -1) {
		throw new Error(
			`probe log line records no vX.Y.Z on the label's own line: ${labels[bare].trim()}`,
		);
	}
	if (versions.length === 0) return undefined;
	return versions.sort((a, b) => (compareVersions(a, b) === "local-ahead" ? 1 : -1)).at(-1);
}

/**
 * The probe must cover what adopters already hold. Shipping one release after
 * a probe is fine; shipping a second means the bundle in the wild has never
 * been walked end to end.
 *
 * @param {string} logText contents of the probe execution log
 * @param {string} publishedVersion the plugin version adopters currently get
 * @returns {{ok: true, probed: string} | {ok: false, reason: string}}
 */
export function checkProbeCurrency(logText, publishedVersion) {
	const published = SEMVER.exec(publishedVersion.trim())?.[1];
	if (!published) throw new Error(`unparseable published version: ${publishedVersion}`);
	const probed = latestProbedVersion(logText);
	if (!probed) return { ok: false, reason: "the probe log records no run" };
	if (compareVersions(probed, published) === "published-ahead") {
		return {
			ok: false,
			reason: `the newest probe covers v${probed}, but adopters already hold v${published}`,
		};
	}
	return { ok: true, probed };
}
