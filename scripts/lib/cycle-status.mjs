/**
 * Pure functions for cycle-status preflight aggregation.
 * git/gh I/O lives in the main script; this module stays testable.
 */

import {
	classifyDesignRecordReapprovals,
	classifyFormat3DesignRecord,
	FORMAT_3_DECISION_KINDS,
	FORMAT_3_DISPOSITIONS,
	FORMAT_3_MARKER,
	normalizeRecordLine,
	presentRequiredPrefixes,
	resolveDesignRecord,
	resolveDesignRecordRequiredPrefixes,
	toDesignRecordEntries,
} from "./gate-check.mjs";
import { ALWAYS_TAG, counterLineOf, hitsFor } from "./retro-patterns.mjs";
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
		note: "着手前（ブランチ最初のコミットより前）に、実行主体が issue コメントとして投稿する。角括弧の雛形を具体的な内容へ置き換え、issue 由来の候補をすべて実名で案の処分へ記録する。案の処分と検査案の処分 Pn の部分採用は、空でない採用部分と、理由を伴う残部: 却下|保留 を書く。候補の網羅性と決定・理由・処分の意味的整合は人間レビューの責務であり、機械検査は保証しない。下書きは投稿前に `node scripts/check-design-record.mjs --file <path>` で検査し、PASS を確認してから投稿する。下書きの置き場は並行セッションと共有されるため、`/tmp/design-record.md` のような用途だけの固定名を避け、ブランチ名等でセッション固有の名前にする。",
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
		note: `コミット前に差分をレビューし、実施方法を commit message の trailer へ記録する。品質と correctness を単独で確認した回は tool=self の1行でよい。tool は ${REVIEW_TOOLS.join(" / ")} のいずれか。ゲート充足に数えるのは ${GATE_TOOLS.join(" / ")}（\`code-review\` は有効な trailer 値だが数えない）。${CODE_PATH_LABEL} に変更のある回は ${CORRECTNESS_TOOLS.join(" または ")} の記録が1つあれば記録要件を満たす。追加レビューは具体的な利点がある場合に選び、委譲や観点ごとの複数パスを一律に要求しない。実施した検証と限界は PR 本文に書く。記録漏れだけを理由に push 済みの履歴を書き換えない。`,
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
 *    候補の列挙がなくても、設計記録の存在を推定しない。
 *
 * 記録の同定は終端ゲート（gate-check.mjs）と同じ `resolveDesignRecord`
 * （と、それに entries を渡す `toDesignRecordEntries`）を使う。プリフライトと
 * 終端ゲートが別々の同定ロジックを持つと、どちらかが記録だと見なした文章を
 * もう一方が見なさない、という食い違いが生まれるため。
 *
 * `unsettled` は本文の未確定表現または記録の未確定状態を表し、人間の
 * 追加承認が必要かは判定しない。対話の要否は依頼範囲と未決事項で判断する。
 * 記録投稿の要否は `recordRequired` が示し、`record-posted` のときだけ
 * false、それ以外は true とする（#868）。
 * @param {{body: string, comments?: Array<{id?: string, databaseId?: number, url?: string, body: string, createdAt?: string}>, issueNumber?: number, repository?: {host?: string, owner?: string, repo?: string}, editInfo?: {status?: string, editedAtIso?: string | null}}} params
 * @returns {{unsettled: boolean, reason: string, matchedLines?: string[], optionCount?: number,
 *            missingPrefixes?: string[], problems?: string[],
 *            record?: {createdAt?: string} | null, detail?: string, recordRequired: boolean}}
 */
