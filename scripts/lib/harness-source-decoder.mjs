import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse } from "yaml";
import { createGitIgnoreOracle } from "./git-ignore-oracle.mjs";
import {
	HARNESS_CAPABILITY_CONTRACT,
	LOCAL_CLAUDE_ROOT_ENTRIES,
	SOURCE_EXCLUSIONS,
} from "./harness-inventory.mjs";
import { renderHarnessTemplate } from "./harness-template.mjs";

const CLAUDE_ROOT_FILES = new Set(["settings.json"]);
const CLAUDE_ROOT_DIRECTORIES = new Set(["agents", "commands", "skills"]);
const OS_GENERATED_ENTRY_NAMES = new Set([".DS_Store"]);
const COMMAND_FRONTMATTER_KEYS = new Set(["description"]);
const AGENT_FRONTMATTER_KEYS = new Set([
	"name",
	"description",
	"tools",
	"model",
]);
const SETTINGS_KEYS = new Set(["permissions", "hooks", "enabledPlugins"]);
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

/**
 * Build the "this entry is not a maintained source" test the topology checks
 * apply to an entry they could not classify.
 *
 * A name allowlist answers "is this entry called `.DS_Store`", which is a
 * coarser question than "is this entry part of what the repository
 * maintains": every later build directory, coverage tree or editor dropping
 * under `.claude/` has to join the list one name at a time, and until it
 * does, the checkout fails an audit over a path Git already disowned
 * (takasek/pfdsl#1134). Ignore state answers the question that was meant.
 *
 * The trailing "/" on a directory is what lets a directory-only `.gitignore`
 * rule (`dist/`) match the queried path as the directory it is. It does not
 * make the match unconditional: a directory holding a tracked file at any
 * depth is reported unignored, and stays an unclassified entry.
 */
function createUnmaintainedEntryTest(root, fs, isIgnored) {
	return (path, isDirectory = fs.lstatSync(path).isDirectory()) => {
		if (OS_GENERATED_ENTRY_NAMES.has(entryName(path))) return true;
		const relativePath = relative(root, path);
		return isIgnored(isDirectory ? `${relativePath}/` : relativePath);
	};
}

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

