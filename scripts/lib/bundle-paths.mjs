// Guards the mechanical half of "prose written from the upstream's chair"
// (#674): a bundle-internal path spelled only in its repo-local form.
//
// The bundle is loaded two ways — from the plugin cache (${CLAUDE_PLUGIN_ROOT})
// in an adopting repo, and from .claude/ in this repo, which develops it. Prose
// that names only the second sends every adopting reader to a path that cannot
// exist there, with nothing to tell them the line does not apply to them.
//
// Scope note, deliberately narrow: the wider class (prose whose subject is the
// upstream's own build — "the repo root is the bundling source") is semantic,
// not lexical. Measuring candidate keywords against the tree rejected them:
// 「リポルート」 appears 7 times and 6 mean the *adopting* repo's root. A check
// that fires on those would be the constant-false-positive trap, so it is not
// attempted here. This catches the subset that is actually decidable from text.
const BUNDLE_PATH = /`?\.claude\/(?:skills|agents|commands)\//;

// Either marker resolves the ambiguity: naming the plugin root shows the other
// load mode, and naming the mode labels the path as the repo-local branch.
const QUALIFIERS = [/CLAUDE_PLUGIN_ROOT/, /repo-local/];

/**
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, line: number, text: string}>} one per offending line
 */
export function findUnqualifiedBundlePaths(files) {
	const found = [];
	for (const { path, content } of files) {
		content.split("\n").forEach((text, i) => {
			if (!BUNDLE_PATH.test(text)) return;
			if (QUALIFIERS.some((q) => q.test(text))) return;
			found.push({ path, line: i + 1, text: text.trim() });
		});
	}
	return found;
}
