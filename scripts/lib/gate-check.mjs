/**
 * Pure functions for terminal-gate aggregate checking.
 * Process/git I/O lives in the main script; this module stays testable.
 */

import { isGhUnavailableError } from "../pfdsl/lib/gh-compat.mjs";
import { trailerLines } from "./commit-trailers.mjs";

/**
 * @param {string[]} files
 * @param {RegExp} pattern
 * @returns {boolean}
 */
export function matchesTrigger(files, pattern) {
	return files.some((f) => pattern.test(f));
}

// audit-issues-flow.mjs exits with this code when the gh CLI is unavailable
// (ENOENT), distinct from exit code 1 (real findings) — see #489, #492.
export const AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE = 2;

/**
 * Map an `node scripts/pfdsl/audit-issues-flow.mjs` subprocess result to a
 * gate-check row. Exit code 2 (gh CLI unavailable) degrades to SKIP instead
 * of FAIL, so a missing gh binary doesn't get conflated with an actual
 * roadmap/issue sync drift.
 * @param {boolean} ok
 * @param {number|undefined} exitStatus
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifyAuditIssuesFlowResult(ok, exitStatus) {
	if (ok) return { status: "PASS" };
	if (exitStatus === AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE) {
		return {
			status: "SKIP",
			detail: "gh CLI unavailable; GitHub-dependent checks skipped (see #492)",
		};
	}
	return {
		status: "FAIL",
		detail: "re-run: node scripts/pfdsl/audit-issues-flow.mjs (findings)",
	};
}

/**
 * @param {Array<{name: string, status: 'PASS'|'FAIL'|'SKIP', detail?: string}>} results
 * @returns {string}
 */
export function formatGateTable(results) {
	const symbol = (status) =>
		status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "-";
	return results
		.map(
			(r) =>
				`  ${symbol(r.status)} ${r.status.padEnd(4)} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`,
		)
		.join("\n");
}

/** Shared by both checks scoped to the output artifact, so they cannot drift apart. */
export const NO_ARTIFACT_DETAIL =
	"cycle declared it has no roadmap output artifact (--no-artifact)";

/** Shared by both checks that read the linked issue, for the same reason. */
export const NO_ISSUE_DETAIL =
	"no --issue given; pass --issue <n> to check this against the linked issue";

/**
 * Why an issue lookup failed, and what that costs the issue's rows.
 *
 * Every failure used to read "gh CLI unavailable", which is true of exactly one
 * of them. The other two — gh running and answering with an error, and the REST
 * fallback returning a shape JSON.parse rejects — wore a sentence naming a
 * cause that was not theirs, and took a SKIP that the reader had every reason
 * to attribute to their environment (#745).
 *
 * Only a missing binary degrades to SKIP, matching the vocabulary
 * classifyAuditIssuesFlowResult already uses for the same environment (#489):
 * a repo whose sessions have no gh cannot be asked to fail on its absence.
 * Anything else FAILs — the check did not run, and a row nobody acts on is how
 * that goes unnoticed for a whole cycle.
 * @param {{code?: string, message?: string}} error
 * @returns {{status: 'SKIP'|'FAIL', detail: string}}
 */
export function classifyIssueLookupFailure(error) {
	// The same predicate execGh uses to decide whether a REST fallback is even
	// possible, rather than a second spelling of ENOENT that could drift from it.
	if (isGhUnavailableError(error)) {
		return { status: "SKIP", detail: "gh CLI unavailable" };
	}
	return {
		status: "FAIL",
		detail: `issue lookup failed: ${error?.message ?? String(error)}`,
	};
}

