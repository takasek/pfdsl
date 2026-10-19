import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findRepoSpecificProse } from "./distributed-prose.mjs";

const at = (content, path = "skills/pfd-retro/SKILL.md") => [{ path, content }];
const rules = (content) =>
	findRepoSpecificProse(at(content)).map((f) => f.rule);

describe("bundle-path policy", () => {
	it("flags an unqualified bundle path even inside inline code", () => {
		assert.deepEqual(rules("Read `.claude/skills/pfd-ops/SKILL.md`."), [
			"bundle-path",
		]);
	});
	it("allows the plugin-root and repo-local qualifications", () => {
		assert.deepEqual(
			rules("repo-local: `.claude/skills/pfd-ops/SKILL.md`."),
			[],
		);
		assert.deepEqual(
			rules("CLAUDE_PLUGIN_ROOT: `.claude/skills/pfd-ops/SKILL.md`."),
			[],
		);
	});
	it("leaves adopting-repository paths outside the bundle policy", () => {
		assert.deepEqual(
			rules("Read `.pfdsl/bindings/pfd-ops.md` and `.claude/settings.json`."),
			[],
		);
	});
});

describe("issue-reference policy", () => {
	it("exempts parsed GitHub issue/PR identities and their subpages", () => {
		for (const content of [
			"See [#674](https://github.com/o/r/issues/674).",
			"See [o/r#674](https://github.com/o/r/pull/674/checks).",
		])
			assert.deepEqual(rules(content), []);
	});
	it("resolves reference definitions and exempts their syntax", () => {
		assert.deepEqual(
			rules("See [#674][].\n\n[#674]: https://github.com/o/r/issues/674"),
			[],
		);
	});
	it("uses the first definition when identifiers collide", () => {
		assert.deepEqual(
			rules(
				"See [#674][upstream].\n\n[upstream]: https://example.com\n[upstream]: https://github.com/o/r/issues/674",
			),
			["issue-ref"],
		);
	});
	it("keeps unresolved references and image alt text in scope", () => {
		assert.deepEqual(rules("See [#674][missing]."), ["issue-ref"]);
		assert.deepEqual(rules("![#674](https://github.com/o/r/issues/674)"), [
			"issue-ref",
		]);
	});
	it("does not exempt another host, identity, protocol or non-issue page", () => {
		for (const destination of [
			"issues/674",
			"https://github.com.example/o/r/issues/674",
			"https://user@github.com/o/r/issues/674",
			"https://github.com:8443/o/r/issues/674",
			"http://github.com/o/r/issues/674",
			"https://github.com/o/r",
			"https://github.com/o/r/issues/0",
		])
			assert.deepEqual(rules(`See [#674](${destination}).`), ["issue-ref"]);
	});
	it("requires an actual parsed link before exempting a URL", () => {
		assert.deepEqual(
			rules("See [#674](https://github.com/o/r/issues/674?q=(foo)."),
			["issue-ref"],
		);
	});
	it("retains bare references and original CRLF diagnostics beside a multiline link", () => {
		const content =
			"😀\r\nSee [#674](\r\nhttps://github.com/o/r/issues/674\r\n) and #675.\r\n";
		assert.deepEqual(findRepoSpecificProse(at(content)), [
			{
				path: "skills/pfd-retro/SKILL.md",
				line: 4,
				rule: "issue-ref",
				reason: "bare issue reference #675 — adopters cannot resolve it",
				text: ") and #675.",
			},
		]);
	});
	it("keeps the issue-token threshold without treating ADRs as issues", () => {
		assert.deepEqual(rules("Step #1 follows ADR-0028."), []);
		assert.deepEqual(rules("See #674."), ["issue-ref"]);
	});
});

describe("parser and diagnostic integration", () => {
	it("ignores block code for both rules but inline code only for issue references", () => {
		const content =
			"Read `#674 .claude/skills/pfd-ops/SKILL.md`.\n\n```md\n#674 .claude/skills/pfd-ops/SKILL.md\n```\nSee #675.";
		assert.deepEqual(
			findRepoSpecificProse(at(content)).map(({ line, rule }) => [line, rule]),
			[
				[1, "bundle-path"],
				[6, "issue-ref"],
			],
		);
	});
	it("keeps bundle-path checks active inside resolved link labels", () => {
		assert.deepEqual(
			rules("[.claude/skills/pfd-ops/#674](https://github.com/o/r/issues/674)"),
			["bundle-path"],
		);
	});
	it("preserves each input file path in findings", () => {
		const found = findRepoSpecificProse([
			...at("See #674.", "skills/a.md"),
			...at("ok\nSee #675.", "skills/b.md"),
		]);
		assert.deepEqual(
			found.map(({ path, line }) => [path, line]),
			[
				["skills/a.md", 1],
				["skills/b.md", 2],
			],
		);
	});
	it("accepts an empty file set", () => {
		assert.deepEqual(findRepoSpecificProse([]), []);
	});
});
