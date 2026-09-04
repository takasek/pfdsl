import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	addGeneratedMarkdownNotice,
	addGeneratedSourceComment,
	agentCapabilityToCodexToml,
	buildCodexPluginManifest,
	buildCodexProjectConfig,
	claudeInstructionsToAgents,
	claudeRootInstructionsToAgents,
	commandCapabilityToCodexSkill,
	hookCapabilityToCodexHooks,
} from "./gen-codex-assets.mjs";
import { validateCapabilityContract } from "./harness-capability-contract.mjs";
import { PROBE_FIXTURES } from "./harness-capability-probes.test-helper.mjs";
import { HARNESS_CAPABILITY_CONTRACT } from "./harness-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PFD_LENS_BASH_RESTRICTION =
	"Bash は CLI 実体を解決するための `test -f package.json` と `test -f packages/cli/package.json` と `test -f packages/cli/dist/cli.js`、解決した CLI による `check <file>` と読み取り専用クエリ（`graph` グループ全体、`meta get` / `meta list` / `meta check-links`、`status` グループ全体）のみ許可される — 図やリポジトリの他の状態を書き換えない。";
const PFD_LENS_CLI_RESOLUTION = `
## CLI 実体の解決

監査コマンドを実行する前に、リポジトリルートで \`test -f package.json\` と \`test -f packages/cli/package.json\` を実行し、存在する manifest だけを Read して CLI 実体を1回だけ解決する。
root \`package.json\` の \`name\` が \`pfdsl\` かつ \`private\` が \`true\` であり、\`packages/cli/package.json\` の \`name\` が \`@pfdsl/cli\` かつ \`bin.pfdsl\` が \`./dist/cli.js\` なら upstream repository と判定する。upstream repository では \`test -f packages/cli/dist/cli.js\` を実行し、存在すればこの監査中の CLI 実体を \`node packages/cli/dist/cli.js\` とする。存在しなければ \`packages/cli/dist/cli.js not built; run 'pnpm -r build' first\` と報告して停止し、公開 CLI へ fallback しない。
どちらかの manifest が存在しない場合や、いずれかの identity が一致しない場合は採用リポと判定し、この監査中の CLI 実体を導入済みの \`pfdsl\` とする。
以下の \`<resolved-cli>\` はここで1回だけ選んだ同じ CLI 実体を表す。\`<resolved-cli> check <file>\`、\`<resolved-cli> graph describe <file> <id>\`、その他すべての \`<resolved-cli> graph ...\` を、途中で実体を解決し直さずに使う。

対象として明示された .pfdsl ファイル以外は読まない。ただし CLI 実体の解決に使うリポジトリルートの \`package.json\` と \`packages/cli/package.json\`、カタログの読込手順が指定する観点カタログはこの読取境界の例外とする。
`;

function commandRecord({
	name = "pfd-cycle",
	description = "Choose the next PFD task.",
	body = "\nKeep this body verbatim.\n",
} = {}) {
	return {
		id: `command:${name}`,
		kind: "command",
		source: {
			encoding: "claude-command",
			path: `.claude/commands/${name}.md`,
		},
		mappings: [],
		semantic: { description, body },
	};
}

function agentRecord({
	name = "pfd-lens",
	description = "Inspect a graph.",
	tools = "Read, Grep, Bash",
	model = "sonnet",
	body = "\nagent body\n",
} = {}) {
	return {
		id: `agent:${name}`,
		kind: "agent",
		source: { encoding: "claude-agent", path: `.claude/agents/${name}.md` },
		mappings: [],
		semantic: { name, description, tools, model, body },
	};
}

function hookRecord(hooks) {
	return {
		id: "plugin-hooks",
		kind: "hook",
		source: { encoding: "plugin-hooks", path: "hooks/hooks.json" },
		mappings: [],
		semantic: { hooks },
	};
}

