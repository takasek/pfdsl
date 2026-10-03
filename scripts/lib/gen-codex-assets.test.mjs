import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
	addGeneratedMarkdownNotice,
	addGeneratedSourceComment,
	agentCapabilityToCodexToml,
	buildCodexPluginManifest,
	buildCodexProjectConfig,
	commandCapabilityToCodexSkill,
	hookCapabilityToCodexHooks,
	skillMarkdownToCodex,
} from "./gen-codex-assets.mjs";
import { validateCapabilityContract } from "./harness-capability-contract.mjs";
import { PROBE_FIXTURES } from "./harness-capability-probes.test-helper.mjs";
import { HARNESS_CAPABILITY_CONTRACT } from "./harness-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("Codex skill metadata", () => {
	it("moves a multiline summary into metadata while preserving the body and other fields", () => {
		const body = "\n# Body\nsummary: this is body text\n";
		const input = `---\nname: example\nsummary: >\n  short\n  summary\ndescription: Long description.\nmetadata:\n  owner: maintainer\n---\n${body}`;
		const output = skillMarkdownToCodex(input);
		const boundary = output.indexOf("\n---\n", 4);
		const header = parse(output.slice(4, boundary));
		assert.equal(header.summary, undefined);
		assert.deepEqual(header.metadata, {
			owner: "maintainer",
			summary: "short summary\n",
		});
		assert.equal(header.description, "Long description.");
		assert.equal(output.slice(boundary + 5), body);
		assert.equal(skillMarkdownToCodex(output), output);
	});

	it("preserves skills without summary verbatim", () => {
		const input =
			"---\nname: command\ndescription: Run a command.\n---\nbody\n";
		assert.equal(skillMarkdownToCodex(input), input);
	});

	it("accepts metadata mapping aliases without changing their other consumers", () => {
		const input =
			"---\nname: example\nsummary: canonical\ndescription: Example.\nlicense: &meta {owner: maintainer}\nmetadata: *meta\n---\nbody\n";
		const output = skillMarkdownToCodex(input);
		const header = parse(output.match(/^---\n([\s\S]*?)\n---/)[1], {
			merge: true,
		});
		assert.deepEqual(header.metadata, {
			owner: "maintainer",
			summary: "canonical",
		});
		assert.deepEqual(header.license, { owner: "maintainer" });
		assert.equal(output.slice(output.indexOf("\n---\n", 4) + 5), "body\n");
	});

	it("rejects conflicting summaries inherited through merge keys and mapping aliases", () => {
		for (const fields of [
			"metadata:\n  <<: {summary: conflicting, owner: maintainer}",
			"license: &base {summary: conflicting}\nmetadata:\n  <<: *base",
			"metadata:\n  <<: [{summary: conflicting}, {owner: maintainer}]",
			"license: &base {summary: conflicting}\nmetadata: *base",
			"<<: {metadata: {summary: conflicting, owner: maintainer}}",
		]) {
			assert.throws(
				() =>
					skillMarkdownToCodex(
						`---\nsummary: canonical\ndescription: Example.\n${fields}\n---\nbody\n`,
					),
				/metadata.summary conflicts/,
			);
		}
	});

	it("retains an agreeing merged summary and the original merged fields", () => {
		const output = skillMarkdownToCodex(
			"---\nsummary: canonical\ndescription: Example.\nlicense: &base {summary: canonical, owner: maintainer}\nmetadata:\n  <<: *base\n---\nbody\n",
		);
		const header = parse(output.match(/^---\n([\s\S]*?)\n---/)[1], {
			merge: true,
		});
		assert.equal(header.summary, undefined);
		assert.deepEqual(header.metadata, {
			summary: "canonical",
			owner: "maintainer",
		});
		assert.deepEqual(header.license, header.metadata);
	});

	it("preserves metadata inherited by the root mapping", () => {
		const output = skillMarkdownToCodex(
			"---\nname: example\nsummary: canonical\ndescription: Example.\n<<: {metadata: {owner: maintainer}}\n---\nbody\n",
		);
		const header = parse(output.match(/^---\n([\s\S]*?)\n---/)[1], {
			merge: true,
		});
		assert.deepEqual(header.metadata, {
			owner: "maintainer",
			summary: "canonical",
		});
	});

	it("removes summary even when deleting it exposes a root merge donor", () => {
		const input =
			"---\nname: example\nsummary: canonical\ndescription: Example.\n<<: &base {summary: inherited, license: MIT}\nmetadata: {owner: maintainer}\n---\nbody\n";
		const output = skillMarkdownToCodex(input);
		const header = parse(output.match(/^---\n([\s\S]*?)\n---/)[1], {
			merge: true,
		});
		assert.equal(header.summary, undefined);
		assert.equal(header.license, "MIT");
		assert.deepEqual(header.metadata, {
			owner: "maintainer",
			summary: "canonical",
		});
		assert.equal(output.slice(output.indexOf("\n---\n", 4) + 5), "body\n");
		assert.equal(skillMarkdownToCodex(output), output);
	});

	it("preserves quoted strings for YAML 1.1 consumers when materializing aliases or root merges", () => {
		for (const fields of [
			'license: &meta {owner: "yes", enabled: "no"}\nmetadata: *meta',
			'<<: {summary: inherited}\nmetadata: {owner: "yes", enabled: "no"}',
		]) {
			const output = skillMarkdownToCodex(
				`---\nname: "on"\nsummary: canonical\ndescription: "yes"\n${fields}\n---\nbody\n`,
			);
			const header = parse(output.match(/^---\n([\s\S]*?)\n---/)[1], {
				version: "1.1",
				merge: true,
			});
			assert.equal(header.name, "on");
			assert.equal(header.description, "yes");
			assert.deepEqual(header.metadata, {
				owner: "yes",
				enabled: "no",
				summary: "canonical",
			});
			if (header.license)
				assert.deepEqual(header.license, { owner: "yes", enabled: "no" });
		}
	});

	it("keeps other aliases of anchored metadata unchanged when adding summary", () => {
		const output = skillMarkdownToCodex(
			"---\nsummary: canonical\ndescription: Example.\nmetadata: &meta {owner: maintainer}\nlicense: *meta\n---\nbody\n",
		);
		const header = parse(output.match(/^---\n([\s\S]*?)\n---/)[1]);
		assert.deepEqual(header.metadata, {
			owner: "maintainer",
			summary: "canonical",
		});
		assert.deepEqual(header.license, { owner: "maintainer" });
	});

	it("preserves description aliases when summary's anchor moves below them", () => {
		const input =
			"---\nname: example\nsummary: &shared Common description.\ndescription: *shared\n---\nbody\n";
		const output = skillMarkdownToCodex(input);
		const header = parse(output.match(/^---\n([\s\S]*?)\n---/)[1]);
		assert.equal(header.description, "Common description.");
		assert.equal(header.metadata.summary, "Common description.");
	});

	it("compares metadata aliases by value and preserves later declarations of the same anchor", () => {
		const agreeing = skillMarkdownToCodex(
			"---\nsummary: &shared canonical\ndescription: Normal.\nmetadata:\n  summary: *shared\n---\nbody\n",
		);
		assert.equal(
			parse(agreeing.match(/^---\n([\s\S]*?)\n---/)[1]).metadata.summary,
			"canonical",
		);
		const reused = skillMarkdownToCodex(
			"---\nsummary: &shared First\ndescription: *shared\nmetadata:\n  owner: &shared Second\nlicense: *shared\n---\nbody\n",
		);
		const header = parse(reused.match(/^---\n([\s\S]*?)\n---/)[1]);
		assert.equal(header.description, "First");
		assert.equal(header.license, "Second");
	});

	it("retains an agreeing metadata declaration referenced by another field", () => {
		const output = skillMarkdownToCodex(
			"---\nsummary: canonical\ndescription: Normal.\nmetadata:\n  summary: &existing canonical\nlicense: *existing\n---\nbody\n",
		);
		assert.equal(
			parse(output.match(/^---\n([\s\S]*?)\n---/)[1]).license,
			"canonical",
		);
	});

	it("preserves the decoded value of a final literal description", () => {
		const input =
			"---\nsummary: concise\nname: example\ndescription: |\n  Trigger description.\n---\nbody\n";
		const decode = (markdown) =>
			parse(markdown.match(/^---\n([\s\S]*?)\n---/)[1]).description;
		assert.equal(decode(skillMarkdownToCodex(input)), decode(input));
	});

	it("rejects conflicting metadata instead of silently discarding it", () => {
		for (const metadata of [
			"metadata: scalar",
			"metadata: {summary: different}",
		]) {
			assert.throws(
				() =>
					skillMarkdownToCodex(
						`---\nsummary: canonical\n${metadata}\n---\nbody\n`,
					),
				/metadata/,
			);
		}
	});
});
const PFD_LENS_BASH_RESTRICTION =
	"Bash は CLI 実体を解決するための `test -f package.json` と `test -f packages/cli/package.json` と `test -f packages/cli/dist/cli.js`、解決した CLI による `check <file>` と読み取り専用クエリ（`graph` グループ全体、`meta get` / `meta list` / `meta check-links`、`status` グループ全体）のみ許可される — 図やリポジトリの他の状態を書き換えない。";
