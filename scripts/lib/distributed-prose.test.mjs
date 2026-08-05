import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findRepoSpecificProse } from "./distributed-prose.mjs";

const at = (content, path = "skills/pfd-retro/SKILL.md") => [{ path, content }];
const rules = (content) =>
	findRepoSpecificProse(at(content)).map((f) => f.rule);

describe("bundle-path rule", () => {
	it("flags a bundle path written only in its repo-local form", () => {
		// An adopting repo loads the bundle from the plugin cache, so `.claude/`
		// never resolves there and the reader is sent to a file that cannot exist.
		const found = findRepoSpecificProse(
			at("pfd-lens agent（`.claude/agents/pfd-lens.md`）へ委譲する。\n"),
		);
		assert.equal(found.length, 1);
		assert.equal(found[0].rule, "bundle-path");
		assert.equal(found[0].line, 1);
	});

	it("accepts a path qualified with the plugin root on the same line", () => {
		assert.deepEqual(
			rules(
				// biome-ignore lint/suspicious/noTemplateCurlyInString: documents the literal ${CLAUDE_PLUGIN_ROOT} placeholder
				"plugin なら `${CLAUDE_PLUGIN_ROOT}/skills/pfdsl/`、repo-local なら `.claude/skills/pfdsl/`。\n",
			),
			[],
		);
	});

	it("accepts a repo-local path that names the load mode it belongs to", () => {
		assert.deepEqual(
			rules("- repo-local: `.claude/skills/pfd-ops/references/scaffold/`\n"),
			[],
		);
	});

	it("ignores .pfdsl paths, which live in the adopting repo and resolve there", () => {
		assert.deepEqual(rules("`.pfdsl/bindings/pfd-retro.md` に従う\n"), []);
	});

	it("ignores .claude paths outside the bundle's own trees", () => {
		assert.deepEqual(rules("`.claude/settings.json` で配線する\n"), []);
	});
});

describe("issue-ref rule", () => {
	it("flags a bare issue citation", () => {
		const found = findRepoSpecificProse(
			at("素の `--deploy` を先に実行する（#603）。\n"),
		);
		assert.equal(found.length, 1);
		assert.equal(found[0].rule, "issue-ref");
		assert.match(found[0].reason, /#603/);
	});

	it("allows a number inside inline code, which reads as an example", () => {
		// `- [ ] #123` shows the reader a task-list syntax, it does not cite an issue.
		assert.deepEqual(
			rules("本文中の手書き `- [ ] #123` 形式は自動チェックされない\n"),
			[],
		);
	});

	it("allows ADR references, which the bundle resolves for the reader", () => {
		assert.deepEqual(rules("配置手順は ADR-0028 に従う\n"), []);
	});

	it("ignores a single digit, which is not an issue citation shape", () => {
		assert.deepEqual(rules("手順 #1 から始める\n"), []);
	});
});

describe("scanning", () => {
	it("skips fenced blocks, which are quoted commands rather than prose", () => {
		assert.deepEqual(
			rules("```sh\nnode .claude/skills/pfd-ops/x.mjs # see #603\n```\n"),
			[],
		);
	});

	it("reports every offending line with its 1-based number", () => {
		const found = findRepoSpecificProse(
			at("ok\n`.claude/skills/pfd-ops/` を読む\nok\n（#480）\n"),
		);
		assert.deepEqual(
			found.map((f) => [f.line, f.rule]),
			[
				[2, "bundle-path"],
				[4, "issue-ref"],
			],
		);
	});

	it("returns nothing for an empty file set", () => {
		assert.deepEqual(findRepoSpecificProse([]), []);
	});
});
