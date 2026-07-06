/**
 * Pure functions for cycle-status preflight aggregation.
 * git/gh I/O lives in the main script; this module stays testable.
 */

/**
 * @param {Array<{number: number, title: string, headRefName: string}>} prs
 * @param {RegExp} flowSyncPattern
 * @returns {{openFlowSyncPRs: Array<{number: number, title: string}>, otherOpenPRs: Array<{number: number, title: string}>}}
 */
export function classifyPRs(prs, flowSyncPattern = /^flow-sync\//) {
	const openFlowSyncPRs = [];
	const otherOpenPRs = [];
	for (const pr of prs) {
		const entry = { number: pr.number, title: pr.title };
		if (flowSyncPattern.test(pr.headRefName)) {
			openFlowSyncPRs.push(entry);
		} else {
			otherOpenPRs.push(entry);
		}
	}
	return { openFlowSyncPRs, otherOpenPRs };
}

/**
 * @param {unknown} readyJson - output of `pfdsl ready --best --json`
 * @returns {{ready: string[], best: string | null}}
 */
export function parseReadyOutput(readyJson) {
	if (!readyJson || typeof readyJson !== "object" || readyJson.ok !== true) {
		return { ready: [], best: null };
	}
	const ready = (readyJson.ready ?? []).map((p) => p.id);
	const best = readyJson.best?.id ?? null;
	return { ready, best };
}

/**
 * @param {string} logOutput - output of `git log --oneline HEAD..origin/<base>`
 * @returns {number}
 */
export function countBehind(logOutput) {
	const trimmed = logOutput.trim();
	return trimmed === "" ? 0 : trimmed.split("\n").filter(Boolean).length;
}
