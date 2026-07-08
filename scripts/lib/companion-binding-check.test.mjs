import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	extractPathReferences,
	resolveCheckTarget,
	findMissingHeadings,
} from "./companion-binding-check.mjs";

describe("extractPathReferences", () => {
	it("extracts inline-code paths starting with docs/, .claude/, scripts/, packages/", () => {
		const text =
			"See `docs/spec/spec.md` and `.claude/skills/pfd-ops/SKILL.md` and `scripts/gen-skill.mjs` and `packages/cli/src/index.ts`.";
		assert.deepEqual(extractPathReferences(text), [
			"docs/spec/spec.md",
			".claude/skills/pfd-ops/SKILL.md",
			"scripts/gen-skill.mjs",
			"packages/cli/src/index.ts",
		]);
	});

	it("ignores non-path inline code and npm package names", () => {
		const text = "Run `onSuccess` and import `@pfdsl/core` and use `docs` as a word.";
		assert.deepEqual(extractPathReferences(text), []);
	});

	it("ignores markdown link targets outside the prefix set", () => {
		const text = "See [the spec](https://example.com/spec.md) for details.";
		assert.deepEqual(extractPathReferences(text), []);
	});

	it("extracts markdown link targets matching the prefix set", () => {
		const text = "See [the spec](docs/spec/spec.md) for details.";
		assert.deepEqual(extractPathReferences(text), ["docs/spec/spec.md"]);
	});

	it("skips inline code inside fenced code blocks", () => {
		const text = "```\n`docs/should-not-be-checked.md`\n```\nBut `docs/should-be-checked.md` is fine.";
		assert.deepEqual(extractPathReferences(text), ["docs/should-be-checked.md"]);
	});

	it("extracts a path token embedded in a command inside inline code", () => {
		const text = "Run `node scripts/audit-issues-flow.mjs --fix` to fix.";
		assert.deepEqual(extractPathReferences(text), [
			"scripts/audit-issues-flow.mjs",
		]);
	});

	it("normalizes a trailing bare dot (shell cwd argument) off a path token", () => {
		const text = "Run `cp -r .claude/skills/pfd-ops/install/. .` to adopt.";
		assert.deepEqual(extractPathReferences(text), [
			".claude/skills/pfd-ops/install/",
		]);
	});

	it("strips a trailing #anchor from a markdown link target", () => {
		const text = "See [details](docs/spec/spec.md#section) for more.";
		assert.deepEqual(extractPathReferences(text), ["docs/spec/spec.md"]);
	});

	it("deduplicates repeated references", () => {
		const text = "`docs/samples/` appears twice: `docs/samples/`.";
		assert.deepEqual(extractPathReferences(text), ["docs/samples/"]);
	});
});

describe("resolveCheckTarget", () => {
	it("returns the path unchanged when it has no placeholder or glob", () => {
		assert.equal(resolveCheckTarget("docs/spec/spec.md"), "docs/spec/spec.md");
	});

	it("returns null for paths containing a <placeholder>", () => {
		assert.equal(resolveCheckTarget(".claude/skills/<name>"), null);
	});

	it("resolves a glob path to its containing directory", () => {
		assert.equal(
			resolveCheckTarget("docs/spec/proposals/*.md"),
			"docs/spec/proposals/",
		);
	});

	it("resolves a glob with a wildcard mid-path to the directory before the wildcard segment", () => {
		assert.equal(resolveCheckTarget("packages/*/dist/"), "packages/");
	});

	it("returns null for a glob with no static directory prefix", () => {
		assert.equal(resolveCheckTarget("*.md"), null);
	});
});

describe("findMissingHeadings", () => {
	it("returns an empty array when all required headings are present", () => {
		const text = "# Title\n\n## pfd-retro バインディング\n\n### retro 実行記録\n";
		assert.deepEqual(
			findMissingHeadings(text, ["pfd-retro バインディング", "retro 実行記録"]),
			[],
		);
	});

	it("returns the missing heading text when absent", () => {
		const text = "# Title\n\n## pfd-retro バインディング\n";
		assert.deepEqual(
			findMissingHeadings(text, ["pfd-retro バインディング", "retro 実行記録"]),
			["retro 実行記録"],
		);
	});

	it("does not match heading text appearing outside a heading line", () => {
		const text = "# Title\n\nprose mentioning retro 実行記録 in passing, not as a heading.\n";
		assert.deepEqual(findMissingHeadings(text, ["retro 実行記録"]), [
			"retro 実行記録",
		]);
	});
});
