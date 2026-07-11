/**
 * Pure functions for cycle-status preflight aggregation.
 * git/gh I/O lives in the main script; this module stays testable.
 */

/**
 * @param {Array<{conclusion?: string|null, status?: string}>} [statusCheckRollup]
 * @returns {"NONE"|"PASS"|"FAIL"|"PENDING"|"UNKNOWN"}
 */
export function summarizeCiStatus(statusCheckRollup) {
	if (!statusCheckRollup || statusCheckRollup.length === 0) return "NONE";
	const conclusions = statusCheckRollup.map((c) => c.conclusion ?? null);
	if (conclusions.some((c) => c === "FAILURE" || c === "ERROR")) return "FAIL";
	if (conclusions.some((c) => c === null || c === "PENDING" || c === "IN_PROGRESS")) return "PENDING";
	if (conclusions.every((c) => c === "SUCCESS")) return "PASS";
	return "UNKNOWN";
}

/**
 * @param {Array<{number: number, title: string, headRefName: string, statusCheckRollup?: Array}>} prs
 * @param {RegExp} flowSyncPattern
 * @returns {{openFlowSyncPRs: Array<{number: number, title: string, ci: string}>, otherOpenPRs: Array<{number: number, title: string}>}}
 */
export function classifyPRs(prs, flowSyncPattern = /^flow-sync\//) {
	const openFlowSyncPRs = [];
	const otherOpenPRs = [];
	for (const pr of prs) {
		if (flowSyncPattern.test(pr.headRefName)) {
			openFlowSyncPRs.push({ number: pr.number, title: pr.title, ci: summarizeCiStatus(pr.statusCheckRollup) });
		} else {
			otherOpenPRs.push({ number: pr.number, title: pr.title });
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
