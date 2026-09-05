/**
 * Pure functions for cycle-status preflight aggregation.
 * git/gh I/O lives in the main script; this module stays testable.
 */

import {
	FORMAT_3_DECISION_KINDS,
	FORMAT_3_DISPOSITIONS,
	FORMAT_3_MARKER,
	normalizeRecordLine,
	parseFormat3DesignRecord,
	presentRequiredPrefixes,
	resolveDesignRecord,
	resolveDesignRecordRequiredPrefixes,
	toDesignRecordEntries,
} from "./gate-check.mjs";
import { counterLineOf } from "./retro-patterns.mjs";
import {
	CODE_PATH,
	CORRECTNESS_TOOLS,
	GATE_TOOLS,
	REVIEW_TOOLS,
} from "./review-record.mjs";

// The human-readable form of CODE_PATH's alternation (`/^(packages|scripts)\//`),
// so buildReviewRecordTemplate's note names the same paths the checker actually
// gates on rather than a restated copy that could drift from it.
const CODE_PATH_LABEL = CODE_PATH.source
	.match(/^\^\(([^)]+)\)/)[1]
	.split("|")
	.map((prefix) => `${prefix}/`)
	.join(" か ");

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

/**
 * Whether the issue about to be started owes a roadmap entry (#963).
 *
 * `audit-issues-flow.mjs` reports the same gap, but only as advisory: a managed
 * issue's entry lands on the branch that implements it, so every other session
 * sees the gap until that branch merges, and failing on it made the terminal
 * gate red on issues the failing cycle does not own. The gap is worth
 * acting on at exactly one moment — when this cycle starts that very issue —
 * which is the moment this preflight runs.
 * @param {string[]} labelNames the issue's label names
 * @param {string | null} processId the process tracking it, or null when none
 * @returns {boolean}
 */
