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
 * Precise check: did a specific artifact's status: value change between two
 * full-file snapshots of .pfdsl/roadmap.pfdsl?
 * @param {string} beforeText
 * @param {string} afterText
 * @param {string} artifactKey
 * @returns {boolean}
 */
export function statusChangedForArtifact(beforeText, afterText, artifactKey) {
	const extractStatus = (text) => {
		const block = text.match(new RegExp(`\\n {2}${artifactKey}:\\n([\\s\\S]*?)(?=\\n {2}\\S+:\\n|$)`));
		if (!block) return undefined;
		const status = block[1].match(/status:\s*(\S+)/);
		return status ? status[1] : undefined;
	};
	return extractStatus(beforeText) !== extractStatus(afterText);
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
const COVERED_BY_GATE_CHECK = ["出力 artifact の status を更新した", "変更した全 .pfdsl が"];

/**
 * @param {string[]} checklistItems
 * @returns {string[]}
 */
export function deriveManualItems(checklistItems) {
	return checklistItems.filter((item) => !COVERED_BY_GATE_CHECK.some((kw) => item.includes(kw)));
}
