import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findUnqualifiedBundlePaths } from "./bundle-paths.mjs";

const at = (path, content) => [{ path, content }];

describe("findUnqualifiedBundlePaths", () => {
	it("flags a bundle path written only in its repo-local form", () => {
		// An adopting repo loads the bundle from the plugin cache, so `.claude/`
		// never resolves there and the reader is sent to a file that cannot exist.
		const found = findUnqualifiedBundlePaths(
			at("skills/pfd-retro/SKILL.md", "pfd-lens agent（`.claude/agents/pfd-lens.md`）へ委譲する。\n"),
		);
		assert.equal(found.length, 1);
		assert.equal(found[0].path, "skills/pfd-retro/SKILL.md");
		assert.equal(found[0].line, 1);
		assert.match(found[0].text, /pfd-lens/);
	});

	it("accepts a path qualified with the plugin root on the same line", () => {
		const found = findUnqualifiedBundlePaths(
			at("a.md", "plugin なら `${CLAUDE_PLUGIN_ROOT}/skills/pfdsl/`、repo-local なら `.claude/skills/pfdsl/`。\n"),
		);
		assert.deepEqual(found, []);
	});

	it("accepts a repo-local path that names the load mode it belongs to", () => {
		const found = findUnqualifiedBundlePaths(at("a.md", "- repo-local: `.claude/skills/pfd-ops/references/scaffold/`\n"));
		assert.deepEqual(found, []);
	});

	it("reports every offending line with its 1-based number", () => {
		const found = findUnqualifiedBundlePaths(
			at("a.md", "ok\n`.claude/skills/pfd-ops/` を読む\nok\n`.claude/agents/x.md` を読む\n"),
		);
		assert.deepEqual(
			found.map((f) => f.line),
			[2, 4],
		);
	});

	it("ignores .pfdsl paths, which live in the adopting repo and resolve there", () => {
		const found = findUnqualifiedBundlePaths(at("a.md", "`.pfdsl/bindings/pfd-retro.md` に従う\n"));
		assert.deepEqual(found, []);
	});

	it("ignores .claude paths outside the bundle's own trees", () => {
		// settings.json / worktrees belong to whoever is reading, not to the bundle.
		const found = findUnqualifiedBundlePaths(at("a.md", "`.claude/settings.json` で配線する\n"));
		assert.deepEqual(found, []);
	});

	it("returns nothing for an empty file set", () => {
		assert.deepEqual(findUnqualifiedBundlePaths([]), []);
	});
});
