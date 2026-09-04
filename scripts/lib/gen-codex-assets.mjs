const READ_ONLY_TOOLS = "Read, Grep, Bash";
const WORKSPACE_WRITE_TOOLS = "Bash, Read, Edit, Write, Grep, Glob, Skill";
const MARKDOWN_GENERATED_NOTICE =
	/^<!--(?=[^\r\n]*DO NOT EDIT)(?=[^\r\n]*Authoritative source:)[^\r\n]*-->$|^#{1,6}[ \t]+(?=[^\r\n]*DO NOT EDIT)(?=[^\r\n]*Authoritative source:)[^\r\n]*$/gm;
const JAVASCRIPT_GENERATED_NOTICE =
	/^\/\/(?=[^\r\n]*DO NOT EDIT)(?=[^\r\n]*Authoritative source:)[^\r\n]*$/gm;
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

function tomlString(value) {
	return JSON.stringify(value);
}

function tomlMultilineString(value) {
	return JSON.stringify(value).slice(1, -1);
}

function generatedNotice(authoritativeSource) {
	return `DO NOT EDIT. Authoritative source: ${authoritativeSource}.`;
}

export function generatedMarkdownNoticeCount(source) {
	return (source.match(MARKDOWN_GENERATED_NOTICE) ?? []).length;
}

export function generatedSourceCommentCount(source) {
	return (source.match(JAVASCRIPT_GENERATED_NOTICE) ?? []).length;
}

export function addGeneratedMarkdownNotice(source, authoritativeSource) {
	if (generatedMarkdownNoticeCount(source) > 0) {
		return source;
	}
	const notice = `<!-- ${generatedNotice(authoritativeSource)} -->`;
	const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
	if (!frontmatter) return `${notice}\n\n${source}`;
	return `${frontmatter[0]}${notice}\n${source.slice(frontmatter[0].length)}`;
}

export function addGeneratedSourceComment(source, authoritativeSource) {
	if (generatedSourceCommentCount(source) > 0) {
		return source;
	}
	const comment = `// ${generatedNotice(authoritativeSource)}\n`;
	const shebang = source.match(/^#![^\r\n]*\r?\n/);
	if (!shebang) return `${comment}${source}`;
	return `${shebang[0]}${comment}${source.slice(shebang[0].length)}`;
}

function capabilitySourcePath(record) {
	return record?.source?.path ?? "<unknown-source>";
}

function semanticRecord(record, kind) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = record?.semantic;
	if (!semantic || Array.isArray(semantic) || typeof semantic !== "object") {
		throw new Error(
			`${sourcePath}: ${kind} semantic record must be an object.`,
		);
	}
	return semantic;
}

function requiredSemanticString(
	record,
	semantic,
	field,
	{ nonEmpty = true } = {},
) {
	const sourcePath = capabilitySourcePath(record);
	const value = semantic[field];
	if (typeof value !== "string" || (nonEmpty && !value.trim())) {
		const qualifier = nonEmpty ? "non-empty string" : "string";
		throw new Error(`${sourcePath}: ${field} must be a ${qualifier}.`);
	}
	return value;
}

function manifestSurfaceFields(mapping, sourcePath) {
	const outputs = Array.isArray(mapping) ? mapping : mapping?.outputs;
	if (!Array.isArray(outputs)) {
		throw new Error(
			`${sourcePath}: codex-plugin manifest mapping outputs must be an array.`,
		);
	}
	if (outputs.some((surface) => typeof surface !== "string")) {
		throw new Error(
			`${sourcePath}: codex-plugin manifest mapping outputs must be strings.`,
		);
	}
	const prefix = "manifest:.codex-plugin/plugin.json:";
	const fields = outputs
		.filter((surface) => surface.startsWith(prefix))
		.map((surface) => surface.slice(prefix.length));
	if (fields.length === 0 || fields.some((field) => !field)) {
		throw new Error(
			`${sourcePath}: codex-plugin manifest fields are required.`,
		);
	}
	return new Set(fields);
}

export function buildCodexPluginManifest({
	metadata,
	record,
	mapping,
	description,
}) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = metadata ?? record?.semantic;
	if (!semantic || Array.isArray(semantic) || typeof semantic !== "object") {
		throw new Error(`${sourcePath}: plugin metadata must be an object.`);
	}
	const identity = semantic.identity;
	if (!identity || Array.isArray(identity) || typeof identity !== "object") {
		throw new Error(
			`${sourcePath}: plugin metadata identity must be an object.`,
		);
	}
	const version = requiredSemanticString(
		record ?? { source: { path: sourcePath }, semantic },
		semantic,
		"version",
	);
	if (typeof description !== "string" || !description.trim()) {
		throw new Error(`${sourcePath}: description must be a non-empty string.`);
	}
	const fields = manifestSurfaceFields(mapping, sourcePath);
	const values = {
		name: identity.name,
		version,
		description,
		author: identity.author,
		homepage: identity.homepage,
		repository: "https://github.com/takasek/pfdsl",
		license: identity.license,
		skills: "./skills/",
		interface: {
			displayName: identity.name,
			shortDescription: description,
			longDescription: description,
			developerName: identity.author?.name,
			category: "Developer Tools",
			capabilities: ["Skills"],
			defaultPrompt: ["Use pfd-ops to operate this project."],
		},
	};
	for (const field of fields) {
		if (!Object.hasOwn(values, field)) {
			throw new Error(
				`${sourcePath}: unsupported Codex manifest field ${field}.`,
			);
		}
	}
	return Object.fromEntries(
		Object.entries(values).filter(([field]) => fields.has(field)),
	);
}