/**
 * Classify the output-artifact status-update gate (item 6). No new states:
 * this reuses the existing reasoned-SKIP vocabulary the same way item 9
 * (wip transition) already does for the no-roadmap-change case.
 * @param {{artifactKey?: string, noArtifact?: boolean, roadmapChanged?: boolean, changed?: boolean}} params
 *   - artifactKey: the --artifact CLI flag value, if given.
 *   - noArtifact: the cycle declared it owns no output artifact (--no-artifact).
 *     Wins over everything else — it is a statement about the work, not the diff.
 *   - roadmapChanged: whether .pfdsl/roadmap.pfdsl appears in the changed-files list.
 *     Only consulted when artifactKey is absent.
 *   - changed: whether a status: change was detected (precise per-artifact
 *     check when artifactKey is set, presence-only fallback otherwise).
 *     Not evaluated (may be undefined) in the SKIP case.
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifyOutputArtifactStatus({
	artifactKey,
	noArtifact,
	roadmapChanged,
	changed,
}) {
	// A declaration beats inference. Bookkeeping cycles (a rename, a location:)
	// touch roadmap.pfdsl without owning an output artifact, and no reading of
	// the diff distinguishes those from a cycle that forgot its status update —
	// the check FAILed on every one of them, which is how a gate stops being read.
	if (noArtifact) {
		return { status: "SKIP", detail: NO_ARTIFACT_DETAIL };
	}
	if (!artifactKey && !roadmapChanged) {
		return {
			status: "SKIP",
			detail:
				"work item has no roadmap output artifact (roadmap.pfdsl untouched); " +
				"if this is roadmap-managed work, pass --artifact <key> for a strict check",
		};
	}
	if (artifactKey) {
		return {
			status: changed ? "PASS" : "FAIL",
			detail: changed
				? undefined
				: `no status: change detected for artifact '${artifactKey}'`,
		};
	}
	return {
		status: changed ? "PASS" : "FAIL",
		detail: changed
			? "presence-only check; pass --artifact <key> to verify the specific output artifact"
			: "no status: line changed in .pfdsl/roadmap.pfdsl — pass --artifact <key>, or --no-artifact if this cycle produces none",
	};
}

/**
 * Coarse fallback: true if *any* status: line changed anywhere in the diff.
 * Does not verify the change belongs to a specific artifact — pass an
 * --artifact key to the CLI and use statusChangedForArtifact for that.
 * @param {string} diffText - unified diff of .pfdsl/roadmap.pfdsl
 * @returns {boolean}
 */
export function hasStatusChange(diffText) {
	return diffText.split("\n").some((line) => {
		if (line.startsWith("--- ") || line.startsWith("+++ ")) return false;
		return /^[+-]/.test(line) && /status:/.test(line);
	});
}

/**
 * Extract a specific artifact's status: value from a full-file snapshot of
 * .pfdsl/roadmap.pfdsl.
 * @param {string} text
 * @param {string} artifactKey
 * @returns {string | undefined}
 */
export function extractArtifactStatus(text, artifactKey) {
	const block = text.match(
		new RegExp(`\\n {2}${artifactKey}:\\n([\\s\\S]*?)(?=\\n {2}\\S+:\\n|$)`),
	);
	if (!block) return undefined;
	const status = block[1].match(/status:\s*(\S+)/);
	return status ? status[1] : undefined;
}

/**
 * Precise check: did a specific artifact's status: value change between two
 * full-file snapshots of .pfdsl/roadmap.pfdsl?
 * @param {string} beforeText
 * @param {string} afterText
 * @param {string} artifactKey
 * @returns {boolean}
 */
export function statusChangedForArtifact(beforeText, afterText, artifactKey) {
	return (
		extractArtifactStatus(beforeText, artifactKey) !==
		extractArtifactStatus(afterText, artifactKey)
	);
}

/**
 * Was the artifact (or, without a key, any artifact) ever in status: wip
 * across a sequence of full-file snapshots of .pfdsl/roadmap.pfdsl — one
 * per commit that touched the file? Verifies protocol4's "todo→wip at
 * start" step was actually exercised, not just the final done transition.
 * @param {string[]} fileSnapshots
 * @param {string} [artifactKey]
 * @returns {boolean}
 */
export function wipTransitionDetected(fileSnapshots, artifactKey) {
	if (artifactKey) {
		return fileSnapshots.some(
			(text) => extractArtifactStatus(text, artifactKey) === "wip",
		);
	}
	return fileSnapshots.some((text) => /status:\s*wip/.test(text));
}

/**
 * Path trigger for the vscode-extension typecheck gate (roadmap.md
 * "vscode-extension を変更した場合" note). Mirrors GEN_PLUGIN_TRIGGER's
 * trigger-then-run shape.
 */
export const VSCODE_EXT_TRIGGER = /^packages\/vscode-extension\//;

// Conventional Commits subject line: type(scope)!: description.
// Scope and ! are optional; type must be one of the conventional set.
const CONVENTIONAL_COMMIT_PATTERN =
	/^(feat|fix|refactor|docs|chore|test|style|perf|build|ci|revert)(\([\w.,/-]+\))?!?: .+/;