function pluginMetadataRecord() {
	const mapping = HARNESS_CAPABILITY_CONTRACT.find(
		({ id }) => id === "plugin-metadata",
	).mappings.find(({ target }) => target === "codex-plugin");
	return {
		id: "plugin-metadata",
		kind: "plugin-metadata",
		source: {
			encoding: "cli-package-metadata",
			path: "packages/cli/package.json",
		},
		mappings: [mapping],
		semantic: {
			version: "1.2.3",
			identity: {
				name: "pfdsl",
				author: { name: "takasek" },
				homepage: "https://github.com/takasek/pfdsl",
				license: "MIT",
			},
		},
	};
}

function assertCodexPluginAgentExclusions(capabilities) {
	for (const id of ["agent:pfd-lens", "agent:pfd-implementer"]) {
		const capability = capabilities.find((record) => record.id === id);
		const mapping = capability.mappings.find(
			({ target }) => target === "codex-plugin",
		);
		assert.equal(mapping.disposition, "intentional-exclusion", id);
		assert.match(mapping.reason, /\S/, id);
		assert.match(mapping.impact, /\S/, id);
		assert.equal(Object.hasOwn(mapping, "outputs"), false, id);
		assert.throws(
			() =>
				validateCapabilityContract(
					[
						{
							...capability,
							mappings: capability.mappings.filter(
								({ target }) => target !== "codex-plugin",
							),
						},
					],
					{ probeKinds: PROBE_FIXTURES },
				),
			/missing mapping for codex-plugin/,
		);
	}
}

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
		const metadata = pluginMetadataRecord();
		const mapping = metadata.mappings[0];
		assert.deepEqual(
			buildCodexPluginManifest({
				metadata: metadata.semantic,
				mapping,
				description: "x",
			}),
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

	it("emits only manifest fields declared by the Codex mapping", () => {
		const metadata = pluginMetadataRecord();
		assert.deepEqual(
			buildCodexPluginManifest({
				metadata: metadata.semantic,
				mapping: {
					outputs: [
						"manifest:.codex-plugin/plugin.json:name",
						"manifest:.codex-plugin/plugin.json:version",
					],
				},
				description: "x",
			}),
			{ name: "pfdsl", version: "1.2.3" },
		);
	});
});

describe("generated ownership notices", () => {
	it("preserves an existing Markdown notice after frontmatter", () => {
		const source =
			"---\nname: generated\n---\n" +
			"<!-- DO NOT EDIT. Authoritative source: docs/quality-guide.md. -->\n\n" +
			"body\n";

		assert.equal(
			addGeneratedMarkdownNotice(source, ".claude/skills/pfdsl/SKILL.md"),
			source,
		);
	});

	it("preserves an existing Markdown heading notice with an em dash", () => {
		const source =
			"---\n" +
			"# DO NOT EDIT — generated by scripts/gen-skill.mjs. Authoritative source: https://example.test/SKILL.md\n" +
			"name: generated\n---\nbody\n";

		assert.equal(
			addGeneratedMarkdownNotice(source, ".claude/skills/pfdsl/SKILL.md"),
			source,
		);
	});

	it("preserves an existing Markdown snapshot comment with an em dash", () => {
		const source =
			"<!-- DO NOT EDIT — snapshot. Authoritative source: https://example.test/quality-guide.md -->\n\n" +
			"body\n";

		assert.equal(
			addGeneratedMarkdownNotice(source, ".claude/skills/pfdsl/SKILL.md"),
			source,
		);
	});

	it("adds a Markdown notice when the source has none", () => {
		assert.equal(
			addGeneratedMarkdownNotice("body\n", ".claude/skills/pfd-ops/SKILL.md"),
			"<!-- DO NOT EDIT. Authoritative source: .claude/skills/pfd-ops/SKILL.md. -->\n\nbody\n",
		);
	});

	it("preserves an existing JavaScript notice after a shebang", () => {
		const source =
			"#!/usr/bin/env node\n" +
			"// DO NOT EDIT. Authoritative source: docs/quality-guide.mjs.\n" +
			"console.log('body');\n";

		assert.equal(
			addGeneratedSourceComment(source, ".claude/skills/pfd-ops/script.mjs"),
			source,
		);
	});

	it("preserves an existing JavaScript notice with an em dash", () => {
		const source =
			"// DO NOT EDIT — generated. Authoritative source: https://example.test/script.mjs\n" +
			"console.log('body');\n";

		assert.equal(
			addGeneratedSourceComment(source, ".claude/skills/pfd-ops/script.mjs"),
			source,
		);
	});
});

