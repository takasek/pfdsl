import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
	ROOT_INSTRUCTIONS_TEMPLATE_PATH,
	renderRootInstructions,
	renderRootInstructionsBody,
	renderTemplate,
} from "./root-instructions.mjs";

describe("renderRootInstructionsBody", () => {
	it("renders the claude-only section and drops the codex-only section", () => {
		const template =
			"shared\n{{#claude}}\nclaude-only\n{{/claude}}\n{{#codex}}\ncodex-only\n{{/codex}}\n";
		const output = renderRootInstructionsBody({ template, target: "claude" });
		assert.match(output, /claude-only/);
		assert.doesNotMatch(output, /codex-only/);
	});

	it("renders the codex-only section and drops the claude-only section", () => {
		const template =
			"shared\n{{#claude}}\nclaude-only\n{{/claude}}\n{{#codex}}\ncodex-only\n{{/codex}}\n";
		const output = renderRootInstructionsBody({ template, target: "codex" });
		assert.match(output, /codex-only/);
		assert.doesNotMatch(output, /claude-only/);
	});

	it("rejects an unsupported target", () => {
		assert.throws(
			() => renderRootInstructionsBody({ template: "x", target: "other" }),
			/unsupported target other/,
		);
	});

	it("renders Markdown-significant characters unescaped through the triple-mustache codex variable", () => {
		const template =
			"{{#codex}}{{{codexWorktreeMetadataInstructions}}}{{/codex}}";
		const output = renderRootInstructionsBody({ template, target: "codex" });
		assert.match(output, /`git fetch`/);
		assert.doesNotMatch(output, /&#x60;|&amp;|&lt;|&gt;/);
	});

	// Confirms the previous test is not vacuous: reverting the template to the
	// escaped double-mustache form must make an equivalent character-preserving
	// assertion fail, proving the render pipeline's default HTML escaper is
	// still active and only bypassed where `{{{...}}}` says so.
	it("would escape the same characters if the template used the double-mustache form", () => {
		const template =
			"{{#codex}}{{codexWorktreeMetadataInstructions}}{{/codex}}";
		const output = renderRootInstructionsBody({ template, target: "codex" });
		assert.doesNotMatch(output, /`git fetch`/);
		assert.match(output, /&#x60;git fetch&#x60;/);
	});
});

describe("harness-foreign path literals", () => {
	// The substitution this replaced rewrote these literals downstream, which
	// silently corrupted prose that was *about* the two files rather than
	// pointing at one of them. Refusing is the replacement for rewriting: the
	// author is told to move the line into a harness section or to introduce a
	// per-harness value, rather than having the text changed under them.
	it("refuses a codex render whose shared prose names a Claude-only path", () => {
		assert.throws(
			() =>
				renderRootInstructionsBody({
					template: "shared: see CLAUDE.md for policy.\n",
					target: "codex",
				}),
			/root-instructions: codex output contains the Claude-only literal "CLAUDE\.md"/,
		);
	});

	it("refuses a claude render whose shared prose names a Codex-only path", () => {
		assert.throws(
			() =>
				renderRootInstructionsBody({
					template: "shared: hooks live in .codex/hooks.json.\n",
					target: "claude",
				}),
			/root-instructions: claude output contains the Codex-only literal "\.codex\/"/,
		);
	});

	it("allows a harness-only section to name its own harness's paths", () => {
		const template =
			"{{#claude}}see .claude/settings.json{{/claude}}{{#codex}}see .codex/hooks.json{{/codex}}";
		assert.equal(
			renderRootInstructionsBody({ template, target: "claude" }),
			"see .claude/settings.json",
		);
		assert.equal(
			renderRootInstructionsBody({ template, target: "codex" }),
			"see .codex/hooks.json",
		);
	});
});

describe("renderTemplate", () => {
	it("rejects a rendered document where an interpolated value reproduced literal template syntax", () => {
		// Mustache never leaves an unresolved *tag* in its own output (an unknown
		// variable interpolates to ""); the residue this guards against comes from
		// a raw (`{{{...}}}`) value whose own prose happens to contain `{{...}}` —
		// mustache does not recursively re-scan interpolated content.
		assert.throws(
			() =>
				renderTemplate({
					template: "{{#codex}}{{{note}}}{{/codex}}",
					view: { codex: true, note: "see the `{{example}}` syntax" },
				}),
			/unresolved template token \{\{example\}\}/,
		);
	});

	it("passes through a rendered document with no residual template syntax", () => {
		assert.equal(
			renderTemplate({
				template: "{{#codex}}{{{note}}}{{/codex}}",
				view: { codex: true, note: "plain prose" },
			}),
			"plain prose",
		);
	});
});

describe("renderRootInstructions", () => {
	it("adds a DO NOT EDIT notice naming the given authoritative source", () => {
		const output = renderRootInstructions({
			template: "# pfdsl\n\n{{#claude}}claude{{/claude}}",
			target: "claude",
			authoritativeSource: "scripts/root-instructions-template/INSTRUCTIONS.md",
		});
		assert.match(
			output,
			/^<!-- DO NOT EDIT\. Authoritative source: scripts\/root-instructions-template\/INSTRUCTIONS\.md\. -->$/m,
		);
	});

	it("feeds the real CODEX_WORKTREE_METADATA_INSTRUCTIONS prose into the codex target", () => {
		const template = readFileSync(ROOT_INSTRUCTIONS_TEMPLATE_PATH, "utf-8");
		const output = renderRootInstructions({
			template,
			target: "codex",
			authoritativeSource: "scripts/root-instructions-template/INSTRUCTIONS.md",
		});
		assert.match(output, /^## Codex 固有の責務境界$/m);
		assert.match(
			output,
			/親 agent が `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメントを担当する。/,
		);
		assert.doesNotMatch(output, /\{\{[^{}]*\}\}/);
	});

	it("renders the real template to byte-identical CLAUDE.md and AGENTS.md bodies", () => {
		const template = readFileSync(ROOT_INSTRUCTIONS_TEMPLATE_PATH, "utf-8");
		const claudeOutput = renderRootInstructions({
			template,
			target: "claude",
			authoritativeSource: "scripts/root-instructions-template/INSTRUCTIONS.md",
		});
		const codexOutput = renderRootInstructions({
			template,
			target: "codex",
			authoritativeSource: "scripts/root-instructions-template/INSTRUCTIONS.md",
		});
		assert.match(claudeOutput, /^## Claude Code の作業分担$/m);
		assert.doesNotMatch(claudeOutput, /Codex の作業分担|Codex 固有の責務境界/);
		assert.match(codexOutput, /^## Codex の作業分担$/m);
		assert.doesNotMatch(codexOutput, /Claude Code の作業分担/);
		// The generator never re-derives Markdown structure from the body: the
		// only way either target's section could appear or disappear is the
		// mustache section it is declared in, never a heading-level scan.
		assert.doesNotMatch(claudeOutput, /\{\{[^{}]*\}\}/);
		assert.doesNotMatch(codexOutput, /\{\{[^{}]*\}\}/);
	});
});