// CJK punctuation through unified ideographs, plus fullwidth forms — the
// marker this repo's commit-language rule (CLAUDE.md: messages are English)
// can be checked by. "Is this English" is not mechanically decidable; "does
// this carry Japanese" is. One contiguous range rather than kana and
// ideographs separately: what sits between the obvious blocks — iteration
// marks, halfwidth katakana — is just as Japanese as the blocks.
//
// Deliberately not shared with graphviz-exporter's CJK_RE, which spans a
// similar range for an unrelated reason (the wasm Graphviz measures these
// glyphs at ASCII width). Tying the two together would drag this rule along
// whenever font metrics change.
const CJK_PATTERN = /[　-鿿＀-￯]/u;

// Backtick and double-quote spans are exempt: a subject may legitimately quote
// a Japanese identifier or heading that exists in the tree. Measured over this
// repo's 1795 non-merge subjects, 7 carry CJK and 1 of those is such a quote.
const QUOTED_SPAN_PATTERN = /`[^`]*`|"[^"]*"/g;

/**
 * Lint commit subjects against the Conventional Commits format and the
 * English-language rule (message format and language only — commit
 * granularity is a judgment call left to code review).
 * @param {string[]} subjects
 * @returns {Array<{subject: string, ok: boolean, reason?: string}>}
 */
export function lintCommitSubjects(subjects) {
	return subjects.map((subject) => {
		if (!CONVENTIONAL_COMMIT_PATTERN.test(subject)) {
			return { subject, ok: false, reason: "not Conventional Commits" };
		}
		if (CJK_PATTERN.test(subject.replace(QUOTED_SPAN_PATTERN, ""))) {
			return {
				subject,
				ok: false,
				reason: "non-English text outside quoted spans",
			};
		}
		return { subject, ok: true };
	});
}

/**
 * Parse a `<label> a, b, c` list line out of `pfdsl graph io` text output.
 * @param {string} auditText
 * @param {string} label line prefix, including its trailing colon
 * @returns {string[]}
 */
function parseAuditLine(auditText, label) {
	const line = auditText.split("\n").find((l) => l.startsWith(label));
	if (!line) return [];
	return line
		.slice(label.length)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Parse the `terminal artifacts: a, b, c` line out of `pfdsl graph io`
 * text output.
 * @param {string} auditText
 * @returns {string[]}
 */
export function parseAuditTerminals(auditText) {
	return parseAuditLine(auditText, "terminal artifacts:");
}

/**
 * Parse the `external-stakeholder terminals: a, b, c` line out of
 * `pfdsl graph io` text output — terminals kept out of the plain
 * `terminal artifacts:` line solely because they declare a non-empty
 * externalStakeholders.
 * @param {string} auditText
 * @returns {string[]}
 */
export function parseAuditExternalTerminals(auditText) {
	return parseAuditLine(auditText, "external-stakeholder terminals:");
}

/**
 * Terminal artifacts present after a change but not before — candidates for
 * the follow-up gatekeeper (protocol5(b)): classify each as means or
 * deliverable, and register a todo consumer if a means artifact lacks one.
 * @param {string[]} beforeTerminals
 * @param {string[]} afterTerminals
 * @returns {string[]}
 */
export function diffNewTerminals(beforeTerminals, afterTerminals) {
	const before = new Set(beforeTerminals);
	return afterTerminals.filter((t) => !before.has(t));
}

/**
 * Diff two `ready --json` process-id sets (workcycle step 4's "released
 * follow-up processes / updated ready set" report), derived mechanically
 * instead of via AI graph traversal.
 * @param {string[]} beforeIds
 * @param {string[]} afterIds
 * @returns {{newlyReady: string[], noLongerReady: string[]}}
 */
export function diffReadySets(beforeIds, afterIds) {
	const before = new Set(beforeIds);
	const after = new Set(afterIds);
	return {
		newlyReady: afterIds.filter((id) => !before.has(id)),
		noLongerReady: beforeIds.filter((id) => !after.has(id)),
	};
}

/**
 * Repo-relative path to the terminal-gate checklist (workcycle step 3). This
 * file is the single source of truth for wording — gate-check derives its
 * MANUAL: list from it instead of duplicating the text.
 */
export const GATE_CHECKLIST_SOURCE_PATH =
	".claude/skills/pfd-ops/references/work-cycle.md";

/**
 * Parse the terminal-gate checklist (workcycle step 3) into raw item strings.
 * @param {string} skillMdText
 * @returns {string[]}
 */
export function extractGateChecklist(skillMdText) {
	const lines = skillMdText.split("\n");
	const items = [];
	let inChecklist = false;
	for (const line of lines) {
		if (/^3\. \*\*反映/.test(line)) {
			inChecklist = true;
			continue;
		}
		if (inChecklist && /^4\. \*\*報告/.test(line)) break;
		if (!inChecklist) continue;
		const m = line.match(/^\s*-\s\[ \]\s(.+)$/);
		if (m) items.push(m[1].trim());
	}
	return items;
}

// Checklist items already covered by gate-check's own mechanized checks,
// matched by substring since the checklist source file's wording is the
// source of truth.
const COVERED_BY_GATE_CHECK = [
	"出力 artifact の status を更新した",
	"変更した全 .pfdsl が",
	"Conventional Commits 形式に従う",
];

/**
 * @param {string[]} checklistItems
 * @returns {string[]}
 */
export function deriveManualItems(checklistItems) {
	return checklistItems.filter(
		(item) => !COVERED_BY_GATE_CHECK.some((kw) => item.includes(kw)),
	);
}

/**
 * Classify the timing of a design-selection record against the branch's
 * first commit (issue #669's protection against "the decision record is
 * written after the fact"). A record posted after work already started
 * documents a choice that was made retroactively, not one that guided it.
 * @param {string | null | undefined} recordIso - createdAt of the record comment.
 * @param {string | null | undefined} firstCommitIso - authorDate of the range's first commit.
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifyDesignRecordTiming(recordIso, firstCommitIso) {
	if (!recordIso)
		return { status: "FAIL", detail: "no design-selection record found" };
	if (!firstCommitIso) return { status: "SKIP", detail: "no commits in range" };
	if (new Date(recordIso).getTime() > new Date(firstCommitIso).getTime()) {
		return {
			status: "FAIL",
			detail: `record posted at ${recordIso}, after the first commit at ${firstCommitIso}`,
		};
	}
	return { status: "PASS" };
}

export const DESIGN_RECORD_REQUIRED_PREFIXES = [
	"前提:",
	"否定案:",
	"却下理由:",
];
export const DISPOSITION_TOKENS = ["採用", "却下", "保留"];

/** Markdown line-head decoration: blockquote, heading, or list marker. */
const LINE_HEAD_DECORATION = /^(?:>+|#{1,6}|[-*+]|\d+[.)])\s*/;

/**
 * A record line with its markdown stripped, ready for a line-head match.
 *
 * Emphasis goes first and everywhere, because it wraps the label in three
 * different places (`**前提:**`, `**前提**:`) and none of them is the label.
 * Then every layer of line-head decoration, not just the first: a record line
 * is as likely to read `> - 却下理由:` as `却下理由:`, and peeling one layer
 * leaves the rest unrecognisable.
 * @param {string} line
 * @returns {string}
 */
export function normalizeRecordLine(line) {
	let stripped = line.trim().replace(/\*\*/g, "");
	while (LINE_HEAD_DECORATION.test(stripped)) {
		stripped = stripped.replace(LINE_HEAD_DECORATION, "");
	}
	return stripped.trim();
}

const REGEXP_METACHARS = /[.*+?^${}()|[\]\\]/g;

/**
 * A line head that carries `prefix`, for a line already through
 * normalizeRecordLine. The label text itself is fixed — a record saying
 * `前提条件:` has not written a `前提:` line — but two things around it are not
 * part of the label and must not decide the verdict: a parenthesised qualifier
 * (`却下理由（外部制約）:`, whose parenthetical carries the exemption clause's
 * required attribution) and a full-width colon.
 *
 * `tail` extends the match past the colon for the one line head that reads
 * something after it — the decision line's `案N`. Without it that line would be
 * the only member of the design-record family still matched by a bare regexp,
 * which is the fragility this whole normalisation exists to remove.
 * @param {string} prefix - a design-record line-head token, colon included
 * @param {string} [tail] - regexp source appended after the colon
 * @returns {RegExp}
 */
export function lineHeadPattern(prefix, tail = "") {
	const label = prefix.replace(/[:：]$/, "").replace(REGEXP_METACHARS, "\\$&");
	return new RegExp(`^${label}\\s*(?:（[^）]*）|\\([^)]*\\))?\\s*[:：]${tail}`);
}

/**
 * Which of the required line heads this text carries, in canonical order.
 * Serves both the content verdict and the record's identification, so the two
 * cannot disagree about what counts as a required line.
 * @param {string} recordBody
 * @returns {string[]} a subset of DESIGN_RECORD_REQUIRED_PREFIXES
 */
export function presentRequiredPrefixes(recordBody) {
	const lines = (recordBody ?? "").split("\n").map(normalizeRecordLine);
	return DESIGN_RECORD_REQUIRED_PREFIXES.filter((prefix) => {
		const pattern = lineHeadPattern(prefix);
		return lines.some((line) => pattern.test(line));
	});
}

/**
 * The entry that is this issue's selection record, or undefined.
 *
 * Identified by its own required line heads rather than by a `決定:` line. The
 * two are separate records with separate authors — the filer settles the design
 * with `決定:`, the runner writes the selection record — and keying one to the
 * other left no way to post a conforming record without also forging the
 * filer's decision line.
 *
 * Most matches wins rather than first match. Measured over this repo's issues,
 * bodies carry a stray required line head often enough that a first-match
 * search would elect the body and never examine the real record in a comment —
 * a check aimed at the wrong text, which reads exactly like a check that ran.
 * @param {Array<{author?: string, body?: string, createdAt?: string}>} entries
 */
export function selectDesignRecord(entries) {
	let best;
	let bestCount = 0;
	for (const entry of entries ?? []) {
		const count = presentRequiredPrefixes(entry.body).length;
		if (count > bestCount) {
			best = entry;
			bestCount = count;
		}
	}
	return best;
}

/**
 * Classify the content of a design-selection record. Two independent checks:
 * required line-head tokens are present, and every enumerated option got a
 * disposition word somewhere in the record.
 *
 * The disposition-token count is checked as "at least optionCount", not an
 * exact match, because ordinary prose can name the same option's disposition
 * more than once (e.g. "案2は却下する。却下理由は…") — an exact-match check
 * would FAIL a correct record for that.
 * @param {string} recordBody
 * @param {number} optionCount
 * @returns {{status: 'PASS'|'FAIL', detail?: string}}
 */
export function classifyDesignRecordContent(recordBody, optionCount) {
	const body = recordBody ?? "";
	const present = presentRequiredPrefixes(body);
	const missing = DESIGN_RECORD_REQUIRED_PREFIXES.filter(
		(prefix) => !present.includes(prefix),
	);

	const problems = [];
	if (missing.length > 0)
		problems.push(`missing required line(s): ${missing.join(", ")}`);

	if (optionCount > 0) {
		const dispositionCount = DISPOSITION_TOKENS.reduce(
			(sum, token) => sum + (body.split(token).length - 1),
			0,
		);
		if (dispositionCount < optionCount) {
			problems.push(
				`disposition tokens (${DISPOSITION_TOKENS.join("/")}) found ${dispositionCount} time(s), fewer than ${optionCount} enumerated option(s)`,
			);
		}
	}

	if (problems.length > 0)
		return { status: "FAIL", detail: problems.join("; ") };
	return { status: "PASS" };
}

// A declaration, not a reading. Scanning the body for shrink vocabulary fired
// on issues that merely quoted another issue's option name, which is the same
// "the machine guesses what the prose meant" failure the other #669 checks
// replaced with a token the filer writes.
export const SIZE_INTENT_PATTERN = /^Size-Intent:\s*shrink\b/m;
// Prose that accumulates procedure, wherever this repo keeps it. #669 named
// the first three and left the reason for that particular list unwritten; the
// companions were the gap (#732/#752), and being the largest of the set they
// were the ones the audit most needed. `.pfdsl/*.md` covers them by shape
// rather than by name, so a fourth companion arrives already tracked, while
// the graphs beside them stay out — a .pfdsl file's size moves for reasons
// this audit is not about.
export const SIZE_TRACKED_PATTERNS = [
	/^\.pfdsl\/[^/]+\.md$/,
	/^\.pfdsl\/bindings\//,
	/^docs\/adr\//,
	/(^|\/)SKILL\.md$/,
];
export const SIZE_OVERRIDE_PATTERN = /^Size-Override:\s*\S/m;

/**
 * Did any commit in the range declare that the growth is intended?
 *
 * The declaration lives in a commit trailer rather than the PR body (#775).
 * The terminal gate runs before the PR is opened, so the body was unreadable
 * in the ordinary case — the check had to carry a whole SKIP-vs-FAIL split
 * (`classifyPrBodyFailure`) just to say so — and a body can be edited after
 * the verdict, which a commit message cannot.
 *
 * Scanning the trailer region rather than every line is what keeps a commit
 * whose prose explains the token from declaring one (#726), and the prefix
 * filter is what keeps the Conventional Commits subject, itself `Key: value`
 * shaped, out of the answer.
 * @param {string | undefined | null} commitMessages - RECORD_SEP between messages
 * @returns {boolean}
 */
