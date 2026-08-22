import { parse } from "yaml";

const COMMAND_FRONTMATTER_KEYS = new Set(["description"]);
const AGENT_FRONTMATTER_KEYS = new Set([
	"name",
	"description",
	"tools",
	"model",
]);
const READ_ONLY_TOOLS = "Read, Grep, Bash";
const WORKSPACE_WRITE_TOOLS = "Bash, Read, Edit, Write, Grep, Glob, Skill";
const CODEX_ARGUMENT_INSTRUCTIONS = new Map([
	[
		"引数（あれば作業選択の指定として扱う）: $ARGUMENTS",
		"ユーザーがスキル呼び出しとともに指定した内容があれば、作業選択の指定として扱う。",
	],
	[
		"引数（あれば）: $ARGUMENTS",
		"ユーザーがスキル呼び出しとともに指定した内容があれば、引数として扱う。",
	],
	[
		"対象範囲の指定（あれば）: $ARGUMENTS",
		"ユーザーがスキル呼び出しとともに指定した内容があれば、監査対象範囲の指定として扱う。",
	],
]);

function parseFrontmatter(sourcePath, source) {
	const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	if (!match) {
		throw new Error(`${sourcePath}: frontmatter is required.`);
	}

	const frontmatter = parse(match[1]);
	if (
		!frontmatter ||
		Array.isArray(frontmatter) ||
		typeof frontmatter !== "object"
	) {
		throw new Error(`${sourcePath}: frontmatter must be an object.`);
	}

	return { body: source.slice(match[0].length), frontmatter };
}

function requiredDescription(sourcePath, frontmatter) {
	if (
		typeof frontmatter.description !== "string" ||
		!frontmatter.description.trim()
	) {
		throw new Error(`${sourcePath}: description must be a non-empty string.`);
	}
	return frontmatter.description;
}

function requiredName(sourcePath, frontmatter) {
	if (typeof frontmatter.name !== "string" || !frontmatter.name.trim()) {
		throw new Error(`${sourcePath}: name must be a non-empty string.`);
	}
	return frontmatter.name;
}

function tomlString(value) {
	return JSON.stringify(value);
}

function tomlMultilineString(value) {
	return JSON.stringify(value).slice(1, -1);
}

export function buildCodexPluginManifest({ version, description }) {
	return {
		name: "pfdsl",
		version,
		description,
		author: { name: "takasek" },
		homepage: "https://github.com/takasek/pfdsl",
		repository: "https://github.com/takasek/pfdsl",
		license: "MIT",
		skills: "./skills/",
		interface: {
			displayName: "pfdsl",
			shortDescription: description,
			longDescription: description,
			developerName: "takasek",
			category: "Developer Tools",
			capabilities: ["Skills"],
			defaultPrompt: ["Use pfd-ops to operate this project."],
		},
	};
}

export function commandToCodexSkill(
	sourcePath,
	source,
	outputName = sourcePath.replace(/\.md$/, ""),
) {
	const { body, frontmatter } = parseFrontmatter(sourcePath, source);
	for (const key of Object.keys(frontmatter)) {
		if (!COMMAND_FRONTMATTER_KEYS.has(key)) {
			throw new Error(
				`${sourcePath}: unsupported command frontmatter key ${key}.`,
			);
		}
	}
	const description = requiredDescription(sourcePath, frontmatter);
	let codexBody = body;
	for (const [
		claudeInstruction,
		codexInstruction,
	] of CODEX_ARGUMENT_INSTRUCTIONS) {
		codexBody = codexBody.replaceAll(claudeInstruction, codexInstruction);
	}
	const unsupportedArgument = codexBody.match(/^.*\$ARGUMENTS.*$/m);
	if (unsupportedArgument) {
		throw new Error(
			`${sourcePath}: unsupported $ARGUMENTS construct ${JSON.stringify(unsupportedArgument[0])}.`,
		);
	}

	return `---\nname: ${outputName}\ndescription: ${description}\n---\n${codexBody}`;
}

function sandboxMode(sourcePath, tools) {
	if (tools === READ_ONLY_TOOLS) return "read-only";
	if (tools === WORKSPACE_WRITE_TOOLS) return "workspace-write";
	throw new Error(`${sourcePath}: unsupported tools.`);
}

