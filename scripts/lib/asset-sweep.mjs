/**
 * Sweep gates for accumulating-catalog assets: files that a per-cycle
 * addition discipline keeps growing (a new pattern per retro), but that
 * nothing ever revisits as a set — near-duplicates never merge, patterns
 * whose trap is now machine-enforced never get retired, tag vocabulary
 * drifts. #879 found 4-9 such stale entries out of 61 in
 * .pfdsl/bindings/pfd-retro-patterns/ alone.
 *
 * Each registered target reuses evaluateRecordGate (review-record-gate.mjs)
 * with a threshold above 1: a sweep is "current" until enough has
 * accumulated since the last one, not until nothing at all has changed.
 * That is the difference from distribution-review's gate, whose threshold
 * of 1 fires on the first change — a review-worthy prompt edit is
 * consequential on its own, but one added catalog entry is not worth a
 * dedicated sweep.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EMPTY_TREE, evaluateRecordGate } from "./review-record-gate.mjs";
import { gitDiffNames, tryGit } from "./run-exec.mjs";

/**
 * Registered sweep targets. Each gets its own record file rather than
 * sharing one: a shared record would let sweeping one target's catalog
 * advance a commit that says nothing about a target nobody swept, so a
 * release after that would read the untouched target as current.
 */
export const SWEEP_TARGETS = [
	{
		id: "retro-patterns",
		label: "retro-pattern sweep (.pfdsl/bindings/pfd-retro-patterns)",
		recordPath: "docs/asset-sweep/retro-patterns.json",
		prefixes: [".pfdsl/bindings/pfd-retro-patterns/"],
		// Unit is added files, not changed files: a single editing pass
		// through the catalog (e.g. a tag-vocabulary fix) can modify 30+
		// files in one commit, which would swamp a changed-file threshold
		// without reflecting any actual accumulation. Measured 2026-08-12,
		// over the four days since the catalog's split into one-file-per-
		// pattern, this repo's own edits to the directory were added=22,
		// modified=18 — modified alone would have already been over a
		// threshold this size on ordinary maintenance, not accumulation.
		// 20 is sized to fire roughly every few days at the pace measured
		// then, or every few weeks at a quieter pace; revisit against the
		// actual firing interval once one is observed.
		threshold: 20,
		skill: "retro-pattern-sweep",
	},
];

/** Is this changed path in scope for `target`'s sweep? */
export function inScope(target, path) {
	return (
		target.prefixes.some((prefix) => path.startsWith(prefix)) &&
		path.endsWith(".md")
	);
}

/**
 * Every registered target, evaluated against its own record. Exported
 * separately from runAssetSweepCheck so a status line (release-status.mjs)
 * can render per-target detail without re-deriving the same evaluation.
 * @param {{
 *   readRecord: (target: object) => object | null,
 *   commitExists: (sha: string) => boolean,
 *   changedSince: (target: object, base: string) => string[],
 * }} deps
 */
export function evaluateAssetSweep(deps) {
	return SWEEP_TARGETS.map((target) => {
		const record = deps.readRecord(target);
		const result = evaluateRecordGate({
			readRecord: () => record,
			commitExists: deps.commitExists,
			changedSince: (base) => deps.changedSince(target, base),
			inScope: (path) => inScope(target, path),
			threshold: target.threshold,
		});
		return { target, record, result };
	});
}

/**
 * The gate itself: ok unless any registered target is overdue for a sweep.
 * `scripts/check-asset-sweep.mjs` and `scripts/release-status.mjs` both call
 * this with the same repoDeps, so the blocking check and the status line
 * cannot disagree.
 */
export function runAssetSweepCheck(deps) {
	const evaluations = evaluateAssetSweep(deps);
	const failing = evaluations.filter(({ result }) => !result.ok);
	if (failing.length === 0) {
		return { ok: true, message: "All asset sweeps are current.", evaluations };
	}
	return { ok: false, message: formatGateFailure(failing), evaluations };
}

/**
 * The real-repository deps for runAssetSweepCheck / evaluateAssetSweep.
 * Shared by check-asset-sweep.mjs and release-status.mjs so the two cannot
 * hand-roll different readings of the same records
 * (distribution-review.mjs's repoDeps documents the same reasoning).
 * @param {string} root
 */
export function repoDeps(root) {
	return {
		readRecord: (target) => {
			const abs = resolve(root, target.recordPath);
			return existsSync(abs) ? JSON.parse(readFileSync(abs, "utf-8")) : null;
		},
		commitExists: (sha) =>
			tryGit(["cat-file", "-e", `${sha}^{commit}`], {
				cwd: root,
				captureStderr: true,
			}).ok,
		// --diff-filter=A: the threshold counts additions, not edits (see
		// SWEEP_TARGETS' threshold comment for why).
		changedSince: (target, base) =>
			gitDiffNames(
				[base, "HEAD", "--diff-filter=A", "--", ...target.prefixes],
				{ cwd: root },
			),
	};
}

/**
 * Formats a failure for each overdue target: how many added files, against
 * what threshold, since which recorded sweep, and which skill clears it.
 * @param {Array<{target: object, record: object | null, result: object}>} failing
 */
export function formatGateFailure(failing) {
	const rows = failing.map(({ target, record, result }) => {
		if (result.unreachable) {
			return [
				`  ${target.label}`,
				`    recorded sweep commit ${result.base} is not in this clone.`,
				"    Run git fetch (or git fetch --unshallow) and try again.",
			].join("\n");
		}
		const last =
			record?.commit && result.base !== EMPTY_TREE
				? `${record.commit.slice(0, 7)} (${record.date ?? "unknown date"})`
				: "never swept";
		return [
			`  ${target.label}`,
			`    ${result.files.length} added file(s) since the last sweep (threshold: ${target.threshold}).`,
			`    last sweep: ${last}`,
			`    run the ${target.skill} skill.`,
		].join("\n");
	});
	return [
		"The following asset sweeps are overdue:",
		...rows,
		"",
		"Run the skill(s) named above, record the result, and try again.",
	].join("\n");
}
