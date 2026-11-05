import assert from "node:assert/strict";
import { it } from "node:test";
import { renderHarnessTemplate } from "./harness-template.mjs";

it("renders only explicit harness sections and raw path variables", () => {
	const source =
		"Common CLAUDE.md quoted error. {{#claude}}Claude{{/claude}}{{#codex}}Codex{{/codex}} {{{repoSkillRoot}}} {{{rootInstructionsFile}}} {{{pluginRootExpression}}}";
	assert.equal(
		renderHarnessTemplate(source, "codex"),
		`Common CLAUDE.md quoted error. Codex .agents/skills AGENTS.md \${PLUGIN_ROOT}`,
	);
	assert.equal(
		renderHarnessTemplate(source, "claude"),
		`Common CLAUDE.md quoted error. Claude .claude/skills CLAUDE.md \${CLAUDE_PLUGIN_ROOT}`,
	);
});

it("rejects unknown tags even inside a section omitted for the target", () => {
	for (const source of [
		"{{#codx}}lost{{/codx}}",
		"{{#claude}}{{{typo}}}{{/claude}}",
		"{{repoSkillRoot}}",
		"{{>partial}}",
		"{{#claude}}x{{/codex}}",
		"{{#codex}}unfinished",
		"{{{repoSkillRoot}}",
		"{{!hidden}}",
	]) {
		assert.throws(
			() => renderHarnessTemplate(source, "codex"),
			/harness-template:/,
		);
	}
});

it("rejects unsupported targets and preserves literal text", () => {
	for (const target of ["other", "toString", "__proto__"])
		assert.throws(
			() => renderHarnessTemplate("body", target),
			/harness-template:/,
		);
	assert.equal(
		renderHarnessTemplate(
			"Claude Code Remote, .claude-plugin, $ARGUMENTS",
			"codex",
		),
		"Claude Code Remote, .claude-plugin, $ARGUMENTS",
	);
});