export function hasSizeOverride(commitMessages) {
	return trailerLines(commitMessages).some((line) =>
		SIZE_OVERRIDE_PATTERN.test(line),
	);
}

/**
 * Does the linked issue declare that something should get smaller?
 * @param {string | undefined | null} issueBody
 * @returns {boolean}
 */
export function hasShrinkIntent(issueBody) {
	return SIZE_INTENT_PATTERN.test(issueBody ?? "");
}

/**
 * The package layers this branch touched, read off the diff.
 *
 * The companion used to require the runner to name these in the PR body, and
 * three cycles in a row forgot to (#801). The claim was never the evidence:
 * the diff is, and it is available at gate time while the PR body is not. So
 * this is report material — printed for whoever writes the PR, judged by
 * nobody. What the declaration was for (noticing a layer mismatch before
 * starting) is a planning-time concern, and a line written at PR time was
 * always past the point where it could serve that.
 * @param {string[]} changedFiles
 * @returns {string[]} package directory names, sorted and deduplicated
 */
export function derivePackageLayers(changedFiles) {
	const layers = new Set();
	for (const file of changedFiles) {
		const match = /^packages\/([^/]+)\//.exec(file);
		if (match) layers.add(match[1]);
	}
	return [...layers].sort();
}

/**
 * One tracked knowledge artifact's size across the range under review.
 * @typedef {{path: string, beforeBytes: number, afterBytes: number,
 *            beforeLines: number, afterLines: number}} SizeDelta
 */

