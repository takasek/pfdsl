/**
 * Pure functions for cycle-status preflight aggregation.
 * git/gh I/O lives in the main script; this module stays testable.
 */

import {
	DESIGN_RECORD_REQUIRED_PREFIXES,
	DISPOSITION_TOKENS,
	NO_IMPLEMENTATION_TOKEN,
	selectDesignRecord,
	toDesignRecordEntries,
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

/**
 * roadmap.pfdsl の `process:` セクション全体を切り出す（次の非インデントキーの行まで、
 * それが無ければ文字列末尾まで）。process ブロックの列挙は、この部分文字列に対してのみ行う
 * ことで artifact: セクション側の location を誤って拾わないようにする。
 * @param {string} pfdslText
 * @returns {string}
 */
function extractProcessSection(pfdslText) {
	const withBoundary = pfdslText.match(/^process:\n([\s\S]*?)(?=^\S)/m);
	if (withBoundary) return withBoundary[1];
	const toEnd = pfdslText.match(/^process:\n([\s\S]*)$/m);
	return toEnd ? toEnd[1] : "";
}

/**
 * `findIssueNumberForProcess` の逆方向: issue 番号から、それを `location:` に持つ
 * process の processId を返す。
 * @param {string} pfdslText - .pfdsl/roadmap.pfdsl の全文
 * @param {number} issueNumber
 * @returns {string | null}
 */
export function findProcessIdForIssueNumber(pfdslText, issueNumber) {
	// 番兵行を足し、最後のエントリも他のエントリと同じ境界規則
	// (`^  \S` か `^\S` の手前まで) で終端できるようにする。
	const scanText = `${extractProcessSection(pfdslText)}\n\x00`;
	const entryPattern = /^ {2}(\S+):\n([\s\S]*?)(?=^ {2}\S|^\S)/gm;
	for (const [, processId, block] of scanText.matchAll(entryPattern)) {
		const match = block.match(/location:\s*\S*\/issues\/(\d+)/);
		if (match && Number(match[1]) === issueNumber) return processId;
	}
	return null;
}

const HEADING_LINE_PATTERN = /^(#{2,6})\s+(.*)$/;
const NUMBERED_ITEM_PATTERN = /^\d+\.\s/;
const LABELED_SUBHEADING_ITEM_PATTERN = /^#{3,6}\s+([A-Za-z]|\d+)[.、]\s/;
const LABELED_BULLET_ITEM_PATTERN = /^-\s*(案\s*\S+|[A-Za-z]|\d+)[.:：]\s/;

/**
 * 候補列挙の構造検出。issue #669 の対策3: 「選択肢を並べただけで確定させないまま着手する」を
 * 機械的に検出するための入力。markdown 見出し行なら語彙を問わず起点とし、同レベル以上の見出しが
 * 現れるまでの範囲を走査して候補項目を数える（#800: 語彙 allowlist は撤廃済み。偽陽性
 * — 候補列挙でない見出し配下も enumerated:true になりうる — は許容するトレードオフで、
 * allowlist が生んでいた偽陰性の方が実害が大きいという判断による）。
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
		const level = headingMatch[1].length;
		headings.push(lines[i].trim());
		for (let j = i + 1; j < lines.length; j++) {
			const nextHeadingMatch = lines[j].match(/^(#{2,6})\s+/);
			if (nextHeadingMatch && nextHeadingMatch[1].length <= level) break;
			if (
				NUMBERED_ITEM_PATTERN.test(lines[j]) ||
				LABELED_SUBHEADING_ITEM_PATTERN.test(lines[j]) ||
				LABELED_BULLET_ITEM_PATTERN.test(lines[j])
			)
				count++;
		}
	}
	return { enumerated: count >= 2, count, headings };
}

/**
 * The design-selection record, pre-shaped so the runner never has to know the
 * format to satisfy it. Every line head here is the one the terminal gate
 * matches on, taken from the gate's own constants rather than restated — a
 * template that drifts from the checker is worse than none, because it is
 * trusted.
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
		note: `着手前（ブランチ最初のコミットより前）に、実行主体が issue コメントとして投稿する。行頭の語は gate-check.mjs の定数と同一で、書き換えると design-selection record が FAIL する。各行の内容は必ず埋める — 雛形のまま投稿しても形式は通るが、記録としては何も残らない。実装しないと判断した回のみ、記録本文のどこかに「${NO_IMPLEMENTATION_TOKEN}」という語を含める — timing 判定が SKIP になり、コミットとの前後関係を照合しない。`,
		lines,
	};
}

/**
 * issue の設計確定状態を分類する。判定順（前段がヒットしたら後段は評価しない）:
 * 1. 既存の「設計未確定」フレーズがヒット → unsettled (reason: "phrase")
 * 2. `selectDesignRecord` が本文・コメントから記録を同定できる → settled (reason: "record-posted")
 * 3. 候補列挙構造があるのに記録が無い → unsettled (reason: "enumerated-options-without-record")
 * 4. それ以外 → settled (reason: "no-enumerated-options")
 *
 * 記録の同定は終端ゲート（gate-check.mjs）と同じ `selectDesignRecord`
 * （と、それに entries を渡す `toDesignRecordEntries`）を使う。プリフライトと
 * 終端ゲートが別々の同定ロジックを持つと、どちらかが記録だと見なした文章を
 * もう一方が見なさない、という食い違いが生まれるため。共有しているのは
 * この同定だけで、記録の内容検査（`classifyDesignRecordContent`）と
 * 時点照合（`classifyDesignRecordTiming`）は終端ゲート側だけが持つ —
 * ここで record-posted になった記録が、終端ゲートでは内容不備・時点不備で
 * FAIL することがあるのは意図した非対称である。
 * @param {{body: string, createdAt?: string, comments?: Array<{body: string, createdAt?: string}>}} params
 * @returns {{unsettled: boolean, reason: string, matchedLines?: string[], optionCount?: number,
 *            record?: {createdAt?: string} | null}}
 */
export function classifyDesignSettlement({ body, createdAt, comments }) {
	const phrase = detectDesignUnsettled(body);
	if (phrase.designUnsettled) {
		return {
			unsettled: true,
			reason: "phrase",
			matchedLines: phrase.matchedLines,
		};
	}

	const record = selectDesignRecord(
		toDesignRecordEntries({ body, createdAt, comments }),
	);
	if (record) {
		return {
			unsettled: false,
			reason: "record-posted",
			record: { createdAt: record.createdAt },
		};
	}

	const enumerated = detectEnumeratedOptions(body);
	if (enumerated.enumerated) {
		return {
			unsettled: true,
			reason: "enumerated-options-without-record",
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
 * The paths named by `git status --porcelain`, tracked edits and untracked
 * files alike — both reach the next commit through `git add -A`.
 *
 * A rename entry names two paths; the destination is where the content sits
 * now, so that is the one a reader has to deal with. The status field is two
 * columns plus a space, which is why the path is taken by offset rather than
 * by splitting on whitespace: a path may contain spaces.
 * @param {string} porcelainOutput - output of `git status --porcelain`
 * @returns {string[]}
 */
export function parsePorcelainPaths(porcelainOutput) {
	return porcelainOutput
		.split("\n")
		.filter((line) => line.length > 3)
		.map((line) => {
			const path = line.slice(3);
			const arrow = path.indexOf(" -> ");
			return arrow >= 0 && line.startsWith("R") ? path.slice(arrow + 4) : path;
		});
}

/**
 * @param {string} logOutput - output of `git log --oneline HEAD..origin/<base>`
 * @returns {number}
 */
export function countBehind(logOutput) {
	const trimmed = logOutput.trim();
	return trimmed === "" ? 0 : trimmed.split("\n").filter(Boolean).length;
}
