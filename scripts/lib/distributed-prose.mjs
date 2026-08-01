// Guards the distributed prompts against repo-specific content — text that
// only means something to someone sitting in this repository, shipped to
// people who are not (#674, and #340 before it, which recurred through its
// own fix).
//
// Each rule below is decidable from the text. The wider class — prose whose
// *subject* is this repo's own build ("the repo root is the bundling source")
// — is semantic, and keyword detection for it was measured and rejected:
// 「リポルート」 occurs 7 times in the bundle and 6 of them correctly mean the
// *adopting* repo's root. A rule firing on those would be noise, and a check
// that is mostly noise stops being read. That subset stays with human review.
//
// Adding a rule: append to RULES. Each returns a reason for an offending line,
// or undefined.

/** Inline code is quoted material — an example, not a claim about this repo. */
function stripCode(line) {
	return line.replace(/`[^`]*`/g, "");
}

const RULES = [
	{
		name: "bundle-path",
		// The bundle loads from the plugin cache in an adopting repo, so a path
		// given only in its .claude/ form points at something that cannot exist
		// there. Naming the plugin root, or labelling the line as the repo-local
		// branch, resolves it.
		test(line) {
			if (!/\.claude\/(?:skills|agents|commands)\//.test(line)) return undefined;
			if (["CLAUDE_PLUGIN_ROOT", "repo-local"].some((q) => line.includes(q))) return undefined;
			return "bundle path written only in its repo-local form";
		},
	},
	{
		name: "issue-ref",
		// An adopting repo has no #603. Unlike ADR-\d+, which architecture.md
		// resolves to the upstream repo for the reader, a bare issue number
		// resolves to whatever the reader's own tracker holds under that number.
		test(line) {
			const m = /#\d{2,}/.exec(stripCode(line));
			return m ? `bare issue reference ${m[0]} — adopters cannot resolve it` : undefined;
		},
	},
];

/**
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, line: number, rule: string, reason: string, text: string}>}
 */
export function findRepoSpecificProse(files) {
	const found = [];
	for (const { path, content } of files) {
		let inFence = false;
		content.split("\n").forEach((text, i) => {
			if (/^\s*```/.test(text)) {
				inFence = !inFence;
				return;
			}
			if (inFence) return;
			for (const rule of RULES) {
				const reason = rule.test(text);
				if (reason) found.push({ path, line: i + 1, rule: rule.name, reason, text: text.trim() });
			}
		});
	}
	return found;
}