const PFD_LENS_CLI_RESOLUTION = `
## CLI 実体の解決

監査コマンドを実行する前に、リポジトリルートで \`test -f package.json\` と \`test -f packages/cli/package.json\` を実行し、存在する manifest だけを Read して CLI 実体を1回だけ解決する。
root \`package.json\` の \`name\` が \`pfdsl\` かつ \`private\` が \`true\` であり、\`packages/cli/package.json\` の \`name\` が \`@pfdsl/cli\` かつ \`bin.pfdsl\` が \`./dist/cli.js\` なら upstream repository と判定する。upstream repository では \`test -f packages/cli/dist/cli.js\` を実行し、存在すればこの監査中の CLI 実体を \`node packages/cli/dist/cli.js\` とする。存在しなければ \`packages/cli/dist/cli.js not built; run 'pnpm -r build' first\` と報告して停止し、公開 CLI へ fallback しない。
どちらかの manifest が存在しない場合や、いずれかの identity が一致しない場合は採用リポと判定し、この監査中の CLI 実体を導入済みの \`pfdsl\` とする。
以下の \`<resolved-cli>\` はここで1回だけ選んだ同じ CLI 実体を表す。\`<resolved-cli> check <file>\`、\`<resolved-cli> graph describe <file> <id>\`、その他すべての \`<resolved-cli> graph ...\` を、途中で実体を解決し直さずに使う。

対象として明示された .pfdsl ファイル以外は読まない。ただし CLI 実体の解決に使うリポジトリルートの \`package.json\` と \`packages/cli/package.json\`、pfd-retro スキル SKILL.md、binding、観点カタログはこの読取境界の例外とする。
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

	for (const newline of ["\n", "\r\n"]) {
		for (const prefix of [
			"",
			`---${newline}---${newline}`,
			`---${newline}name: generated${newline}---${newline}`,
		]) {
			for (const example of [
				"<!-- DO NOT EDIT. Authoritative source: example.md. -->",
				"# DO NOT EDIT — generated. Authoritative source: example.md",
			]) {
				for (const fenced of [false, true]) {
					it(`adds a Markdown notice despite a ${fenced ? "fenced" : "bare"} ${example.startsWith("<!--") ? "comment" : "heading"} example (${prefix ? (prefix.includes("name:") ? "frontmatter" : "empty frontmatter") : "no frontmatter"}, ${newline === "\n" ? "LF" : "CRLF"})`, () => {
						const body = [
							"# Instructions",
							"",
							...(fenced ? ["```markdown", example, "```"] : [example]),
							"",
							"---",
							"",
							"Footer",
							"",
						].join(newline);
						const source = prefix + body;
						const notice =
							"<!-- DO NOT EDIT. Authoritative source: canonical.md. -->";
						const output = addGeneratedMarkdownNotice(source, "canonical.md");
						assert.equal(
							output,
							prefix + notice + (prefix ? "\n" : "\n\n") + body,
						);
						assert.equal(
							addGeneratedMarkdownNotice(output, "intermediate.md"),
							output,
						);
					});
				}
			}
		}
	}

	it("preserves notices in all Markdown header positions with CRLF", () => {
		const notice = "<!-- DO NOT EDIT. Authoritative source: canonical.md. -->";
		for (const lines of [
			[notice, "", "body"],
			["---", "name: generated", notice, "---", "body"],
			["---", "name: generated", "---", notice, "body"],
		]) {
			const source = lines.join("\r\n");
			assert.equal(
				addGeneratedMarkdownNotice(source, "intermediate.md"),
				source,
			);
		}
	});

	for (const newline of ["\n", "\r\n"]) {
		it(`preserves notices with empty or EOF-terminated frontmatter (${JSON.stringify(newline)})`, () => {
			const notice = "# DO NOT EDIT. Authoritative source: canonical.md.";
			for (const lines of [
				["---", "---", notice, "body"],
				["---", notice, "name: generated", "---"],
			]) {
				const source = lines.join(newline);
				assert.equal(
					addGeneratedMarkdownNotice(source, "intermediate.md"),
					source,
				);
			}
		});

		it(`adds a notice after empty or EOF-terminated frontmatter (${JSON.stringify(newline)})`, () => {
			for (const frontmatter of [
				["---", "---", ""].join(newline),
				["---", "---"].join(newline),
				["---", "name: generated", "---"].join(newline),
			]) {
				const separator = frontmatter.endsWith("\n") ? "" : "\n";
				const expected =
					frontmatter +
					separator +
					"<!-- DO NOT EDIT. Authoritative source: canonical.md. -->\n";
				assert.equal(
					addGeneratedMarkdownNotice(frontmatter, "canonical.md"),
					expected,
				);
				assert.equal(
					addGeneratedMarkdownNotice(expected, "intermediate.md"),
					expected,
				);
			}
		});
	}

	it("adds the command skill notice when the body documents the format", () => {
		const body =
			"\n# Instructions\n\n<!-- DO NOT EDIT. Authoritative source: example.md. -->\n";
		assert.equal(
			commandCapabilityToCodexSkill(commandRecord({ body }), "pfd-cycle"),
			'---\nname: pfd-cycle\ndescription: "Choose the next PFD task."\n---\n' +
				"<!-- DO NOT EDIT. Authoritative source: .claude/commands/pfd-cycle.md. -->\n" +
				body,
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

	for (const prefix of [
		"",
		"#!/usr/bin/env node\n",
		"#!/usr/bin/env node\r\n",
	]) {
		for (const body of [
			"console.log('body');\n// DO NOT EDIT. Authoritative source: example.mjs.\n",
			"const example = `\n// DO NOT EDIT. Authoritative source: example.mjs.\n`;\n",
		]) {
			it(`adds a JavaScript notice despite a ${body.startsWith("const") ? "template literal" : "body comment"} (${prefix ? "shebang" : "no shebang"}, ${prefix.includes("\r") ? "CRLF" : "LF"})`, () => {
				const output = addGeneratedSourceComment(
					prefix + body,
					"canonical.mjs",
				);
				assert.equal(
					output,
					prefix +
						"// DO NOT EDIT. Authoritative source: canonical.mjs.\n" +
						body,
				);
				assert.equal(
					addGeneratedSourceComment(output, "intermediate.mjs"),
					output,
				);
			});
		}
	}
});

