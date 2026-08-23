import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
	HARNESS_CAPABILITY_CONTRACT,
	SOURCE_EXCLUSIONS,
} from "./harness-inventory.mjs";

const CLAUDE_ROOT_FILES = new Set(["settings.json"]);
const CLAUDE_ROOT_DIRECTORIES = new Set(["agents", "commands", "skills"]);
const COMMAND_FRONTMATTER_KEYS = new Set(["description"]);
const AGENT_FRONTMATTER_KEYS = new Set([
	"name",
	"description",
	"tools",
	"model",
]);
const SETTINGS_KEYS = new Set(["permissions", "hooks"]);
const PERMISSIONS_KEYS = new Set(["allow"]);
const HOOK_ENTRY_KEYS = new Set(["matcher", "hooks"]);
const HOOK_COMMAND_KEYS = new Set([
	"type",
	"command",
	"timeout",
	"statusMessage",
]);
const SETTINGS_HOOK_EVENTS = new Set([
	"PreToolUse",
	"PostToolUse",
	"SessionStart",
]);
const PLUGIN_HOOK_EVENTS = new Set(["PostToolUse"]);

function sourceTopologyError(path, name, detail = "unclassified") {
	throw new Error(`source-topology: ${path}: ${detail} ${name}.`);
}

function sourceSchemaError(path, surface, name, detail = "unknown") {
	throw new Error(`source-schema: ${surface}: ${path}: ${detail} ${name}.`);
}

function pathFor(root, relativePath) {
	return resolve(root, relativePath);
}

function entryName(relativePath) {
	return relativePath.slice(relativePath.lastIndexOf("/") + 1);
}

function assertType(fs, path, type) {
	const stats = fs.lstatSync(path);
	const matches =
		(type === "directory" && stats.isDirectory()) ||
		(type === "file" && stats.isFile()) ||
		(type === "symlink" && stats.isSymbolicLink());
	if (!matches) {
		sourceTopologyError(path, entryName(path), `expected ${type} for`);
	}
}

function sourceEntries(contract, encoding, prefix) {
	return new Map(
		contract
			.filter((capability) => capability.source?.encoding === encoding)
			.map((capability) => [
				capability.source.path.slice(prefix.length),
				capability,
			]),
	);
}

function assertEntryClosure(fs, path, entries, exclusions, sourceType) {
	assertType(fs, path, "directory");
	for (const name of Object.keys(exclusions)) {
		if (entries.has(name)) {
			sourceTopologyError(
				resolve(path, name),
				name,
				"duplicate classification for",
			);
		}
	}
	for (const name of fs.readdirSync(path)) {
		if (!entries.has(name) && !Object.hasOwn(exclusions, name)) {
			sourceTopologyError(resolve(path, name), name);
		}
	}
	for (const [name, capability] of entries) {
		const sourcePath = resolve(path, name);
		const type = capability.source.generated ? "symlink" : sourceType;
		assertType(fs, sourcePath, type);
	}
	for (const name of Object.keys(exclusions)) {
		assertType(fs, resolve(path, name), sourceType);
	}
}

function assertSkillTreeClosure(fs, path, capability) {
	const files = capability.source.files;
	if (!Array.isArray(files)) {
		sourceTopologyError(path, capability.id, "missing declared files for");
	}
	const expectedFiles = new Set(files);
	const expectedDirectory = (relativePath) =>
		[...expectedFiles].some((file) => file.startsWith(`${relativePath}/`));

	function visit(directory, relativePath = "") {
		for (const name of fs.readdirSync(directory)) {
			const entryPath = resolve(directory, name);
			const entryRelativePath = relativePath ? `${relativePath}/${name}` : name;
			const stats = fs.lstatSync(entryPath);
			if (stats.isDirectory()) {
				if (!expectedDirectory(entryRelativePath)) {
					sourceTopologyError(entryPath, entryRelativePath);
				}
				visit(entryPath, entryRelativePath);
			} else if (!stats.isFile() || !expectedFiles.has(entryRelativePath)) {
				sourceTopologyError(entryPath, entryRelativePath);
			}
		}
	}

	visit(path);
	for (const file of expectedFiles) {
		assertType(fs, resolve(path, file), "file");
	}
}

function normalizedSourceExclusions(sourceExclusions) {
	return {
		root: sourceExclusions.root ?? {},
		skills: sourceExclusions.skills ?? {},
		commands: sourceExclusions.commands ?? {},
		agents: sourceExclusions.agents ?? {},
	};
}

