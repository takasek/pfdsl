import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	agentToCodexToml,
	buildCodexPluginManifest,
	claudeHooksToCodexHooks,
	claudeInstructionsToAgents,
	commandToCodexSkill,
} from "./gen-codex-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseTomlDeveloperInstructions(source) {
	const match = source.match(/^developer_instructions = """([\s\S]*)"""\n$/m);
	assert.ok(match, "expected a multiline TOML developer_instructions value");
	const encoded = match[1].startsWith("\n") ? match[1].slice(1) : match[1];
	const escapes = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

	return encoded.replace(/\\([\\"bfnrt])/g, (_escape, character) => {
		if (character === "\\" || character === '"') return character;
		return escapes[character];
	});
}

describe("buildCodexPluginManifest", () => {
	it("emits the native Codex manifest shape without a hooks field", () => {
		assert.deepEqual(
			buildCodexPluginManifest({ version: "1.2.3", description: "x" }),
			{
				name: "pfdsl",
				version: "1.2.3",
				description: "x",
				author: { name: "takasek" },
				homepage: "https://github.com/takasek/pfdsl",
				repository: "https://github.com/takasek/pfdsl",
				license: "MIT",
				skills: "./skills/",
				interface: {
					displayName: "pfdsl",
					shortDescription: "x",
					longDescription: "x",
					developerName: "takasek",
					category: "Developer Tools",
					capabilities: ["Skills"],
					defaultPrompt: ["Use pfd-ops to operate this project."],
				},
			},
		);
	});
});

describe("commandToCodexSkill", () => {
	it("preserves the command body except for the Codex argument instruction", () => {
		const source =
			"---\n" +
			"description: Choose the next PFD task.\n" +
			"---\n\n" +
			"Keep this body verbatim.\n\n" +
			"引数（あれば作業選択の指定として扱う）: $ARGUMENTS\n";

		assert.equal(
			commandToCodexSkill("pfd-cycle.md", source),
			"---\n" +
				"name: pfd-cycle\n" +
				"description: Choose the next PFD task.\n" +
				"---\n\n" +
				"Keep this body verbatim.\n\n" +
				"ユーザーがスキル呼び出しとともに指定した内容があれば、作業選択の指定として扱う。\n",
		);
	});

	it("rejects unknown command frontmatter with its source path and key", () => {
		const source = "---\ndescription: x\nextra: y\n---\n\nbody\n";

		assert.throws(
			() => commandToCodexSkill("pfd-cycle.md", source),
			/pfd-cycle\.md.*extra/,
		);
	});
});

describe("agentToCodexToml", () => {
	it("maps pfd-lens's known read-only tools without selecting a Codex model", () => {
		const source = readFileSync(
			resolve(root, ".claude/agents/pfd-lens.md"),
			"utf-8",
		);
		const output = agentToCodexToml("pfd-lens.md", source);

		assert.match(output, /^description = /m);
		assert.match(output, /^sandbox_mode = "read-only"$/m);
		assert.doesNotMatch(output, /^model = /m);
		assert.match(output, /^developer_instructions = """/m);
		assert.match(output, /\.agents\/skills\/pfd-retro\/SKILL\.md/);
		assert.match(output, /\$\{PLUGIN_ROOT\}/);
	});

	it("maps pfd-implementer's known write tools and repository instructions", () => {
		const source = readFileSync(
			resolve(root, ".claude/agents/pfd-implementer.md"),
			"utf-8",
		);
		const output = agentToCodexToml("pfd-implementer.md", source);

		assert.match(output, /^sandbox_mode = "workspace-write"$/m);
		assert.match(output, /`AGENTS\.md`/);
	});

	it("preserves the transformed body through TOML multiline string parsing", () => {
		const body = [
			"",
			"leading newline",
			String.raw`literal \\n literal \\t literal \\" literal \\u1234`,
			'quotes " and triple """',
			"",
		].join("\n");
		const source =
			"---\n" +
			"name: pfd\n" +
			"description: x\n" +
			"tools: Read, Grep, Bash\n" +
			"model: sonnet\n" +
			"---\n" +
			body;

		const output = agentToCodexToml("pfd.md", source);

		assert.equal(parseTomlDeveloperInstructions(output), body);
	});

	it("rejects an unsupported model with its source path and key", () => {
		const source =
			"---\nname: pfd\ndescription: x\ntools: Read, Grep, Bash\nmodel: opus\n---\n\nbody\n";

		assert.throws(() => agentToCodexToml("pfd.md", source), /pfd\.md.*model/);
	});

	it("rejects an unsupported tools list with its source path and key", () => {
		const source =
			"---\nname: pfd\ndescription: x\ntools: Read\nmodel: sonnet\n---\n\nbody\n";

		assert.throws(() => agentToCodexToml("pfd.md", source), /pfd\.md.*tools/);
	});

	it("rejects unknown agent frontmatter with its source path and key", () => {
		const source =
			"---\n" +
			"name: pfd\n" +
			"description: x\n" +
			"tools: Read, Grep, Bash\n" +
			"model: sonnet\n" +
			"extra: y\n" +
			"---\n\nbody\n";

		assert.throws(() => agentToCodexToml("pfd.md", source), /pfd\.md.*extra/);
	});
});

describe("claudeInstructionsToAgents", () => {
	it("replaces only the approved repository instruction paths", () => {
		const source =
			"CLAUDE.md\n" +
			".claude/skills/pfd-ops/SKILL.md\n" +
			`\${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops/SKILL.md\n` +
			".Codex/settings.json\n" +
			".claude/settings.json\n" +
			"unchanged\n";

		assert.equal(
			claudeInstructionsToAgents(source),
			"AGENTS.md\n" +
				".agents/skills/pfd-ops/SKILL.md\n" +
				`\${PLUGIN_ROOT}/skills/pfd-ops/SKILL.md\n` +
				".codex/hooks.json\n" +
				".codex/hooks.json\n" +
				"unchanged\n",
		);
	});
});

describe("claudeHooksToCodexHooks", () => {
	it("copies only the hooks object", () => {
		const settings = JSON.stringify({
			permissions: { allow: ["Bash(node scripts/*)"] },
			hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] },
		});

		assert.deepEqual(JSON.parse(claudeHooksToCodexHooks(settings)), {
			hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] },
		});
	});
});