describe("commandCapabilityToCodexSkill", () => {
	it("preserves the decoded body including intentional foreign literals", () => {
		const body = "\nCLAUDE.md and $ARGUMENTS are quoted examples.\n";
		const output = commandCapabilityToCodexSkill(
			commandRecord({ body }),
			"pfd-cycle",
		);
		assert.ok(output.endsWith(body));
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
			/`package\.json` と `packages\/cli\/package\.json`、pfd-retro スキル SKILL\.md、binding、観点カタログはこの読取境界の例外/,
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

describe("buildCodexProjectConfig", () => {
	it("uses the least-privilege trusted-project sandbox and registry network access", () => {
		assert.equal(
			buildCodexProjectConfig(),
			'# DO NOT EDIT. Authoritative source: scripts/lib/gen-codex-assets.mjs.\n\nsandbox_mode = "workspace-write"\napproval_policy = "on-request"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
		);
	});
});

describe("generated-file attributes", () => {
	it("keeps reviewable outputs visible without hiding future Codex files", () => {
		const expected = new Map([
			["AGENTS.md", "true"],
			[".codex/agents/pfd-implementer.toml", "true"],
			[".codex/config.toml", "true"],
			["docs/samples/01-simple-chain.dot", "true"],
			[".codex/future-policy.toml", "unspecified"],
			[".claude-plugin/marketplace.json", "unspecified"],
			[".pfdsl/workflow.svg", "unspecified"],
			["docs/samples/01-simple-chain.svg", "unspecified"],
			["docs/samples/README.md", "unspecified"],
			[".claude/skills/pfd-ops/SKILL.md", "unspecified"],
		]);
		const output = execFileSync(
			"git",
			["check-attr", "linguist-generated", "--", ...expected.keys()],
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

		assert.deepEqual(attributes, expected);
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