describe("commandCapabilityToCodexSkill", () => {
	it("converts each maintained command argument clause without leaving a Claude placeholder", () => {
		const cases = [
			[
				"pfd-cycle",
				"引数（あれば作業選択の指定として扱う）: $ARGUMENTS",
				"作業選択の指定として扱う。",
			],
			["pfd-init", "引数（あれば）: $ARGUMENTS", "引数として扱う。"],
			[
				"pfd-retro",
				"対象範囲の指定（あれば）: $ARGUMENTS",
				"監査対象範囲の指定として扱う。",
			],
		];

		for (const [name, clause, expected] of cases) {
			const output = commandCapabilityToCodexSkill(
				commandRecord({ name, body: `\n${clause}\n` }),
				name === "pfd-retro" ? "source-command-pfd-retro" : name,
			);
			assert.doesNotMatch(output, /\$ARGUMENTS/, name);
			assert.match(output, new RegExp(expected), name);
		}
	});

	it("rejects an unrecognized argument construct with its source path", () => {
		assert.throws(
			() =>
				commandCapabilityToCodexSkill(
					commandRecord({
						name: "pfd-unknown",
						body: "\nUnsupported argument form: $ARGUMENTS\n",
					}),
					"pfd-unknown",
				),
			/\.claude\/commands\/pfd-unknown\.md.*\$ARGUMENTS/,
		);
	});

	it("preserves the command body except for the Codex argument instruction", () => {
		assert.equal(
			commandCapabilityToCodexSkill(
				commandRecord({
					body: "\nKeep this body verbatim.\n\n引数（あれば作業選択の指定として扱う）: $ARGUMENTS\n",
				}),
				"pfd-cycle",
			),
			"---\n" +
				"name: pfd-cycle\n" +
				"description: Choose the next PFD task.\n" +
				"---\n" +
				"<!-- DO NOT EDIT. Authoritative source: .claude/commands/pfd-cycle.md. -->\n\n" +
				"Keep this body verbatim.\n\n" +
				"ユーザーがスキル呼び出しとともに指定した内容があれば、作業選択の指定として扱う。\n",
		);
	});

	it("uses an assembly-supplied non-colliding output name while retaining the real source path for errors", () => {
		const record = commandRecord({
			name: "pfd-retro",
			description: "Run the retrospective.",
			body: "\nbody\n",
		});

		assert.match(
			commandCapabilityToCodexSkill(record, "source-command-pfd-retro"),
			/^name: source-command-pfd-retro$/m,
		);
		assert.throws(
			() =>
				commandCapabilityToCodexSkill(
					{ ...record, semantic: { description: 42, body: "\nbody\n" } },
					"source-command-pfd-retro",
				),
			/\.claude\/commands\/pfd-retro\.md.*description/,
		);
	});

	it("rejects an unsupported semantic body with its source path", () => {
		assert.throws(
			() =>
				commandCapabilityToCodexSkill(
					{ ...commandRecord(), semantic: { description: "x", body: 42 } },
					"pfd-cycle",
				),
			/\.claude\/commands\/pfd-cycle\.md.*body/,
		);
	});
});