/**
 * One line describing a delta, in the one shape both the verdict's detail and
 * the report block use — an operator seeing them back to back reads the same
 * sentence twice, not two wordings of the same numbers.
 * @param {SizeDelta} d
 * @returns {string}
 */
export function formatSizeDelta(d) {
	const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
	const bytes = sign(d.afterBytes - d.beforeBytes);
	const lines = sign(d.afterLines - d.beforeLines);
	return `${d.path}: ${bytes} bytes / ${lines} lines (${d.beforeBytes} → ${d.afterBytes} bytes)`;
}

/**
 * Classify whether tracked knowledge artifacts moved in the direction a
 * shrink-intent issue asked for (issue #669's protection against "the
 * countermeasure's effect on size is never measured"). Only the verdict is
 * gated on the declaration — the deltas themselves are reported either way, so
 * a missing declaration costs the numbers nothing.
 *
 * `overrideDeclared` comes from the branch's commit trailers, which are local
 * and always present. The distinction #749 had to draw — "no override was
 * written" versus "the override could not be read" — belonged to a PR-body
 * lookup that no longer happens, so both it and the SKIP/FAIL line it drew are
 * gone (#775).
 * @param {{issueBody?: string, deltas: SizeDelta[], overrideDeclared?: boolean}} params
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifySizeDirection({ issueBody, deltas, overrideDeclared }) {
	if (!hasShrinkIntent(issueBody)) {
		return {
			status: "SKIP",
			detail: "linked issue declares no Size-Intent: shrink",
		};
	}
	if (!deltas || deltas.length === 0) {
		return { status: "SKIP", detail: "no tracked knowledge-artifact changes" };
	}

	const grown = deltas.filter((d) => d.afterBytes > d.beforeBytes);
	if (grown.length === 0) return { status: "PASS" };

	const list = grown.map(formatSizeDelta).join(", ");
	if (overrideDeclared) {
		return {
			status: "PASS",
			detail: `growth accepted via Size-Override: ${list}`,
		};
	}
	return { status: "FAIL", detail: list };
}