function assertClaudeTopology(root, contract, sourceExclusions, fs) {
	const claudeRoot = pathFor(root, ".claude");
	assertType(fs, claudeRoot, "directory");
	const knownRootEntries = new Set([
		...CLAUDE_ROOT_FILES,
		...CLAUDE_ROOT_DIRECTORIES,
		...Object.keys(sourceExclusions.root),
	]);
	for (const name of fs.readdirSync(claudeRoot)) {
		if (!knownRootEntries.has(name)) {
			sourceTopologyError(resolve(claudeRoot, name), name);
		}
	}

	assertEntryClosure(
		fs,
		resolve(claudeRoot, "skills"),
		sourceEntries(contract, "claude-skill", ".claude/skills/"),
		sourceExclusions.skills,
		"directory",
	);
	for (const capability of sourceEntries(
		contract,
		"claude-skill",
		".claude/skills/",
	).values()) {
		if (!capability.source.generated) {
			assertSkillTreeClosure(
				fs,
				pathFor(root, capability.source.path),
				capability,
			);
		}
	}
	assertEntryClosure(
		fs,
		resolve(claudeRoot, "commands"),
		sourceEntries(contract, "claude-command", ".claude/commands/"),
		sourceExclusions.commands,
		"file",
	);
	assertEntryClosure(
		fs,
		resolve(claudeRoot, "agents"),
		sourceEntries(contract, "claude-agent", ".claude/agents/"),
		sourceExclusions.agents,
		"file",
	);
	assertType(fs, resolve(claudeRoot, "settings.json"), "file");
	for (const name of Object.keys(sourceExclusions.root)) {
		assertType(fs, resolve(claudeRoot, name), "file");
	}
}

function assertDeclaredSourceTypes(root, contract, fs) {
	for (const capability of contract) {
		const path = pathFor(root, capability.source.path);
		switch (capability.source.encoding) {
			case "claude-skill":
			case "claude-command":
			case "claude-agent":
			case "claude-settings":
			case "claude-root-instructions":
			case "plugin-hooks":
			case "cli-package-metadata":
				break;
			default:
				sourceTopologyError(path, capability.source.encoding);
		}
		if (capability.source.encoding === "claude-skill") continue;
		assertType(fs, path, "file");
	}
}

function assertPlainObject(value, path, surface, name) {
	if (!value || Array.isArray(value) || typeof value !== "object") {
		sourceSchemaError(path, surface, name, "expected object for");
	}
}

function assertKnownKeys(value, keys, path, surface) {
	assertPlainObject(value, path, surface, "value");
	for (const key of Object.keys(value)) {
		if (!keys.has(key)) sourceSchemaError(path, surface, key);
	}
}

function parseFrontmatter(path, surface, source) {
	const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	if (!match) sourceSchemaError(path, surface, "frontmatter", "required");
	const frontmatter = parse(match[1]);
	assertPlainObject(frontmatter, path, surface, "frontmatter");
	return { body: source.slice(match[0].length), frontmatter };
}

function parseJson(path, surface, source) {
	try {
		const parsed = JSON.parse(source);
		assertPlainObject(parsed, path, surface, "JSON");
		return parsed;
	} catch (error) {
		if (error.message.startsWith("source-schema:")) throw error;
		sourceSchemaError(path, surface, "JSON", "invalid");
	}
}

function validateHookCommands(path, surface, commands) {
	if (!Array.isArray(commands)) {
		sourceSchemaError(path, surface, "hooks", "expected array for");
	}
	for (const command of commands) {
		assertKnownKeys(command, HOOK_COMMAND_KEYS, path, surface);
	}
}

function validateHooks(path, surface, hooks, events) {
	assertPlainObject(hooks, path, surface, "hooks");
	for (const [event, entries] of Object.entries(hooks)) {
		if (!events.has(event)) sourceSchemaError(path, surface, event);
		if (!Array.isArray(entries)) {
			sourceSchemaError(path, surface, event, "expected array for");
		}
		for (const entry of entries) {
			assertKnownKeys(entry, HOOK_ENTRY_KEYS, path, surface);
			validateHookCommands(path, surface, entry.hooks);
		}
	}
}

function validateCommand(path, frontmatter) {
	assertKnownKeys(
		frontmatter,
		COMMAND_FRONTMATTER_KEYS,
		path,
		"claude-command",
	);
}

function validateSkill(path, frontmatter) {
	if (typeof frontmatter.summary !== "string" || !frontmatter.summary.trim()) {
		sourceSchemaError(path, "claude-skill", "summary", "required string for");
	}
}

function validateAgent(path, frontmatter) {
	assertKnownKeys(frontmatter, AGENT_FRONTMATTER_KEYS, path, "claude-agent");
}

