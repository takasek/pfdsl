/**
 * The decision core shared by every gate of the shape "has a scope moved
 * since a recorded commit approved it?" — read a record naming a commit,
 * diff HEAD against it, filter the diff to the scope this gate answers for,
 * and compare the in-scope count against a threshold.
 *
 * distribution-review.mjs's `runDistributionReviewCheck` was the first of
 * these (a threshold of 1: any bundled prompt that moved trips it).
 * asset-sweep.mjs reuses this same core with a threshold above 1, so a
 * catalog can accumulate additions for a while before its gate fires.
 * Only the mechanics live here — each caller keeps its own record shape,
 * scope predicate, and failure-message wording, since those are what makes
 * one gate a distribution review and another an asset sweep.
 *
 * Every failure path here is fail-closed. An absent record and an
 * unreachable commit both block, because the alternative in each case is to
 * approve on the strength of a record that says nothing about the current
 * state.
 */

/** git's empty tree — the diff base when nothing has been recorded yet. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** The commit to diff the working tree against, given the record. */
export function diffBase(record) {
	return record?.commit ?? EMPTY_TREE;
}

/**
 * Deps are injected so the decision can be tested without a repository:
 * readRecord returns the parsed record (null if there is none), commitExists
 * answers whether a hash is in this clone, changedSince lists paths that
 * differ between a base and HEAD, and inScope narrows that list to the scope
 * this gate is answerable for.
 *
 * threshold is the in-scope count that trips the gate; the default of 1
 * fires on the first in-scope change, which is `runDistributionReviewCheck`'s
 * original (and still current) behavior.
 *
 * Returns `unreachable: true` (with no `files`) when the recorded commit
 * cannot be read at all — a distinct outcome from an ordinary `ok: false`,
 * since each caller formats its own message for the two cases.
 * @param {{
 *   readRecord: () => object | null,
 *   commitExists: (sha: string) => boolean,
 *   changedSince: (base: string) => string[],
 *   inScope: (path: string) => boolean,
 *   threshold?: number,
 * }} deps
 * @returns {{ok: boolean, base: string, files?: string[], unreachable: boolean}}
 */
export function evaluateRecordGate({
	readRecord,
	commitExists,
	changedSince,
	inScope,
	threshold = 1,
}) {
	const record = readRecord();
	const base = diffBase(record);

	if (base !== EMPTY_TREE && !commitExists(base)) {
		return { ok: false, base, unreachable: true };
	}

	const files = changedSince(base).filter(inScope);
	return { ok: files.length < threshold, base, files, unreachable: false };
}