export function classifyDesignSettlement({
	body,
	comments,
	issueNumber,
	repository,
	editInfo,
}) {
	const phrase = detectDesignUnsettled(body);
	if (phrase.designUnsettled) {
		return {
			unsettled: true,
			reason: "phrase",
			matchedLines: phrase.matchedLines,
			recordRequired: true,
		};
	}

	const entries = toDesignRecordEntries({ comments });
	const resolved = resolveDesignRecord(entries);
	if (resolved.status === "selected") {
		const reapproval = classifyDesignRecordReapprovals({
			record: resolved.record,
			comments: entries,
			issueNumber,
			repository,
			editInfo,
		});
		if (reapproval.status === "FAIL")
			return {
				unsettled: true,
				reason: "record-incomplete",
				problems: [reapproval.detail],
				record: { createdAt: resolved.record.createdAt },
				recordRequired: true,
			};
		return {
			unsettled: false,
			reason: "record-posted",
			record: { createdAt: resolved.record.createdAt },
			...(reapproval.detail ? { detail: reapproval.detail } : {}),
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
		const parsedFormat3 = classifyFormat3DesignRecord(
			resolved.record.body,
			resolved.record.createdAt,
		);
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
 * The pre-artifact reminders for this cycle, narrowed by the target issue's
 * own words, with the verdict on whether that narrowed anything (#1118).
 *
 * An `always`-tagged pattern sits outside the narrowing entirely — kept
 * whatever the words did, at the head, and left out of the pool the verdict
 * divides. `select` makes the same split, and here it is load-bearing rather
 * than cosmetic: `catalog-consulted-after-the-artifact` carries both the tag
 * and the phase, and it is the pattern whose countermeasure this reference
 * point *is*. Narrowing it away on the cycles where narrowing works would
 * remove the reminder exactly when the mechanism is doing its job.
 *
 * The verdict is `select`'s: a result holding more than half the pool has
 * removed less than half of what reading the whole set would cost, which is
 * not a narrowing. Stating it is the point rather than a footnote — the
 * failure this reminder exists to catch is a reader who stops at "narrowed,
 * read, done", and a list of 20 looks exactly like a list of 4 until it is
 * compared to the pool. The binding's measurement says which side this will
 * usually land on: deleting the largest tag outright moved one real cycle's
 * result from 38 to 31.
 *
 * Two cases keep only the always-tagged patterns rather than a shorter hit
 * list: `no-words` means the issue wrote no code spans to search with, and
 * `no-hits` means it wrote some and none of them reached the catalog — the
 * second is a reading on the catalog's vocabulary, the first is one on how the
 * issue was written. The selection remains marked unselective so the runner
 * gets a short prompt to choose better terms instead of mistaking an empty
 * candidate list for evidence that nothing applies. An over-half hit set keeps
 * its actual candidates while retaining the unselective verdict: the output
 * may still be long, and the verdict says so.
 *
 * `reach` counts each word's hits on its own, which is what turns "this is not
 * a narrowing" into something to act on: the words come from whatever the issue
 * happened to put in backticks, and a quoted path contributes its directory
 * names, which are general vocabulary by construction. Measured on this issue:
 * 18 words returned the whole pool of 37, and `issue` (15) and `pfdsl` (13)
 * were where that came from. `select` reports the same field for the same
 * reason — a word with no hits in the result reads as one signal when it is
 * really two.
 * @param {{name: string, path: string, body: string, phase?: string}[]} patterns
 * @param {string[]} words
 * @returns {{reminders: {name: string, path: string, countermeasure: string | undefined}[], words: string[], reach: {word: string, count: number}[], pool: number, unselective: boolean, reason: "no-words" | "no-hits" | "over-half" | null}}
 */
export function narrowPreArtifactReminders(patterns, words) {
	const phased = patterns.filter((p) => p.phase === "pre-artifact");
	const isAlways = (p) => (p.tags ?? []).includes(ALWAYS_TAG);
	const always = phased.filter(isAlways);
	const pool = phased.filter((p) => !isAlways(p));
	const reach = words.map((word) => ({
		word,
		count: hitsFor(phased, [word]).length,
	}));
	const result = (kept, unselective, reason) => ({
		reminders: buildPreArtifactReminders([...always, ...kept]),
		words,
		reach,
		pool: pool.length,
		unselective,
		reason,
	});
	const noCandidates = (reason) => result([], true, reason);
	if (words.length === 0) return noCandidates("no-words");
	// Ranked by how many of the words reached each pattern, ties keeping
	// catalog order — the same ordering `select` gives, and for the same
	// reason: ranking is what a reader gets when the list cannot be short.
	const hit = hitsFor(pool, words)
		.sort((a, b) => b.hits.length - a.hits.length)
		.map((m) => m.pattern);
	if (hit.length === 0) return noCandidates("no-hits");
	if (hit.length > pool.length / 2) return result(hit, true, "over-half");
	return result(hit, false, null);
}

/** A markdown inline code span, without its backticks. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** Inside a span, what an identifier cannot hold — the split points. */
const TOKEN_SEPARATOR = /[^A-Za-z0-9_.-]+/;

/** A token's leading and trailing punctuation (`--word`, `mjs:`), which is
 * part of how the issue writes the term rather than part of the term. */
const TOKEN_EDGE = /^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g;

/** A fenced code block's opening or closing line. */
const FENCE_LINE = /^\s*(?:`{3,}|~{3,})/;

/**
 * The lines outside every fenced code block.
 *
 * A fence holds material the issue is quoting rather than terms it is naming —
 * a pasted diff, an example issue body, a command's output — and its inline
 * spans belong to whatever was pasted. Taking them would inject narrowing
 * words the filer never chose, in the widening direction this whole function
 * exists to fight. An unclosed fence swallows the rest of the text, which is
 * how a markdown renderer reads it too.
 * @param {string} text
 * @returns {string[]}
 */
function linesOutsideFences(text) {
	let inFence = false;
	return text.split("\n").filter((line) => {
		if (!FENCE_LINE.test(line)) return !inFence;
		inFence = !inFence;
		return false;
	});
}

/**
 * The words to narrow the pre-artifact reminders with, taken from the target
 * issue's own text (#1118).
 *
 * Only code spans outside fenced blocks, not the prose around them.
 * `.pfdsl/bindings/pfd-retro.md`
 * asks `--word` for this cycle's concrete terms — changed filenames, touched
 * flags, error strings — and measures the alternative: a draft narrowed to 4
 * patterns by its own identifiers spread to 16, its true neighbour sinking to
 * 9th, when general vocabulary was passed instead. Backticks are where this
 * repo's issues put the concrete terms, and a Japanese sentence has no
 * whitespace to tokenise on anyway, so prose would supply exactly the general
 * vocabulary that measurement rules out.
 *
 * A token needs a letter and four characters. Line ranges and issue numbers
 * (`424-431`, `#1114`) name where something was read, not what it is, and
 * nothing in the catalog carries them; short fragments (`lib`, `tag`) hit on
 * substring alone. Both only widen the result, which is the direction this
 * function exists to fight.
 * @param {string} text issue title and body
 * @returns {string[]} distinct words, in first-seen order
 */
export function preArtifactQueryWords(text) {
	if (typeof text !== "string") return [];
	/** @type {Set<string>} */
	const words = new Set();
	for (const [, span] of linesOutsideFences(text)
		.join("\n")
		.matchAll(CODE_SPAN)) {
		for (const raw of span.split(TOKEN_SEPARATOR)) {
			const token = raw.replace(TOKEN_EDGE, "");
			if (token.length >= 4 && /[A-Za-z]/.test(token)) words.add(token);
		}
	}
	return [...words];
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
