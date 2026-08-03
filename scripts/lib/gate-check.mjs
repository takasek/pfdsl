/**
 * Pure functions for terminal-gate aggregate checking.
 * Process/git I/O lives in the main script; this module stays testable.
 */

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
		return { status: "SKIP", detail: "gh CLI unavailable; GitHub-dependent checks skipped (see #492)" };
	}
	return { status: "FAIL", detail: "re-run: node scripts/pfdsl/audit-issues-flow.mjs (findings)" };
}

/**
 * @param {Array<{name: string, status: 'PASS'|'FAIL'|'SKIP', detail?: string}>} results
 * @returns {string}
 */
export function formatGateTable(results) {
	const symbol = (status) => (status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "-");
	return results
		.map((r) => `  ${symbol(r.status)} ${r.status.padEnd(4)} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`)
		.join("\n");
}

/** Shared by both checks scoped to the output artifact, so they cannot drift apart. */
export const NO_ARTIFACT_DETAIL = "cycle declared it has no roadmap output artifact (--no-artifact)";

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
export function classifyOutputArtifactStatus({ artifactKey, noArtifact, roadmapChanged, changed }) {
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
			detail: changed ? undefined : `no status: change detected for artifact '${artifactKey}'`,
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
	const block = text.match(new RegExp(`\\n {2}${artifactKey}:\\n([\\s\\S]*?)(?=\\n {2}\\S+:\\n|$)`));
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
	return extractArtifactStatus(beforeText, artifactKey) !== extractArtifactStatus(afterText, artifactKey);
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
		return fileSnapshots.some((text) => extractArtifactStatus(text, artifactKey) === "wip");
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

/**
 * Lint commit subjects against the Conventional Commits format (message
 * format only — commit granularity is a judgment call left to code review).
 * @param {string[]} subjects
 * @returns {Array<{subject: string, ok: boolean}>}
 */
export function lintCommitSubjects(subjects) {
	return subjects.map((subject) => ({ subject, ok: CONVENTIONAL_COMMIT_PATTERN.test(subject) }));
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
export const GATE_CHECKLIST_SOURCE_PATH = ".claude/skills/pfd-ops/references/work-cycle.md";

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
	return checklistItems.filter((item) => !COVERED_BY_GATE_CHECK.some((kw) => item.includes(kw)));
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
	if (!recordIso) return { status: "FAIL", detail: "no design-selection record found" };
	if (!firstCommitIso) return { status: "SKIP", detail: "no commits in range" };
	if (new Date(recordIso).getTime() > new Date(firstCommitIso).getTime()) {
		return {
			status: "FAIL",
			detail: `record posted at ${recordIso}, after the first commit at ${firstCommitIso}`,
		};
	}
	return { status: "PASS" };
}

export const DESIGN_RECORD_REQUIRED_PREFIXES = ["前提:", "否定案:", "却下理由:"];
export const DISPOSITION_TOKENS = ["採用", "却下", "保留"];

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
	const lines = body
		.split("\n")
		.map((line) => line.trim().replace(/^#{1,6}\s*/, "").replace(/^\*\*/, ""));
	const missing = DESIGN_RECORD_REQUIRED_PREFIXES.filter(
		(prefix) => !lines.some((line) => line.startsWith(prefix)),
	);

	const problems = [];
	if (missing.length > 0) problems.push(`missing required line(s): ${missing.join(", ")}`);

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

	if (problems.length > 0) return { status: "FAIL", detail: problems.join("; ") };
	return { status: "PASS" };
}

export const SHRINK_INTENT_KEYWORDS = ["肥大", "全読", "スケール監査", "蒸留"];
export const SIZE_TRACKED_PATTERNS = [/^\.pfdsl\/bindings\//, /^docs\/adr\//, /(^|\/)SKILL\.md$/];
export const SIZE_OVERRIDE_PATTERN = /^Size-Override:\s*\S/m;

/**
 * Classify whether tracked knowledge artifacts moved in the direction a
 * shrink-intent issue asked for (issue #669's protection against "the
 * countermeasure's effect on size is never measured").
 * @param {{issueBody?: string, deltas: Array<{path: string, beforeBytes: number, afterBytes: number,
 *          beforeLines: number, afterLines: number}>, prBody?: string}} params
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifySizeDirection({ issueBody, deltas, prBody }) {
	const body = issueBody ?? "";
	if (!SHRINK_INTENT_KEYWORDS.some((kw) => body.includes(kw))) {
		return { status: "SKIP", detail: "linked issue states no shrink intent" };
	}
	if (!deltas || deltas.length === 0) {
		return { status: "SKIP", detail: "no tracked knowledge-artifact changes" };
	}

	const grown = deltas.filter((d) => d.afterBytes > d.beforeBytes);
	if (grown.length === 0) return { status: "PASS" };

	const list = grown
		.map((d) => `${d.path}: +${d.afterBytes - d.beforeBytes} bytes / +${d.afterLines - d.beforeLines} lines`)
		.join(", ");
	if (SIZE_OVERRIDE_PATTERN.test(prBody ?? "")) {
		return { status: "PASS", detail: `growth accepted via Size-Override: ${list}` };
	}
	return { status: "FAIL", detail: list };
}