function assertEntryClosure(
	fs,
	path,
	entries,
	exclusions,
	sourceType,
	isUnmaintained,
	optionalEntries = {},
) {
	try {
		fs.lstatSync(path);
	} catch (error) {
		if (
			error.code === "ENOENT" &&
			entries.size === 0 &&
			Object.keys(exclusions).length === 0
		)
			return;
		throw error;
	}
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
		if (Object.hasOwn(optionalEntries, name)) {
			assertType(fs, resolve(path, name), sourceType);
			continue;
		}
		if (entries.has(name) || Object.hasOwn(exclusions, name)) continue;
		const entryPath = resolve(path, name);
		if (isUnmaintained(entryPath)) continue;
		sourceTopologyError(entryPath, name);
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

function assertSkillTreeClosure(fs, path, capability, isUnmaintained) {
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
			// `stats` already says which kind this entry is, so the test is told
			// rather than made to stat the path a second time.
			if (stats.isDirectory()) {
				if (!expectedDirectory(entryRelativePath)) {
					if (isUnmaintained(entryPath, true)) continue;
					sourceTopologyError(entryPath, entryRelativePath);
				}
				visit(entryPath, entryRelativePath);
			} else if (!stats.isFile() || !expectedFiles.has(entryRelativePath)) {
				if (isUnmaintained(entryPath, false)) continue;
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

function generatedClaudeEntries(contract, kind) {
	return Object.fromEntries(
		contract
			.filter(
				(entry) =>
					entry.kind === kind && entry.source.encoding.startsWith("harness-"),
			)
			.map((entry) => {
				const output = entry.mappings.find(
					(mapping) => mapping.target === "claude-repository",
				).outputs[0];
				return [entryName(output), entry];
			}),
	);
}

function assertHarnessTemplateTopology(root, contract, fs, isUnmaintained) {
	const templates = contract.filter((entry) =>
		entry.source.encoding.startsWith("harness-"),
	);
	if (!templates.length) return;
	const base = pathFor(root, "scripts/harness-template");
	assertEntryClosure(
		fs,
		base,
		new Map(
			["skills", "commands", "agents"].map((name) => [name, { source: {} }]),
		),
		{},
		"directory",
		isUnmaintained,
	);
	for (const [kind, directory] of [
		["skill", "skills"],
		["command", "commands"],
		["agent", "agents"],
	]) {
		const entries = new Map(
			templates
				.filter((entry) => entry.kind === kind)
				.map((entry) => [entryName(entry.source.path), entry]),
		);
		assertEntryClosure(
			fs,
			resolve(base, directory),
			entries,
			{},
			kind === "skill" ? "directory" : "file",
			isUnmaintained,
		);
		if (kind === "skill")
			for (const entry of entries.values()) {
				assertSkillTreeClosure(
					fs,
					pathFor(root, entry.source.path),
					entry,
					isUnmaintained,
				);
				for (const file of entry.source.templates) {
					if (!entry.source.files.includes(file))
						sourceTopologyError(entry.source.path, file, "undeclared template");
				}
			}
	}
}

function assertClaudeTopology(
	root,
	contract,
	sourceExclusions,
	fs,
	isUnmaintained,
) {
	const claudeRoot = pathFor(root, ".claude");
	assertType(fs, claudeRoot, "directory");
	const knownRootEntries = new Set([
		...CLAUDE_ROOT_FILES,
		...Object.keys(LOCAL_CLAUDE_ROOT_ENTRIES),
		...CLAUDE_ROOT_DIRECTORIES,
		...Object.keys(sourceExclusions.root),
	]);
	for (const name of fs.readdirSync(claudeRoot)) {
		if (knownRootEntries.has(name)) continue;
		const entryPath = resolve(claudeRoot, name);
		if (isUnmaintained(entryPath)) continue;
		sourceTopologyError(entryPath, name);
	}

	assertEntryClosure(
		fs,
		resolve(claudeRoot, "skills"),
		sourceEntries(contract, "claude-skill", ".claude/skills/"),
		sourceExclusions.skills,
		"directory",
		isUnmaintained,
		generatedClaudeEntries(contract, "skill"),
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
				isUnmaintained,
			);
		}
	}
	assertEntryClosure(
		fs,
		resolve(claudeRoot, "commands"),
		sourceEntries(contract, "claude-command", ".claude/commands/"),
		sourceExclusions.commands,
		"file",
		isUnmaintained,
		generatedClaudeEntries(contract, "command"),
	);
	assertEntryClosure(
		fs,
		resolve(claudeRoot, "agents"),
		sourceEntries(contract, "claude-agent", ".claude/agents/"),
		sourceExclusions.agents,
		"file",
		isUnmaintained,
		generatedClaudeEntries(contract, "agent"),
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
			case "harness-skill-template":
				assertType(fs, path, "directory");
				continue;
			case "harness-command-template":
			case "harness-agent-template":
			case "claude-skill":
			case "claude-command":
			case "claude-agent":
			case "claude-settings":
			case "root-instructions-template":
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
	validateEnabledPlugins(path, settings.enabledPlugins);
}

// `enabledPlugins` is Claude-only: it is kept on the semantic record so the
// repository configuration is not dropped, but no Codex output renders it.
function validateEnabledPlugins(path, enabledPlugins) {
	if (enabledPlugins === undefined) return;
	assertPlainObject(enabledPlugins, path, "claude-settings", "enabledPlugins");
	for (const [plugin, enabled] of Object.entries(enabledPlugins)) {
		if (typeof enabled !== "boolean") {
			sourceSchemaError(
				path,
				"claude-settings",
				`enabledPlugins["${plugin}"]`,
				"expected boolean for",
			);
		}
	}
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
		if (source.encoding.startsWith("harness-")) {
			const variants = {};
			for (const target of ["claude", "codex"]) {
				if (capability.kind === "skill") {
					const contents = Object.fromEntries(
						source.files.map((file) => {
							const text = fs.readFileSync(resolve(path, file), "utf-8");
							return [
								file,
								source.templates.includes(file)
									? renderHarnessTemplate(
											text,
											target,
											`${source.path}/${file}`,
										)
									: text,
							];
						}),
					);
					const parsed = parseFrontmatter(
						path,
						source.encoding,
						contents["SKILL.md"],
					);
					validateSkill(path, parsed.frontmatter);
					variants[target] = { ...parsed, contents };
				} else {
					const markdown = renderHarnessTemplate(
						fs.readFileSync(path, "utf-8"),
						target,
						source.path,
					);
					const parsed = parseFrontmatter(path, source.encoding, markdown);
					if (capability.kind === "command")
						validateCommand(path, parsed.frontmatter);
					else validateAgent(path, parsed.frontmatter);
					variants[target] = { ...parsed, markdown };
				}
			}
			decoded.set(capability.id, variants);
		} else if (source.encoding === "claude-skill") {
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
		} else if (source.encoding === "root-instructions-template") {
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
		case "harness-skill-template":
			return {
				files: clone(capability.source.files),
				summary: source.claude.frontmatter.summary.trim(),
				variants: clone(source),
			};
		case "harness-command-template":
		case "harness-agent-template":
			return {
				...clone(source.codex.frontmatter),
				body: source.codex.body,
				variants: clone(source),
			};
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
		case "root-instructions-template":
			return { body: source };
		case "claude-settings":
			return {
				permissions: clone(source.permissions),
				hooks: clone(source.hooks),
				...(source.enabledPlugins === undefined
					? {}
					: { enabledPlugins: clone(source.enabledPlugins) }),
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
	isIgnored = createGitIgnoreOracle(root),
}) {
	const exclusions = normalizedSourceExclusions(sourceExclusions);
	assertHarnessTemplateTopology(
		root,
		contract,
		fs,
		createUnmaintainedEntryTest(root, fs, isIgnored),
	);
	assertClaudeTopology(
		root,
		contract,
		exclusions,
		fs,
		createUnmaintainedEntryTest(root, fs, isIgnored),
	);
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