export function isUnregisteredManagedIssue(labelNames, processId) {
	if (processId !== null) return false;
	return (labelNames ?? []).includes("flow:managed");
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
 * The design-selection record, pre-shaped from the terminal gate's format 3
 * vocabulary so the runner never repeats that contract.
 *
 * Emitted on every cycle, not only when the issue enumerates options: the gate
 * FAILs a missing record regardless of the option count, so a record is owed
 * whenever the cycle names an issue at all.
 * @returns {{note: string, lines: string[]}}
 */
export function buildDesignRecordTemplate() {
	const lines = [
		FORMAT_3_MARKER,
		"",
		"決定:",
		`- <軸名>（<${FORMAT_3_DECISION_KINDS.join(" | ")}>）: <今回確定した範囲>`,
		"",
		"理由:",
		"- <軸名>: <目的との対応>",
		"",
		"案の処分:",
		`- <${FORMAT_3_DISPOSITIONS.join(" | ")}> — 元候補「<候補名>」— <理由または条件>`,
		"",
		"前提検査 P1:",
		"対象: <軸名、決定、または元候補名>",
		"前提: <候補群が共有する前提>",
		"前提を外した案: <前提が成立しない場合の検査案>",
		"既存候補との差分: <一致、包含、組合せを含む具体的な差分>",
		`検査案の処分 P1: <${FORMAT_3_DISPOSITIONS.join(" | ")}> — <理由または条件>`,
		"",
		"改訂履歴:",
		"- なし",
	];
	return {
		note: "着手前（ブランチ最初のコミットより前）に、実行主体が issue コメントとして投稿する。角括弧の雛形を具体的な内容へ置き換え、issue 由来の候補をすべて実名で案の処分へ記録する。案の処分と検査案の処分 Pn の部分採用は、空でない採用部分と、理由を伴う残部: 却下|保留 を書く。候補の網羅性と決定・理由・処分の意味的整合は人間レビューの責務であり、機械検査は保証しない。下書きは投稿前に `node scripts/check-design-record.mjs --file <path>` で検査し、PASS を確認してから投稿する。",
		lines,
	};
}

/**
 * The review-record trailer template (#809), pre-shaped the same way
 * buildDesignRecordTemplate is: the vocabulary comes from review-record.mjs's
 * own constants rather than restated in prose, so a template that drifts
 * from the checker cannot happen silently.
 *
 * Unlike the design record, this is not a copy-pasteable literal. The runner substitutes a real tool name after actually running a review, so `line` keeps a placeholder rather than a fabricated tool value.
 *
 * Emitted on every cycle, not only ones that turn out to touch packages/ or
 * scripts/: whether this cycle will is undecidable at preflight time (the
 * diff doesn't exist yet), and the failure this closes is exactly a runner
 * who never saw the format until the terminal gate FAILed on it.
 * @returns {{note: string, line: string}}
 */
export function buildReviewRecordTemplate() {
	return {
		note: `着手前（ブランチ最初のコミットより前）にレビューを実施し、実施のたび commit message の trailer へ記録する。後から追記できない — push 済みなら trailer の追加は履歴の作り直しになる。tool は ${REVIEW_TOOLS.join(" / ")} のいずれか。ゲート充足に数えるのは ${GATE_TOOLS.join(" / ")}（\`code-review\` は有効な trailer 値だが数えない）。${CODE_PATH_LABEL} に変更のある回はさらに ${CORRECTNESS_TOOLS.join(" または ")} を最低1本要する。行が記録するのは委譲したレビューであり、diff の規模に合わせて委譲せず自分で読んだだけの回は書かない — その場合は落とした観点の名前と落とした理由を PR 本文へ書く。`,
		line: "Review: tool=<tool-name>",
	};
}

/**
 * issue の設計確定状態を分類する。判定順（前段がヒットしたら後段は評価しない）:
 * 1. 既存の「設計未確定」フレーズがヒット → unsettled (reason: "phrase")
 * 2. `resolveDesignRecord` が完全な記録を一意に同定できる
 *    → settled (reason: "record-posted")
 * 3. 複数の完全な形式3記録がある → unsettled (reason: "record-ambiguous")
 * 4. 構造不正な記録がある → unsettled (reason: "record-incomplete")
 * 5. 候補列挙構造があるのに記録が無い → unsettled (reason: "enumerated-options-without-record")
 * 6. それ以外 → unsettled (reason: "no-enumerated-options")。
 *    列挙構造を検出できなかった回を「対話省略可」の既定にする（fail-open）と、
 *    散文中に紛れた選択肢が検出をすり抜けたまま既定で通過してしまう（#833・#829）。
 *
 * 記録の同定は終端ゲート（gate-check.mjs）と同じ `resolveDesignRecord`
 * （と、それに entries を渡す `toDesignRecordEntries`）を使う。プリフライトと
 * 終端ゲートが別々の同定ロジックを持つと、どちらかが記録だと見なした文章を
 * もう一方が見なさない、という食い違いが生まれるため。
 *
 * `unsettled` は「設計対話が必要か」を表すだけで、記録投稿の要否とは別軸
 * である。roadmap.md の規約上、design-selection record は列挙構造の有無に
 * 関わらず全サイクル必須で、`unsettled: false` を「記録不要」と読むのは
 * 誤読になる（#809）。そのため戻り値には `recordRequired` を独立して持たせる
 * — `record-posted` のときだけ false、それ以外は常に true（#868）。
 * @param {{body: string, comments?: Array<{body: string, createdAt?: string}>}} params
 * @returns {{unsettled: boolean, reason: string, matchedLines?: string[], optionCount?: number,
 *            missingPrefixes?: string[], problems?: string[],
 *            record?: {createdAt?: string} | null, recordRequired: boolean}}
 */
export function classifyDesignSettlement({ body, comments }) {
	const phrase = detectDesignUnsettled(body);
	if (phrase.designUnsettled) {
		return {
			unsettled: true,
			reason: "phrase",
			matchedLines: phrase.matchedLines,
			recordRequired: true,
		};
	}

	const resolved = resolveDesignRecord(toDesignRecordEntries({ comments }));
	if (resolved.status === "selected") {
		return {
			unsettled: false,
			reason: "record-posted",
			record: { createdAt: resolved.record.createdAt },
			recordRequired: false,
		};
	}
	if (resolved.status === "ambiguous")
		return {
			unsettled: true,
			reason: "record-ambiguous",
			problems: [resolved.detail],
			recordRequired: true,
		};
	if (resolved.status === "invalid") {
		const parsedFormat3 = parseFormat3DesignRecord(resolved.record.body);
		const isFormat3 = resolved.record.body
			.split("\n")
			.some((line) => normalizeRecordLine(line) === FORMAT_3_MARKER);
		return {
			unsettled: true,
			reason: "record-incomplete",
			missingPrefixes: isFormat3
				? []
				: resolveDesignRecordRequiredPrefixes(resolved.record).filter(
						(prefix) =>
							!presentRequiredPrefixes(
								resolved.record.body,
								resolved.record.createdAt,
							).includes(prefix),
					),
			problems: isFormat3 ? parsedFormat3.problems : resolved.problems,
			record: { createdAt: resolved.record.createdAt },
			recordRequired: true,
		};
	}

	const enumerated = detectEnumeratedOptions(body);
	if (enumerated.enumerated) {
		return {
			unsettled: true,
			reason: "enumerated-options-without-record",
			matchedLines: enumerated.headings,
			optionCount: enumerated.count,
			recordRequired: true,
		};
	}

	return {
		unsettled: true,
		reason: "no-enumerated-options",
		recordRequired: true,
	};
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
 * @returns {string}
 */
export function buildGateCheckCommand(artifactKey, base, issueNumbers = []) {
	const issueFlags = issueNumbers.map((n) => ` --issue ${n}`).join("");
	const artifactFlag = artifactKey
		? `--artifact ${artifactKey}`
		: "--no-artifact";
	return `node scripts/gate-check.mjs --base ${base} ${artifactFlag}${issueFlags}`;
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
 * The retro pattern catalog's `phase: pre-artifact` entries, pre-shaped for
 * printing before this cycle writes its commit messages / issue comments /
 * PR body / delegation briefs — the reference point `catalog-consulted-
 * after-the-artifact` (#822) says the catalog otherwise lacks, since retro
 * only runs after those already exist.
 * @param {{name: string, path: string, body: string, phase?: string}[]} patterns
 * @returns {{name: string, path: string, countermeasure: string | undefined}[]}
 */
export function buildPreArtifactReminders(patterns) {
	return patterns
		.filter((p) => p.phase === "pre-artifact")
		.map((p) => ({
			name: p.name,
			path: p.path,
			countermeasure: counterLineOf(p.body),
		}));
}

/**
 * The publishing backlog as material, from a `scripts/release-status.mjs` run
 * (#814). That script exits 1 whenever something is unpublished, which is the
 * ordinary state between releases — so failure is read as the signal, not as a
 * broken run, and the reason stays in the text it printed. Nothing here parses
 * that text: this is report material a person reads, and a parser would couple
 * the preflight to release-status's formatting for no judgment it makes.
 *
 * `needsAction` is release-status's exit code and nothing added to it. What
 * that code covers, and why it stops where it does, is documented once at its
 * definition — `needsAction` in ./release-status-check.mjs. Restating the list
 * here would be a third copy to keep in step (#880).
 * @param {{ok: boolean, out: string, status: number|null}} result - a tryRun result
 * @returns {{needsAction: boolean, report: string[]}}
 */
export function summarizeReleasePending(result) {
	return {
		needsAction: !result.ok,
		report: result.out
			.split("\n")
			.map((line) => line.trimEnd())
			.filter((line) => line !== ""),
	};
}

/**
 * @param {string} logOutput - output of `git log --oneline HEAD..origin/<base>`
 * @returns {number}
 */
export function countBehind(logOutput) {
	const trimmed = logOutput.trim();
	return trimmed === "" ? 0 : trimmed.split("\n").filter(Boolean).length;
}