export function commandCapabilityToCodexSkill(record, outputName) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = semanticRecord(record, "command");
	const description = requiredSemanticString(record, semantic, "description");
	const body = requiredSemanticString(record, semantic, "body", {
		nonEmpty: false,
	});
	const name = outputName ?? sourcePath.split("/").pop().replace(/\.md$/, "");
	if (typeof name !== "string" || !name.trim()) {
		throw new Error(`${sourcePath}: output name must be a non-empty string.`);
	}
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

	return addGeneratedMarkdownNotice(
		`---\nname: ${name}\ndescription: ${description}\n---\n${codexBody}`,
		sourcePath,
	);
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
	"## Codex 固有の責務境界",
	"",
	"この節は本文中の git に関する指示より優先する。",
	"親 agent が `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメントを担当する。",
	"subagent は worktree 内のファイル編集とテスト・検査だけを担当する。",
	"subagent は git metadata 操作や外部公開操作を実行しない。",
	"subagent の権限エラーはユーザーへ直接継続を求めず、親 agent へ引き上げる。",
	"",
].join("\n");

export function claudeRootInstructionsToAgents(source) {
	return addGeneratedMarkdownNotice(
		`${claudeInstructionsToAgents(source)}${CODEX_WORKTREE_METADATA_INSTRUCTIONS}`,
		"CLAUDE.md",
	);
}

function codexPfdImplementerDescription() {
	return "設計が確定済みの実装を委譲する。指定された worktree 内で t-wada 流 TDD によりファイルを編集し、検査する。git metadata 操作は親 agent が担当する。";
}

function pfdImplementerInstructions(source) {
	return `${claudeInstructionsToAgents(source)}${CODEX_WORKTREE_METADATA_INSTRUCTIONS}`;
}

function pfdLensInstructions(sourcePath, source) {
	const localCliPath = ["packages", "cli", "dist", "cli.js"].join("/");
	const bashRestriction = `Bash は CLI 実体を解決するための \`test -f package.json\` と \`test -f packages/cli/package.json\` と \`test -f ${localCliPath}\`、解決した CLI による \`check <file>\` と読み取り専用クエリ（\`graph\` グループ全体、\`meta get\` / \`meta list\` / \`meta check-links\`、\`status\` グループ全体）のみ許可される — 図やリポジトリの他の状態を書き換えない。`;
	if (
		source.split("\n").filter((line) => line === bashRestriction).length !== 1
	) {
		throw new Error(`${sourcePath}: expected Bash restriction clause.`);
	}
	const instructions = claudeInstructionsToAgents(source).replace(
		bashRestriction,
		bashRestriction.replace("解決した CLI", "解決した pfdsl CLI"),
	);
	return `Codex では read-only shell command の \`rg\` と \`sed\` を観点カタログと対象 \`.pfdsl\` ファイルの読取に使用してよい。\n${instructions}`;
}

function codexAgentDescription(sourcePath, description) {
	return sourcePath === "pfd-implementer.md"
		? codexPfdImplementerDescription()
		: description;
}

function codexAgentInstructions(sourcePath, sourceName, body) {
	if (sourceName === "pfd-implementer.md") {
		return pfdImplementerInstructions(body);
	}
	if (sourceName === "pfd-lens.md") {
		return pfdLensInstructions(sourcePath, body);
	}
	return claudeInstructionsToAgents(body);
}

export function buildCodexProjectConfig() {
	return [
		`# ${generatedNotice("scripts/lib/gen-codex-assets.mjs")}`,
		"",
		'sandbox_mode = "workspace-write"',
		'approval_policy = "on-request"',
		"",
		"[sandbox_workspace_write]",
		"network_access = true",
		"",
	].join("\n");
}

export function agentCapabilityToCodexToml(record) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = semanticRecord(record, "agent");
	const sourceName = sourcePath.split("/").pop();
	const name = requiredSemanticString(record, semantic, "name");
	const description = codexAgentDescription(
		sourceName,
		requiredSemanticString(record, semantic, "description"),
	);
	if (semantic.model !== "sonnet") {
		throw new Error(`${sourcePath}: unsupported model.`);
	}
	const sandbox = sandboxMode(sourcePath, semantic.tools);
	const body = requiredSemanticString(record, semantic, "body", {
		nonEmpty: false,
	});
	const instructions = tomlMultilineString(
		codexAgentInstructions(sourcePath, sourceName, body),
	);

	return [
		`# ${generatedNotice(sourcePath)}`,
		`name = ${tomlString(name)}`,
		`description = ${tomlString(description)}`,
		`sandbox_mode = ${tomlString(sandbox)}`,
		`developer_instructions = """${instructions}"""`,
		"",
	].join("\n");
}

export function hookCapabilityToCodexHooks(record) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = semanticRecord(record, "hook");
	if (
		!semantic.hooks ||
		Array.isArray(semantic.hooks) ||
		typeof semantic.hooks !== "object"
	) {
		throw new Error(`${sourcePath}: hooks must be an object.`);
	}
	return `${JSON.stringify({ hooks: semantic.hooks }, null, 2)}\n`;
}
