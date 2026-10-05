/**
 * Pure functions for release-status comparison and formatting.
 * Network I/O lives in the main script; this module stays testable.
 */

import { DISTRIBUTION_ROOTS } from "./distribution-roots.mjs";
import { formatRecordStamp } from "./review-record-gate.mjs";

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
		.map(
			({
				name,
				registry,
				localVersion,
				publishedVersion,
				status,
				commitsAhead,
			}) => {
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
			},
		)
		.join("\n");
}

/**
 * Plugin snapshots are distributed at the same v* tags as the CLI, separately
 * from its npm dist. Compare the delivered outputs, not maintainer-only sources
 * or intervening commits whose changes may have been reverted.
 * @param {(args: string[]) => string} git
 * @param {string | null} sinceTag
 * @returns {{changedFiles: number | null, error?: string}}
 */
export function readPluginBundleStatus(git, sinceTag) {
	if (!sinceTag)
		return { changedFiles: null, error: "no release tag available" };
	try {
		const output = git([
			"diff",
			"--name-only",
			"-z",
			sinceTag,
			"HEAD",
			"--",
			...DISTRIBUTION_ROOTS,
		]);
		return { changedFiles: output.split("\0").filter(Boolean).length };
	} catch (error) {
		return { changedFiles: null, error: error.message };
	}
}

/**
 * Report only the local plugin snapshot's difference from the release tag.
 * Marketplace pin and remote retrieval are separate publication steps.
 * @param {{changedFiles: number | null, error?: string}} status
 * @param {string | null} sinceTag
 * @returns {string}
 */
export function formatPluginBundleStatus({ changedFiles, error }, sinceTag) {
	const name = "plugin bundle (plugin/pfdsl, plugin/pfdsl-codex)";
	if (changedFiles === null) return `  ${name} ! unknown (${error})`;
	if (changedFiles > 0) {
		return `  ${name} ! changed (${changedFiles} file(s) since ${sinceTag}, needs plugin release)`;
	}
	const suffix = sinceTag ? ` (no changes since ${sinceTag})` : "";
	return `  ${name} ✓ up-to-date${suffix}`;
}

/**
 * The distribution review's currency, shown without blocking. `make release`
 * refuses on the same state; this line is so the refusal is not a surprise.
 * @param {{record: {commit: string|null, date?: string}, unreviewedCount: number}} args
 * @returns {string}
 */
export function formatDistributionReviewStatus({ record, unreviewedCount }) {
	const name = "distribution review (plugin/pfdsl prompts)";
	const at = formatRecordStamp(record);
	// undefined means the gate could not read the recorded commit at all.
	// Printing "current" there would contradict the release gate's refusal.
	if (unreviewedCount === undefined)
		return `  ${name} ! cannot determine (see warning above)`;
	if (unreviewedCount > 0) {
		const since = at ? `since ${at}` : "never reviewed";
		return `  ${name} ! ${unreviewedCount} file(s) unreviewed (${since})`;
	}
	return `  ${name} ✓ current (${at})`;
}

/**
 * The spec-history check's currency, shown without blocking. `make release`
 * refuses on the same verdict (scripts/check-spec-history.mjs); this line is
 * so the refusal is not a surprise.
 * @param {{ok: boolean, message: string}} result
 * @returns {string}
 */
export function formatSpecHistoryStatus({ ok, message }) {
	const name = "spec-history (docs/spec/spec-history.md)";
	return ok ? `  ${name} ✓ ${message}` : `  ${name} ! ${message}`;
}

/**
 * Newest full-mode run, read from the record directory's filenames
 * (`<date>-<mode>.md`). Full mode never advances the reviewed commit, so the
 * logs are the only place its history lives.
 * @param {string[]} filenames
 * @returns {string | null}
 */
export function latestFullReviewDate(filenames) {
	const dates = filenames
		.map((name) => /^(\d{4}-\d{2}-\d{2})-full\.md$/.exec(name)?.[1])
		.filter(Boolean)
		.sort();
	return dates.length > 0 ? dates[dates.length - 1] : null;
}

/**
 * Full mode is manual by design — nothing forces it. This line is the whole
 * reminder that it exists, which is the failure ADR-0029 already demonstrated:
 * a practice with no trigger anywhere runs once and is never run again.
 * @param {string | null} date
 * @returns {string}
 */
export function formatFullReviewStatus(date) {
	const name = "distribution review (full mode, manual)";
	return date ? `  ${name}   last run ${date}` : `  ${name}   never run`;
}

/**
 * Whether anything is left to do before the next publication — the script's
 * exit code, and what `cycle-status.mjs` re-exports as
 * `releasePending.needsAction`.
 *
 * The release-only gate results count here because those gates run nowhere
 * else: `make release` refuses on them and none is wired into CI or the
 * pre-commit hook. `release.mjs`'s other pre-tag checks — build, test,
 * check-docs, gen-plugin identity — are covered continuously by test.yml and
 * check-gen-plugin.yml, so a failure there is ordinary breakage rather than
 * publishing work left pending (#880).
 * @param {{results: Array<{status: string, commitsAhead?: number}>, pluginChangedFiles: number | null, gates: Array<{ok: boolean}>}} args
 * @returns {boolean}
 */
export function needsAction({ results, pluginChangedFiles, gates }) {
	return (
		results.some(
			(r) =>
				r.status === "local-ahead" ||
				r.status === "error" ||
				r.commitsAhead > 0,
		) ||
		pluginChangedFiles !== 0 ||
		gates.some((gate) => gate.ok !== true)
	);
}