describe("agentCapabilityToCodexToml", () => {
	it("maps pfd-lens's known read-only tools without selecting a Codex model", () => {
		const output = agentCapabilityToCodexToml(
			agentRecord({
				body:
					`\n${PFD_LENS_BASH_RESTRICTION}\n` +
					String.raw`.agents/skills/pfd-retro/SKILL.md
\${PLUGIN_ROOT}
`,
			}),
		);

		assert.match(output, /^description = /m);
		assert.match(output, /^name = "pfd-lens"$/m);
		assert.match(output, /^sandbox_mode = "read-only"$/m);
		assert.doesNotMatch(output, /^model = /m);
		assert.match(output, /^developer_instructions = """/m);
		assert.match(output, /\.agents\/skills\/pfd-retro\/SKILL\.md/);
		assert.match(output, /\$\{PLUGIN_ROOT\}/);
	});

	it("permits read-only shell inspection for pfd-lens catalog and target PFD reads", () => {
		const output = agentCapabilityToCodexToml(
			agentRecord({
				body:
					`\n${PFD_LENS_BASH_RESTRICTION}\n` +
					"カタログを読み込み、対象 `.pfdsl` ファイルを Read する。\n",
			}),
		);
		const instructions = parseTomlDeveloperInstructions(output);

		assert.match(
			instructions,
			/`rg` と `sed` を観点カタログと対象 `\.pfdsl` ファイルの読取に使用してよい。/,
		);
		assert.equal(instructions.includes(PFD_LENS_BASH_RESTRICTION), false);
		assert.match(output, /^sandbox_mode = "read-only"$/m);
	});

	it("preserves one blank-context CLI resolution for check, graph describe, and other graph queries", () => {
		const output = agentCapabilityToCodexToml(
			agentRecord({
				body: `\n${PFD_LENS_BASH_RESTRICTION}\n${PFD_LENS_CLI_RESOLUTION}`,
			}),
		);
		const instructions = parseTomlDeveloperInstructions(output);

		assert.match(
			instructions,
			/root `package\.json` の `name` が `pfdsl` かつ `private` が `true`/,
		);
		assert.match(
			instructions,
			/`packages\/cli\/package\.json` の `name` が `@pfdsl\/cli` かつ `bin\.pfdsl` が `.\/dist\/cli\.js`/,
		);
		assert.match(
			instructions,
			/どちらかの manifest が存在しない場合や、いずれかの identity が一致しない場合は採用リポと判定し/,
		);
		assert.match(
			instructions,
			/packages\/cli\/dist\/cli\.js not built; run 'pnpm -r build' first/,
		);
		assert.match(instructions, /公開 CLI へ fallback しない/);
		assert.match(instructions, /`<resolved-cli> check <file>`/);
		assert.match(instructions, /`<resolved-cli> graph describe <file> <id>`/);
		assert.match(instructions, /その他すべての `<resolved-cli> graph \.\.\.`/);
		assert.match(instructions, /途中で実体を解決し直さずに使う/);
		assert.match(
			instructions,
			/`package\.json` と `packages\/cli\/package\.json`、カタログの読込手順が指定する観点カタログはこの読取境界の例外/,
		);
	});

	it("rejects pfd-lens when its expected Bash restriction clause changes", () => {
		for (const body of [
			"\nBash は `pfdsl delete <file>` のみ許可される。\n",
			`\n${PFD_LENS_BASH_RESTRICTION} Bash は \`pfdsl fmt --write\` も許可される。\n`,
			`\n${PFD_LENS_BASH_RESTRICTION}\n${PFD_LENS_BASH_RESTRICTION}\n`,
		]) {
			assert.throws(
				() => agentCapabilityToCodexToml(agentRecord({ body })),
				/\.claude\/agents\/pfd-lens\.md.*Bash restriction clause/,
			);
		}
	});

	it("maps pfd-implementer's known write tools and repository instructions", () => {
		const output = agentCapabilityToCodexToml(
			agentRecord({
				name: "pfd-implementer",
				tools: "Bash, Read, Edit, Write, Grep, Glob, Skill",
				body: "\nRead `CLAUDE.md`.\n",
			}),
		);

		assert.match(output, /^sandbox_mode = "workspace-write"$/m);
		assert.match(
			output,
			/^# DO NOT EDIT\. Authoritative source: \.claude\/agents\/pfd-implementer\.md\.$/m,
		);
		assert.match(output, /`AGENTS\.md`/);
		assert.match(
			output,
			/親 agent が `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメントを担当する。/,
		);
		assert.match(
			output,
			/権限エラーはユーザーへ直接継続を求めず、親 agent へ引き上げる。/,
		);
		assert.match(output, /この節は本文中の git に関する指示より優先する。/);
	});

	it("keeps the Codex-only git boundary when Claude's pfd-implementer wording changes", () => {
		const output = agentCapabilityToCodexToml(
			agentRecord({
				name: "pfd-implementer",
				body: "\nThe upstream wording may change without changing this Codex boundary.\n",
				tools: "Bash, Read, Edit, Write, Grep, Glob, Skill",
			}),
		);

		assert.match(
			output,
			/親 agent が `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメントを担当する。/,
		);
		assert.match(
			output,
			/subagent は worktree 内のファイル編集とテスト・検査だけを担当する。/,
		);
	});

	it("rejects an absent or blank agent name", () => {
		for (const name of [undefined, "   "]) {
			const record = agentRecord({ name: "pfd", body: "\nbody\n" });
			record.semantic.name = name;
			assert.throws(
				() => agentCapabilityToCodexToml(record),
				/\.claude\/agents\/pfd\.md.*name.*non-empty string/,
			);
		}
	});

	it("preserves the transformed body through TOML multiline string parsing", () => {
		const body = [
			"",
			"leading newline",
			String.raw`literal \\n literal \\t literal \\" literal \\u1234`,
			'quotes " and triple """',
			"",
		].join("\n");
		const output = agentCapabilityToCodexToml(
			agentRecord({ name: "pfd", body }),
		);

		assert.equal(parseTomlDeveloperInstructions(output), body);
	});

	it("rejects an unsupported model with its source path and key", () => {
		assert.throws(
			() =>
				agentCapabilityToCodexToml(agentRecord({ name: "pfd", model: "opus" })),
			/\.claude\/agents\/pfd\.md.*model/,
		);
	});

	it("rejects an unsupported tools list with its source path and key", () => {
		assert.throws(
			() =>
				agentCapabilityToCodexToml(agentRecord({ name: "pfd", tools: "Read" })),
			/\.claude\/agents\/pfd\.md.*tools/,
		);
	});

	it("rejects an unsupported semantic body with its source path and key", () => {
		assert.throws(
			() =>
				agentCapabilityToCodexToml({
					...agentRecord({ name: "pfd" }),
					semantic: { ...agentRecord().semantic, body: 42, name: "pfd" },
				}),
			/\.claude\/agents\/pfd\.md.*body/,
		);
	});
});