function validateSettings(path, settings) {
	assertKnownKeys(settings, SETTINGS_KEYS, path, "claude-settings");
	assertKnownKeys(
		settings.permissions,
		PERMISSIONS_KEYS,
		path,
		"claude-settings",
	);
	validateHooks(path, "claude-settings", settings.hooks, SETTINGS_HOOK_EVENTS);
}

function validatePluginHooks(path, manifest) {
	assertKnownKeys(manifest, new Set(["hooks"]), path, "plugin-hooks");
	validateHooks(path, "plugin-hooks", manifest.hooks, PLUGIN_HOOK_EVENTS);
}

function readAndValidateDeclaredSources(root, contract, fs) {
	const decoded = new Map();
	for (const capability of contract) {
		const path = pathFor(root, capability.source.path);
		const source = capability.source;
		if (source.encoding === "claude-skill") {
			const skillPath = resolve(path, "SKILL.md");
			const parsed = parseFrontmatter(
				skillPath,
				"claude-skill",
				fs.readFileSync(skillPath, "utf-8"),
			);
			validateSkill(skillPath, parsed.frontmatter);
			decoded.set(capability.id, parsed);
		} else if (source.encoding === "claude-command") {
			const parsed = parseFrontmatter(
				path,
				"claude-command",
				fs.readFileSync(path, "utf-8"),
			);
			validateCommand(path, parsed.frontmatter);
			decoded.set(capability.id, parsed);
		} else if (source.encoding === "claude-agent") {
			const parsed = parseFrontmatter(
				path,
				"claude-agent",
				fs.readFileSync(path, "utf-8"),
			);
			validateAgent(path, parsed.frontmatter);
			decoded.set(capability.id, parsed);
		} else if (source.encoding === "claude-settings") {
			const parsed = parseJson(
				path,
				"claude-settings",
				fs.readFileSync(path, "utf-8"),
			);
			validateSettings(path, parsed);
			decoded.set(capability.id, parsed);
		} else if (source.encoding === "plugin-hooks") {
			const parsed = parseJson(
				path,
				"plugin-hooks",
				fs.readFileSync(path, "utf-8"),
			);
			validatePluginHooks(path, parsed);
			decoded.set(capability.id, parsed);
		} else if (source.encoding === "claude-root-instructions") {
			decoded.set(capability.id, fs.readFileSync(path, "utf-8"));
		} else if (source.encoding === "cli-package-metadata") {
			decoded.set(
				capability.id,
				parseJson(path, "plugin-metadata", fs.readFileSync(path, "utf-8")),
			);
		}
	}
	return decoded;
}

function clone(value) {
	if (Array.isArray(value)) return value.map(clone);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, clone(item)]),
		);
	}
	return value;
}

function deepFreeze(value) {
	if (!value || typeof value !== "object" || Object.isFrozen(value))
		return value;
	for (const item of Object.values(value)) deepFreeze(item);
	return Object.freeze(value);
}

function decodeSemanticRecord(capability, source) {
	switch (capability.source.encoding) {
		case "claude-skill":
			return {
				files: clone(capability.source.files ?? []),
				summary: source.frontmatter.summary.trim(),
			};
		case "claude-command":
			return { description: source.frontmatter.description, body: source.body };
		case "claude-agent":
			return {
				name: source.frontmatter.name,
				description: source.frontmatter.description,
				tools: source.frontmatter.tools,
				model: source.frontmatter.model,
				body: source.body,
			};
		case "claude-root-instructions":
			return { body: source };
		case "claude-settings":
			return {
				permissions: clone(source.permissions),
				hooks: clone(source.hooks),
			};
		case "plugin-hooks":
			return { hooks: clone(source.hooks) };
		case "cli-package-metadata":
			return {
				version: source.version,
				identity: clone(capability.source.identity),
			};
		default:
			return {};
	}
}

/**
 * Reads only declared maintained-source roots and rejects every unclassified
 * .claude entry before adapter-specific encoding begins.
 */
export function decodeHarnessSources({
	root,
	contract = HARNESS_CAPABILITY_CONTRACT,
	sourceExclusions = SOURCE_EXCLUSIONS,
	fs = { lstatSync, readFileSync, readdirSync },
}) {
	const exclusions = normalizedSourceExclusions(sourceExclusions);
	assertClaudeTopology(root, contract, exclusions, fs);
	assertDeclaredSourceTypes(root, contract, fs);
	const decodedSources = readAndValidateDeclaredSources(root, contract, fs);
	return deepFreeze(
		contract.map((capability) => ({
			...clone(capability),
			semantic: decodeSemanticRecord(
				capability,
				decodedSources.get(capability.id),
			),
		})),
	);
}
