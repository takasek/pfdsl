/**
 * Pure functions for terminal-gate aggregate checking.
 * Process/git I/O lives in the main script; this module stays testable.
 */

// The pfd-ops step-3 checklist items that stay judgment-only — no mechanical
// check can substitute for them. Kept in sync with the SKILL.md checklist;
// the 6 mechanically-verifiable items are covered by gate-check's own checks.
export const MANUAL_ITEMS = [
	"companion（roadmap.md 等）が定義するリポ固有の追加ゲート項目を確認したか",
	"知見を .pfdsl/workflow.pfdsl の sibling companion の振り分け手続きに従って振り分けたか",
	"実行中に発見した新プロセス・成果物を .pfdsl/roadmap.pfdsl に追記したか",
	"`check --audit` で終端 artifact 一覧を取得し、後続門番（手段成果物に消費プロセスが繋がっているか）を確認したか",
	"変換コンポーネントを追加・変更・削除した場合、それをモデル化している採用済み PFD に反映したか",
	"作業中に偶発的に見つけたスコープ外の既存問題を起票したか",
	"コミット規約（粒度・メッセージ形式）に従ってコミットしたか",
	"/simplify または /code-review を実施したか",
	"変更束を PR にまとめたか",
];

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
 * @param {string} diffText - unified diff of .pfdsl/roadmap.pfdsl
 * @returns {boolean}
 */
export function hasStatusChange(diffText) {
	return diffText.split("\n").some((line) => {
		if (line.startsWith("--- ") || line.startsWith("+++ ")) return false;
		return /^[+-]/.test(line) && /status:/.test(line);
	});
}
