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

import {
	evaluateRecordGate,
	formatRecordStamp,
} from "./review-record-gate.mjs";
import { gitDiffNames, tryGit } from "./run-exec.mjs";

/**
 * Registered sweep targets. Each gets its own record file rather than
 * sharing one: a shared record would let sweeping one target's catalog
 * advance a commit that says nothing about a target nobody swept, so a
 * release after that would read the untouched target as current.
 *
 * ADR-0026 retired this repo's last threshold-triggered record mechanism, so
 * the three things that make this one different are worth stating rather than
 * rederiving. That record was appended to, once per cycle, at a fixed anchor
 * in a shared companion — which collides across the parallel worktrees this
 * repo runs; these records hold one key, overwritten only by a sweep, which
 * is rare by construction. Its thresholds never fired alone because a more
 * frequent trigger (the done event) always preceded them; a sweep has no
 * other trigger at all. And it was advisory, so a reader could pass it by;
 * this one refuses a release.
 */
/** Derives the record path from the id so the two cannot drift apart. */
const defineTarget = ({ id, ...rest }) => ({
	id,
	recordPath: `docs/asset-sweep/${id}.json`,
	...rest,
});

export const SWEEP_TARGETS = [
	defineTarget({
		id: "retro-patterns",
		label: "retro-pattern sweep (.pfdsl/bindings/pfd-retro-patterns)",
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
	}),
];

/** Is this changed path in scope for `target`'s sweep? */
export function inScope(target, path) {
	return (
		target.prefixes.some((prefix) => path.startsWith(prefix)) &&
		path.endsWith(".md")
	);
}

/**
 * Every registered target, evaluated against its own record. Kept local:
 * runAssetSweepCheck returns these evaluations, so a status line
 * (release-status.mjs) renders per-target detail from that one call rather
 * than from a second entry point that would have to agree with it.
 * @param {{
 *   readRecord: (target: object) => object | null,
 *   commitExists: (sha: string) => boolean,
 *   changedSince: (target: object, base: string) => string[],
 * }} deps
 */
function evaluateAssetSweep(deps) {
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
 * The real-repository deps for runAssetSweepCheck.
 * Shared by check-asset-sweep.mjs and release-status.mjs so the two cannot
 * hand-roll different readings of the same records
 * (distribution-review.mjs's repoDeps documents the same reasoning).
 *
 * `exec` is injectable so a test can assert the diff invocation itself. What
 * that invocation asks for is the whole gate — a wrong flag here changes the
 * count without changing any decision the pure functions make.
 * @param {string} root
 * @param {{exec?: Function}} [options]
 */
export function repoDeps(root, { exec } = {}) {
	// gitDiffNames defaults exec when the property is undefined, so the
	// injection point costs no branch here.
	const diffOptions = { cwd: root, exec };
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
		//
		// --no-renames because git's rename detection is on by default and
		// would pair a deleted pattern with a similar-enough added one,
		// reporting R — which --diff-filter=A then drops. Catalog files share
		// a template, and retiring one pattern in the same window another is
		// added is an ordinary cycle here, so the pairing subtracts from the
		// accumulation this count exists to measure, delaying the gate past
		// its threshold with nothing to show for it. The cost of turning
		// detection off runs the other way: a mass rename (the 2026-08-06
		// romanisation of every filename, 39 R100 pairs) counts as additions
		// and fires the gate early. That direction is the safe one for a
		// fail-closed gate, and such renames are one-off events.
		changedSince: (target, base) =>
			gitDiffNames(
				[
					base,
					"HEAD",
					"--diff-filter=A",
					"--no-renames",
					"--",
					...target.prefixes,
				],
				diffOptions,
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
		const last = formatRecordStamp(record) ?? "never swept";
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
