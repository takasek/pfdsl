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

export function commandToCodexSkill(sourcePath, source) {
	const { body, frontmatter } = parseFrontmatter(sourcePath, source);
	for (const key of Object.keys(frontmatter)) {
		if (!COMMAND_FRONTMATTER_KEYS.has(key)) {
			throw new Error(
				`${sourcePath}: unsupported command frontmatter key ${key}.`,
			);
		}
	}
	const description = requiredDescription(sourcePath, frontmatter);
	const name = sourcePath.replace(/\.md$/, "");
	const codexBody = body.replace(
		"引数（あれば作業選択の指定として扱う）: $ARGUMENTS",
		"ユーザーがスキル呼び出しとともに指定した内容があれば、作業選択の指定として扱う。",
	);

	return `---\nname: ${name}\ndescription: ${description}\n---\n${codexBody}`;
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
		.replaceAll(".Codex/settings.json", ".codex/hooks.json")
		.replaceAll(".claude/settings.json", ".codex/hooks.json");
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
	const description = requiredDescription(sourcePath, frontmatter);
	if (frontmatter.model !== "sonnet") {
		throw new Error(`${sourcePath}: unsupported model.`);
	}
	const sandbox = sandboxMode(sourcePath, frontmatter.tools);
	const instructions = tomlMultilineString(claudeInstructionsToAgents(body));

	return [
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
