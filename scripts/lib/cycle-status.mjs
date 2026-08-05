/**
 * Pure functions for cycle-status preflight aggregation.
 * git/gh I/O lives in the main script; this module stays testable.
 */

import {
	DESIGN_RECORD_REQUIRED_PREFIXES,
	DISPOSITION_TOKENS,
	lineHeadPattern,
	normalizeRecordLine,
} from "./gate-check.mjs";

/**
 * @param {Array<{conclusion?: string|null, status?: string}>} [statusCheckRollup]
 * @returns {"NONE"|"PASS"|"FAIL"|"PENDING"|"UNKNOWN"}
 */
export function summarizeCiStatus(statusCheckRollup) {
	if (!statusCheckRollup || statusCheckRollup.length === 0) return "NONE";
	const conclusions = statusCheckRollup.map((c) => c.conclusion ?? null);
	if (conclusions.some((c) => c === "FAILURE" || c === "ERROR")) return "FAIL";
	if (
		conclusions.some(
			(c) => c === null || c === "PENDING" || c === "IN_PROGRESS",
		)
	)
		return "PENDING";
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
			openFlowSyncPRs.push({
				number: pr.number,
				title: pr.title,
				ci: summarizeCiStatus(pr.statusCheckRollup),
			});
		} else {
			otherOpenPRs.push({ number: pr.number, title: pr.title });
		}
	}
	return { openFlowSyncPRs, otherOpenPRs };
}

/**
 * @param {unknown} readyJson - output of `pfdsl status ready --best --json`
 * @returns {{ready: string[], best: string | null, bestOutputs: string[]}}
 */