describe("Codex plugin intentional exclusions", () => {
	it("keeps agent mappings excluded with no Codex plugin output", () => {
		assertCodexPluginAgentExclusions(HARNESS_CAPABILITY_CONTRACT);
		assert.equal(existsSync(join(root, "plugin/pfdsl-codex/agents")), false);
	});
});

describe("claudeInstructionsToAgents", () => {
	it("replaces the approved repository paths and Codex-specific instructions", () => {
		const source =
			"CLAUDE.md\n" +
			"CLAUDE_PLUGIN_ROOT\n" +
			".claude/skills/pfd-ops/SKILL.md\n" +
			`\${CLAUDE_PLUGIN_ROOT}/skills/pfd-ops/SKILL.md\n` +
			"Claude 向け指示\n" +
			"Claude へ恒常的に届ける\n" +
			"1つの Claude Code plugin\n" +
			"を Claude Code プラットフォーム側\n" +
			".Codex/settings.json\n" +
			".claude/settings.json\n" +
			"unchanged\n";

		assert.equal(
			claudeInstructionsToAgents(source),
			"AGENTS.md\n" +
				"PLUGIN_ROOT\n" +
				".agents/skills/pfd-ops/SKILL.md\n" +
				`\${PLUGIN_ROOT}/skills/pfd-ops/SKILL.md\n` +
				"Codex 向け指示\n" +
				"Codex へ恒常的に届ける\n" +
				"Claude Code と Codex の両方で使える plugin\n" +
				"を各ハーネスのプラットフォーム側\n" +
				".codex/hooks.json\n" +
				".codex/hooks.json\n" +
				"unchanged\n",
		);
	});
});

