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
	/^(feat|fix|refactor|docs|chore|test|style|perf|build|ci|revert)(\([\w./-]+\))?!?: .+/;

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
 * Parse the `terminal artifacts: a, b, c` line out of `pfdsl check --audit`
 * text output.
 * @param {string} auditText
 * @returns {string[]}
 */
export function parseAuditTerminals(auditText) {
	const line = auditText.split("\n").find((l) => l.startsWith("terminal artifacts:"));
	if (!line) return [];
	return line
		.slice("terminal artifacts:".length)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
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