export function parseReadyOutput(readyJson) {
	if (!readyJson || typeof readyJson !== "object" || readyJson.ok !== true) {
		return { ready: [], best: null, bestOutputs: [] };
	}
	const ready = (readyJson.ready ?? []).map((p) => p.id);
	const best = readyJson.best?.id ?? null;
	const bestOutputs = readyJson.best?.outputs ?? [];
	return { ready, best, bestOutputs };
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

const OPTION_HEADING_PATTERNS = [
	/検討したい方向/,
	/対応案/,
	/方針案/,
	/選択肢/,
];

const HEADING_LINE_PATTERN = /^(#{2,6})\s+(.*)$/;
const NUMBERED_ITEM_PATTERN = /^\d+\.\s/;
const LABELED_SUBHEADING_ITEM_PATTERN = /^#{3,6}\s+([A-Za-z]|\d+)[.、]\s/;

/**
 * 候補列挙の構造検出。issue #669 の対策3: 「選択肢を並べただけで確定させないまま着手する」を
 * 機械的に検出するための入力。markdown 見出し行のうち OPTION_HEADING_PATTERNS に一致するものを
 * 起点に、同レベル以上の見出しが現れるまでの範囲を走査して候補項目を数える。
 * @param {string | undefined | null} body
 * @returns {{enumerated: boolean, count: number, headings: string[]}}
 */
export function detectEnumeratedOptions(body) {
	if (!body) return { enumerated: false, count: 0, headings: [] };
	const lines = body.split("\n");
	const headings = [];
	let count = 0;
	for (let i = 0; i < lines.length; i++) {
		const headingMatch = lines[i].match(HEADING_LINE_PATTERN);
		if (!headingMatch) continue;
		if (!OPTION_HEADING_PATTERNS.some((p) => p.test(lines[i]))) continue;
		const level = headingMatch[1].length;
		headings.push(lines[i].trim());
		for (let j = i + 1; j < lines.length; j++) {
			const nextHeadingMatch = lines[j].match(/^(#{2,6})\s+/);
			if (nextHeadingMatch && nextHeadingMatch[1].length <= level) break;
			if (
				NUMBERED_ITEM_PATTERN.test(lines[j]) ||
				LABELED_SUBHEADING_ITEM_PATTERN.test(lines[j])
			)
				count++;
		}
	}
	return { enumerated: count >= 2, count, headings };
}

export const DECISION_LINE_PREFIX = "決定:";
const DECISION_LINE_PATTERN = lineHeadPattern(
	DECISION_LINE_PREFIX,
	"\\s*案\\s*(\\S+)",
);

/**
 * The design-selection record, pre-shaped so the runner never has to know the
 * format to satisfy it. Every line head here is the one the terminal gate
 * matches on, taken from the gate's own constants rather than restated — a
 * template that drifts from the checker is worse than none, because it is
 * trusted.
 *
 * `決定: 案N` is deliberately absent. That line belongs to the filer and is
 * evidence that the design was settled; this record belongs to the runner and
 * is evidence that alternatives were generated. Putting the filer's line in the
 * runner's template would teach every cycle to write it, which is exactly how
 * the distinction the gate protects gets dissolved by the act of passing it.
 *
 * Emitted on every cycle, not only when the issue enumerates options: the gate
 * FAILs a missing record regardless of the option count, so a record is owed
 * whenever the cycle names an issue at all.
 * @param {{optionCount?: number}} [params]
 * @returns {{note: string, lines: string[]}}
 */
export function buildDesignRecordTemplate({ optionCount = 0 } = {}) {
	const lines = [
		`${DESIGN_RECORD_REQUIRED_PREFIXES[0]} 本案は〈○○という状態が存在し続けること〉を前提にする`,
		`${DESIGN_RECORD_REQUIRED_PREFIXES[1]} 上の前提を否定した案（起票者が挙げていなくても作る）`,
		`${DESIGN_RECORD_REQUIRED_PREFIXES[2]} 外部制約か所有者に帰着させる（「手間がかかる」「スコープ外」は無効）`,
	];
	if (optionCount > 0) {
		lines.push(
			`案の処分: 列挙された ${optionCount} 件それぞれに ${DISPOSITION_TOKENS.join(" / ")} のいずれかを書く`,
		);
	}
	return {
		note: `着手前（ブランチ最初のコミットより前）に、実行主体が issue コメントとして投稿する。行頭の語は gate-check.mjs の定数と同一で、書き換えると design-selection record が FAIL する。各行の内容は必ず埋める — 雛形のまま投稿しても形式は通るが、記録としては何も残らない。行頭 ${DECISION_LINE_PREFIX} 案N は別の記録であり、起票者本人が書く。実行主体はこの記録に書かない。`,
		lines,
	};
}

/**
 * 確定の証拠となる `決定: 案N` 行を、issue 本文とコメントから収集する。
 * @param {Array<{author: string, body: string, createdAt?: string}>} entries
 *   issue 本文は entries の先頭要素として author=issue の起票者 login で渡す。
 * @returns {Array<{author: string, option: string, line: string, createdAt?: string}>}
 */
export function findDecisionRecords(entries) {
	const records = [];
	for (const entry of entries ?? []) {
		for (const line of (entry.body ?? "").split("\n")) {
			const normalized = normalizeRecordLine(line);
			const match = normalized.match(DECISION_LINE_PATTERN);
			if (match) {
				records.push({
					author: entry.author,
					option: match[1],
					line: normalized,
					createdAt: entry.createdAt,
				});
			}
		}
	}
	return records;
}

/**
 * issue の設計確定状態を分類する。判定順（前段がヒットしたら後段は評価しない）:
 * 1. 既存の「設計未確定」フレーズがヒット → unsettled (reason: "phrase")
 * 2. issue の起票者本人による `決定: 案N` 記録がある → settled (reason: "decision-recorded")
 * 3. 候補列挙構造があるのに確定記録が無い → unsettled (reason: "enumerated-options-without-decision")
 * 4. それ以外 → settled (reason: "no-enumerated-options")
 *
 * 起票者と author が一致しない `決定:` 行は確定の証拠にならない（3 に落ちる）。
 * @param {{body: string, ownerLogin: string, comments: Array<{author: string, body: string, createdAt?: string}>}} params
 * @returns {{unsettled: boolean, reason: string, matchedLines?: string[], optionCount?: number,
 *            decision?: {author: string, option: string, createdAt?: string} | null}}
 */
export function classifyDesignSettlement({ body, ownerLogin, comments }) {
	const phrase = detectDesignUnsettled(body);
	if (phrase.designUnsettled) {
		return {
			unsettled: true,
			reason: "phrase",
			matchedLines: phrase.matchedLines,
		};
	}

	const entries = [{ author: ownerLogin, body }, ...(comments ?? [])];
	const decisions = findDecisionRecords(entries);
	const ownerDecision = decisions.find((d) => d.author === ownerLogin);
	if (ownerDecision) {
		return {
			unsettled: false,
			reason: "decision-recorded",
			decision: {
				author: ownerDecision.author,
				option: ownerDecision.option,
				createdAt: ownerDecision.createdAt,
			},
		};
	}

	const enumerated = detectEnumeratedOptions(body);
	if (enumerated.enumerated) {
		return {
			unsettled: true,
			reason: "enumerated-options-without-decision",
			matchedLines: enumerated.headings,
			optionCount: enumerated.count,
		};
	}

	return { unsettled: false, reason: "no-enumerated-options" };
}

/**
 * The gate-check invocation for this cycle. `--issue` is folded in for the
 * same reason `--artifact` is: the operator copies this line verbatim, so a
 * flag left out here is a check that silently SKIPs every cycle (#669). It is
 * repeated per issue rather than folded into one value, because gate-check
 * judges each issue on its own row (#734).
 * @param {string | null} artifactKey
 * @param {string} base
 * @param {number[]} [issueNumbers]
 * @returns {string | null}
 */
export function buildGateCheckCommand(artifactKey, base, issueNumbers = []) {
	if (!artifactKey) return null;
	const issueFlags = issueNumbers.map((n) => ` --issue ${n}`).join("");
	return `node scripts/gate-check.mjs --base ${base} --artifact ${artifactKey}${issueFlags}`;
}

const DESIGN_UNSETTLED_PATTERNS = [/design TBD/i, /設計未確定/, /設計未合意/];

/**
 * work-cycle.md 手順1が定義する「設計未合意フレーズ」を issue 本文から検出する。
 * @param {string | undefined | null} body
 * @param {RegExp[]} patterns
 * @returns {{designUnsettled: boolean, matchedLines: string[]}}
 */
export function detectDesignUnsettled(
	body,
	patterns = DESIGN_UNSETTLED_PATTERNS,
) {
	if (!body) return { designUnsettled: false, matchedLines: [] };
	const matchedLines = body
		.split("\n")
		.filter((line) => patterns.some((p) => p.test(line)));
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