export function claudeInstructionsToAgents(source) {
	return source
		.replaceAll("CLAUDE.md", "AGENTS.md")
		.replaceAll(".claude/skills/", ".agents/skills/")
		.replaceAll(`\${CLAUDE_PLUGIN_ROOT}`, `\${PLUGIN_ROOT}`)
		.replaceAll("CLAUDE_PLUGIN_ROOT", "PLUGIN_ROOT")
		.replaceAll(
			"を Claude Code プラットフォーム側",
			"を各ハーネスのプラットフォーム側",
		)
		.replaceAll(
			"Claude Code プラットフォーム側",
			"各ハーネスのプラットフォーム側",
		)
		.replaceAll(
			"1つの Claude Code plugin",
			"Claude Code と Codex の両方で使える plugin",
		)
		.replaceAll("Claude 向け", "Codex 向け")
		.replaceAll("Claude へ", "Codex へ")
		.replaceAll(".Codex/settings.json", ".codex/hooks.json")
		.replaceAll(".claude/settings.json", ".codex/hooks.json");
}

const CODEX_WORKTREE_METADATA_INSTRUCTIONS = [
	"",
	"## Codex の worktree と git metadata",
	"",
	"親 agent が `git fetch`、stage、commit を担当する。",
	"subagent へ git metadata 操作を委譲しない。",
	"subagent は worktree 内のファイル編集と検査だけを担当する。",
	"subagent の権限エラーはユーザーへ直接継続を求めず、親 agent へ引き上げる。",
	"",
].join("\n");

export function claudeRootInstructionsToAgents(source) {
	return `${claudeInstructionsToAgents(source)}${CODEX_WORKTREE_METADATA_INSTRUCTIONS}`;
}

function codexPfdImplementerDescription() {
	return "設計が確定済みの実装を委譲する。指定された worktree 内で t-wada 流 TDD によりファイルを編集し、検査する。git metadata 操作は親 agent が担当する。";
}

function pfdImplementerInstructions(source) {
	return `${claudeInstructionsToAgents(source)
		.replace(
			"設計が確定した実装を、指定ブランチ上のコミットとして仕上げる agent。",
			"設計が確定した実装を、指定された worktree 内のファイル編集と検査として仕上げる agent。",
		)
		.replace(
			"やること: テストを先に書き、実装し、論理単位でコミットする。検証コマンドを実行し、結果を verbatim で報告する。",
			"やること: テストを先に書き、実装し、検証コマンドを実行して結果を verbatim で報告する。",
		)
		.replace(
			"やらないこと: `git push`、PR の作成・更新、issue の作成・クローズ・コメント、worktree の作成、リリース操作。",
			"やらないこと: `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメント、worktree の作成、リリース操作。",
		)
		.replace(
			"リポジトリの `AGENTS.md` に従う（TDD、Conventional Commits、コミット粒度、文字列の言語）",
			"リポジトリの `AGENTS.md` に従う（TDD と文字列の言語）",
		)}${CODEX_WORKTREE_METADATA_INSTRUCTIONS}`;
}

function codexAgentDescription(sourcePath, description) {
	return sourcePath === "pfd-implementer.md"
		? codexPfdImplementerDescription()
		: description;
}

function codexAgentInstructions(sourcePath, body) {
	return sourcePath === "pfd-implementer.md"
		? pfdImplementerInstructions(body)
		: claudeInstructionsToAgents(body);
}

export function buildCodexProjectConfig() {
	return [
		'sandbox_mode = "workspace-write"',
		'approval_policy = "on-request"',
		"",
		"[sandbox_workspace_write]",
		"network_access = true",
		"",
	].join("\n");
}

export function agentToCodexToml(sourcePath, source) {
	const { body, frontmatter } = parseFrontmatter(sourcePath, source);
	for (const key of Object.keys(frontmatter)) {
		if (!AGENT_FRONTMATTER_KEYS.has(key)) {
			throw new Error(
				`${sourcePath}: unsupported agent frontmatter key ${key}.`,
			);
		}
	}
	const name = requiredName(sourcePath, frontmatter);
	const description = codexAgentDescription(
		sourcePath,
		requiredDescription(sourcePath, frontmatter),
	);
	if (frontmatter.model !== "sonnet") {
		throw new Error(`${sourcePath}: unsupported model.`);
	}
	const sandbox = sandboxMode(sourcePath, frontmatter.tools);
	const instructions = tomlMultilineString(
		codexAgentInstructions(sourcePath, body),
	);

	return [
		`name = ${tomlString(name)}`,
		`description = ${tomlString(description)}`,
		`sandbox_mode = ${tomlString(sandbox)}`,
		`developer_instructions = """${instructions}"""`,
		"",
	].join("\n");
}

export function claudeHooksToCodexHooks(source) {
	const { hooks } = JSON.parse(source);
	return `${JSON.stringify({ hooks }, null, 2)}\n`;
}
