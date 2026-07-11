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
 * roadmap.pfdsl 内の `<processId>:` ブロック（次の同インデントキーまで）を抜き出す。
 * @param {string} pfdslText
 * @param {string} processId
 * @returns {string | null}
 */
function findProcessBlock(pfdslText, processId) {
	const re = new RegExp(`^  ${processId}:\\n([\\s\\S]*?)(?=^  \\S|^\\S)`, "m");
	const match = pfdslText.match(re);
	return match ? match[1] : null;
}

/**
 * @param {string} pfdslText - .pfdsl/roadmap.pfdsl の全文
 * @param {string} processId
 * @returns {number | null}
 */
export function findIssueNumberForProcess(pfdslText, processId) {
	const block = findProcessBlock(pfdslText, processId);
	if (!block) return null;
	const match = block.match(/location:\s*\S*\/issues\/(\d+)/);
	return match ? Number(match[1]) : null;
}

/**
 * roadmap.pfdsl の edge 定義（`... >> <processId> -> <outputKey>`）から
 * プロセスの出力 artifact キーを引く。
 * @param {string} pfdslText
 * @param {string} processId
 * @returns {string | null}
 */
export function findOutputArtifactForProcess(pfdslText, processId) {
	const re = new RegExp(`>>\\s*${processId}\\s*->\\s*([A-Za-z0-9_]+)`);
	const match = pfdslText.match(re);
	return match ? match[1] : null;
}

/**
 * @param {string | null} artifactKey
 * @param {string} base
 * @returns {string | null}
 */
export function buildGateCheckCommand(artifactKey, base) {
	if (!artifactKey) return null;
	return `node scripts/gate-check.mjs --base ${base} --artifact ${artifactKey}`;
}

const DESIGN_UNSETTLED_PATTERNS = [/design TBD/i, /設計未確定/, /設計未合意/];

/**
 * work-cycle.md 手順1が定義する「設計未合意フレーズ」を issue 本文から検出する。
 * @param {string | undefined | null} body
 * @param {RegExp[]} patterns
 * @returns {{designUnsettled: boolean, matchedLines: string[]}}
 */
export function detectDesignUnsettled(body, patterns = DESIGN_UNSETTLED_PATTERNS) {
	if (!body) return { designUnsettled: false, matchedLines: [] };
	const matchedLines = body.split("\n").filter((line) => patterns.some((p) => p.test(line)));
	return { designUnsettled: matchedLines.length > 0, matchedLines };
}

/**
 * @param {string} logOutput - output of `git log --oneline HEAD..origin/<base>`
 * @returns {number}
 */
export function countBehind(logOutput) {
	const trimmed = logOutput.trim();
	return trimmed === "" ? 0 : trimmed.split("\n").filter(Boolean).length;
}