describe("claudeRootInstructionsToAgents", () => {
	it("adds Codex-only parent ownership for git metadata operations", () => {
		const output = claudeRootInstructionsToAgents("Read CLAUDE.md.\n");

		assert.match(
			output,
			/^<!-- DO NOT EDIT\. Authoritative source: CLAUDE\.md\. -->$/m,
		);
		assert.match(output, /^Read AGENTS\.md\.$/m);
		assert.match(
			output,
			/親 agent が `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメントを担当する。/,
		);
		assert.match(
			output,
			/subagent は git metadata 操作や外部公開操作を実行しない。/,
		);
	});
});

describe("buildCodexProjectConfig", () => {
	it("uses the least-privilege trusted-project sandbox and registry network access", () => {
		assert.equal(
			buildCodexProjectConfig(),
			'# DO NOT EDIT. Authoritative source: scripts/lib/gen-codex-assets.mjs.\n\nsandbox_mode = "workspace-write"\napproval_policy = "on-request"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
		);
	});
});

describe("Codex generated-file attributes", () => {
	it("marks generated Codex outputs while leaving their maintained sources unclassified", () => {
		const output = execFileSync(
			"git",
			[
				"check-attr",
				"linguist-generated",
				"--",
				"AGENTS.md",
				".agents/skills/pfd-ops/SKILL.md",
				".codex/agents/pfd-implementer.toml",
				".codex/config.toml",
				".codex/GENERATED.md",
				".codex/hooks.json",
				"plugin/pfdsl-codex/skills/pfd-ops/SKILL.md",
				"CLAUDE.md",
				".claude/agents/pfd-implementer.md",
				".claude/settings.json",
				"hooks/retro-reminder-post-tool-use.mjs",
			],
			{ cwd: root, encoding: "utf-8" },
		);
		const attributes = new Map(
			output
				.trim()
				.split("\n")
				.map((line) => {
					const [path, , value] = line.split(": ");
					return [path, value];
				}),
		);

		for (const path of [
			"AGENTS.md",
			".agents/skills/pfd-ops/SKILL.md",
			".codex/agents/pfd-implementer.toml",
			".codex/config.toml",
			".codex/GENERATED.md",
			".codex/hooks.json",
			"plugin/pfdsl-codex/skills/pfd-ops/SKILL.md",
		]) {
			assert.equal(attributes.get(path), "true", path);
		}
		for (const path of [
			"CLAUDE.md",
			".claude/agents/pfd-implementer.md",
			".claude/settings.json",
			"hooks/retro-reminder-post-tool-use.mjs",
		]) {
			assert.equal(attributes.get(path), "unspecified", path);
		}
	});
});

describe("hookCapabilityToCodexHooks", () => {
	it("copies only the hooks object", () => {
		const record = hookRecord({
			PreToolUse: [{ matcher: "Bash", hooks: [] }],
		});

		assert.deepEqual(JSON.parse(hookCapabilityToCodexHooks(record)), {
			hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] },
		});
	});

	it("rejects an unsupported semantic hook value with its source path", () => {
		assert.throws(
			() =>
				hookCapabilityToCodexHooks({
					...hookRecord(null),
					semantic: { hooks: [] },
				}),
			/hooks\.json.*hooks.*object/,
		);
	});
});
