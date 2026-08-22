import { randomUUID } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	BUNDLE_MANIFEST_RELATIVE_PATH,
	writeBundleManifest,
} from "./bundle-manifest.mjs";
import {
	agentToCodexToml,
	buildCodexPluginManifest,
	claudeHooksToCodexHooks,
	claudeInstructionsToAgents,
	commandToCodexSkill,
} from "./gen-codex-assets.mjs";
import { genInstall } from "./gen-install.mjs";
import { writeSkillRefs } from "./gen-skill-refs.mjs";
import {
	AGENT_EXCLUSIONS,
	CLAUDE_PLUGIN_MIRRORS,
	DISTRIBUTED_AGENTS,
	DISTRIBUTED_COMMANDS,
	DISTRIBUTED_SKILLS,
	GENERATED_SKILLS,
} from "./harness-inventory.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CODEX_ASSEMBLY_LOCK_DIRECTORY = ".codex-assets-assembly.lock";
const CODEX_COMMAND_SKILLS_MANIFEST = "codex-command-skills.json";
const CODEX_SKILLS_ROOT = "skills";

// The agents bundled into plugin/pfdsl/agents/, as .claude/agents/-relative
// filenames. The harness inventory is the single source of truth, and
// gen-plugin-trigger.mjs derives its drift-trigger alternation from this
// legacy alias, so adding an agent cannot land in one place and be forgotten
// in the other.
export const PLUGIN_AGENT_FILES = DISTRIBUTED_AGENTS;

// Legacy names for the skill trees mirrored into plugin/pfdsl/skills/ from
// .claude/skills/ and the commands mirrored into plugin/pfdsl/commands/.
// assemblePluginDistIndependent bundles exactly these, and
// scripts/lib/distribution-review.mjs maps a bundled file back to the source a
// reviewer edits, so the two cannot disagree about what ships.
// The pfdsl skill is absent because it is rendered, not mirrored (gen-skill).
export const PLUGIN_SKILL_DIRS = DISTRIBUTED_SKILLS;
export const PLUGIN_COMMAND_FILES = DISTRIBUTED_COMMANDS;

// Commands and skills share Codex's plugin/skills namespace. Derive a
// command's output name from the maintained inventory so a newly overlapping
// name cannot replace an existing distributed skill at generation time.
export function codexCommandSkillName(source) {
	const name = source.replace(/\.md$/, "");
	return DISTRIBUTED_SKILLS.includes(name) ? `source-command-${name}` : name;
}

/**
 * What the bundle is made of, as data: where each bundled subtree comes from,
 * and which members are copied into it. `trees` mirrors each named directory,
 * `files` copies a named set, `whole` mirrors the source directory entire.
 *
 * assemblePluginDistIndependent iterates this to build the bundle, and
 * scripts/lib/distribution-review.mjs inverts it to send a reviewer from a
 * bundled file back to the file they must edit. Declaring it once means the
 * two agree about the *shape* of the mapping and not merely about the names —
 * renaming a bundle root or adding a mirrored source can no longer land in the
 * assembly while the reverse map keeps pointing at the old layout.
 */
export const PLUGIN_MIRRORS = CLAUDE_PLUGIN_MIRRORS;

// Agents that stay out of the bundle, with why — an adopting repo gets the
// pfd-* ones because they operate on the .pfdsl files it now has, and nothing
// else. Named rather than merely absent so a drift test can require every file
// in .claude/agents/ to be either bundled or listed here (#613).
export const PLUGIN_AGENT_EXCLUSIONS = AGENT_EXCLUSIONS;

function requireExists(path) {
	if (!existsSync(path)) {
		throw new Error(`${path} not found.`);
	}
}

// Excludes a skill-root CLAUDE.md (a dev-repo-only guard — e.g. "run make
// gen-skill" instructions that only make sense in this repo) from a mirrored
// copy. Mirrors the exclusion the deleted skill-sync.ts's copySkillTree used
// to apply uniformly to every bundled skill tree.
function excludeSkillRootClaudeMd(skillRoot) {
	return (source) =>
		basename(source) !== "CLAUDE.md" || dirname(source) !== skillRoot;
}

/**
 * Mirrors a whole directory (e.g. a skill tree) from srcRoot/name into
 * destRoot/name, excluding any CLAUDE.md living directly at the source
 * root (see excludeSkillRootClaudeMd). Copies into a temporary sibling
 * path first and only replaces the destination once the copy fully
 * succeeds — a plain rm-then-cp would otherwise leave the destination
 * empty/partial if cpSync fails partway (disk full, a source file
 * becoming unreadable mid-copy, concurrent deletion).
 * @param {string} name
 * @param {string} srcRoot
 * @param {string} destRoot
 */
export function mirrorDir(name, srcRoot, destRoot) {
	const src = resolve(srcRoot, name);
	const dest = resolve(destRoot, name);
	requireExists(src);
	const tempDest = resolve(destRoot, `.${name}.mirror-tmp`);
	rmSync(tempDest, { recursive: true, force: true });
	cpSync(src, tempDest, {
		recursive: true,
		filter: excludeSkillRootClaudeMd(src),
	});
	rmSync(dest, { recursive: true, force: true });
	renameSync(tempDest, dest);
}

/**
 * Mirrors an allowlisted set of individual files from srcDir into destDir.
 * Copies into a temporary sibling directory first and only replaces destDir
 * once every named file has copied successfully, so a failure partway
 * through the list (missing/unreadable file) leaves the prior destination
 * untouched instead of half-populated.
 * @param {string[]} names
 * @param {string} srcDir
 * @param {string} destDir
 */
export function mirrorFiles(names, srcDir, destDir) {
	const tempDestDir = `${destDir}.mirror-tmp`;
	rmSync(tempDestDir, { recursive: true, force: true });
	mkdirSync(tempDestDir, { recursive: true });
	for (const name of names) {
		const src = resolve(srcDir, name);
		requireExists(src);
		cpSync(src, resolve(tempDestDir, name));
	}
	rmSync(destDir, { recursive: true, force: true });
	renameSync(tempDestDir, destDir);
}

// Where each bundled skill's source SKILL.md lives, keyed the same way as
// PLUGIN_SKILL_DIRS. "pfdsl" points at the template (scripts/skill-template/)
// rather than .claude/skills/pfdsl/SKILL.md because the latter is generated
// output (DO NOT EDIT) — the template is what a human actually maintains.
const SKILL_SOURCE_DIRS = {
	pfdsl: "scripts/skill-template",
	...Object.fromEntries(
		PLUGIN_SKILL_DIRS.map((name) => [name, `.claude/skills/${name}`]),
	),
};

/** Extract a single-line scalar frontmatter field from SKILL.md source. */
function extractFrontmatterField(source, field) {
	const m = source.match(new RegExp(`^${field}:[ \\t]*(.+)$`, "m"));
	return m?.[1]?.trim();
}

// Reads a bundled skill's one-line manifest blurb from its own SKILL.md
// frontmatter ("summary:", next to "description:") instead of a
// hand-maintained table (#696): editing a skill's role no longer requires
// remembering a second file, because there is no second file to remember.
function summaryFor(
	name,
	kind,
	{ root = REPO_ROOT, readFileSync: readFile = readFileSync } = {},
) {
	const dir = SKILL_SOURCE_DIRS[name];
	if (!dir) {
		throw new Error(
			`No manifest description summary for bundled ${kind} "${name}". Register its source dir in SKILL_SOURCE_DIRS in scripts/lib/gen-plugin.mjs.`,
		);
	}
	const path = resolve(root, dir, "SKILL.md");
	let source;
	try {
		source = readFile(path, "utf-8");
	} catch {
		throw new Error(
			`No manifest description summary for bundled ${kind} "${name}": ${path} not found.`,
		);
	}
	const summary = extractFrontmatterField(source, "summary");
	if (!summary) {
		throw new Error(
			`${path} has no "summary:" frontmatter field for the plugin manifest description. Add one alongside "description:".`,
		);
	}
	return summary;
}

// Builds the plugin/marketplace manifest description from what's actually
// bundled (skillDirs, commandFiles), rather than a hand-maintained sentence
// that can drift from PLUGIN_SKILL_DIRS/PLUGIN_COMMAND_FILES as skills and
// commands are added or removed. A skill needs a "summary:" frontmatter
// field (see summaryFor) — one with none throws instead of being silently
// dropped from the description. Commands need no table: their blurb is the
// slash form of the filename, so there is nothing that could drift from
// PLUGIN_COMMAND_FILES independently.
// @param {{skillDirs?: string[], commandFiles?: string[], root?: string, readFileSync?: Function}} [options]
export function buildPluginDescription({
	skillDirs = ["pfdsl", ...PLUGIN_SKILL_DIRS],
	commandFiles = PLUGIN_COMMAND_FILES,
	root,
	readFileSync: readFile,
} = {}) {
	const skillParts = skillDirs.map(
		(name) =>
			`${summaryFor(name, "skill", { root, readFileSync: readFile })} (${name} skill)`,
	);
	const commandParts = commandFiles.map(
		(file) => `/${file.replace(/\.md$/, "")}`,
	);
	return `PFD-DSL authoring toolkit: ${skillParts.join(", ")}, and ${commandParts.join(", ")} commands.`;
}

// Builds the Claude Code plugin manifest object for .claude-plugin/plugin.json.
// version is derived from packages/cli/package.json so drift (a CLI release
// without a matching plugin.json update) shows up as a diff, not a silent gap.
// description is derived from the actual bundle contents (buildPluginDescription)
// so it can't drift from what plugin/pfdsl/ ships. Used by scripts/gen-plugin.mjs.

export function buildPluginManifest({
	cliVersion,
	root,
	readFileSync: readFile,
	skillDirs,
	commandFiles,
}) {
	return {
		name: "pfdsl",
		description: buildPluginDescription({
			skillDirs,
			commandFiles,
			root,
			readFileSync: readFile,
		}),
		version: cliVersion,
		author: { name: "takasek" },
		homepage: "https://github.com/takasek/pfdsl",
		license: "MIT",
	};
}

function temporaryAssemblySibling(destination, kind, runId) {
	return `${destination}.codex-${kind}-${runId}`;
}

function stageFile(destination, content, deps, runId) {
	const temporary = temporaryAssemblySibling(destination, "tmp", runId);
	try {
		deps.rmSync(temporary, { force: true });
		deps.mkdirSync(dirname(temporary), { recursive: true });
		deps.writeFileSync(temporary, content);
	} catch (error) {
		removeAssemblyArtifact(temporary, deps);
		throw error;
	}
	return { destination, temporary };
}

function stageDirectory(destination, files, deps, runId) {
	const temporary = temporaryAssemblySibling(destination, "tmp", runId);
	try {
		deps.rmSync(temporary, { recursive: true, force: true });
		deps.mkdirSync(temporary, { recursive: true });
		for (const { path, content } of files) {
			const output = resolve(temporary, path);
			deps.mkdirSync(dirname(output), { recursive: true });
			deps.writeFileSync(output, content);
		}
	} catch (error) {
		removeAssemblyArtifact(temporary, deps);
		throw error;
	}
	return { destination, temporary };
}

function normalizeCodexMarkdownTree(directory, deps) {
	if (!deps.readdirSync) return;
	for (const entry of deps.readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			normalizeCodexMarkdownTree(path, deps);
			continue;
		}
		if (!entry.isFile() || !path.endsWith(".md")) continue;
		const source = deps.readFileSync(path, "utf-8");
		const normalized = claudeInstructionsToAgents(source).replace(
			/(?:\r?\n){2,}$/,
			"\n",
		);
		if (normalized !== source) deps.writeFileSync(path, normalized);
	}
}

function stageCodexSkillTrees(root, deps, runId) {
	const destination = resolve(root, ".agents/skills");
	const temporary = temporaryAssemblySibling(destination, "tmp", runId);
	try {
		deps.rmSync(temporary, { recursive: true, force: true });
		deps.mkdirSync(temporary, { recursive: true });
		for (const name of DISTRIBUTED_SKILLS) {
			const source = resolve(root, ".claude/skills", name);
			const output = resolve(temporary, name);
			deps.cpSync(source, output, {
				recursive: true,
				filter: excludeSkillRootClaudeMd(source),
			});
		}
		for (const [name, classification] of Object.entries(GENERATED_SKILLS)) {
			const source = resolve(root, classification.target);
			const output = resolve(temporary, name);
			deps.cpSync(source, output, {
				recursive: true,
				filter: excludeSkillRootClaudeMd(source),
			});
		}
		normalizeCodexMarkdownTree(temporary, deps);
	} catch (error) {
		removeAssemblyArtifact(temporary, deps);
		throw error;
	}
	return { destination, temporary };
}

// The native tree starts from the complete Claude plugin skill distribution,
// so rendered pfdsl references and every nested asset travel together. Only
// Markdown is harness-specific; cpSync preserves scripts and other assets
// byte-for-byte before normalizeCodexMarkdownTree rewrites Markdown in place.
function stageCodexPluginSkillTrees(
	claudePluginRoot,
	codexPluginRoot,
	commands,
	legacyOwnedNames,
	protectedSkillDirectories,
	deps,
	runId,
) {
	const destination = resolve(codexPluginRoot, CODEX_SKILLS_ROOT);
	const temporary = temporaryAssemblySibling(destination, "tmp", runId);
	try {
		deps.rmSync(temporary, { recursive: true, force: true });
		deps.cpSync(resolve(claudePluginRoot, "skills"), temporary, {
			recursive: true,
		});
		for (const name of legacyOwnedNames) {
			if (protectedSkillDirectories.has(name)) continue;
			deps.rmSync(resolve(temporary, name), { recursive: true, force: true });
		}
		normalizeCodexMarkdownTree(temporary, deps);
		for (const { name, sourcePath, source } of commands) {
			const output = resolve(temporary, name, "SKILL.md");
			deps.mkdirSync(dirname(output), { recursive: true });
			deps.writeFileSync(output, commandToCodexSkill(sourcePath, source, name));
		}
	} catch (error) {
		removeAssemblyArtifact(temporary, deps);
		throw error;
	}
	return { destination, temporary };
}

function stageCodexPluginHooks(root, codexPluginRoot, deps, runId) {
	const destination = resolve(codexPluginRoot, "hooks");
	const temporary = temporaryAssemblySibling(destination, "tmp", runId);
	try {
		deps.rmSync(temporary, { recursive: true, force: true });
		deps.cpSync(resolve(root, "hooks"), temporary, { recursive: true });
	} catch (error) {
		removeAssemblyArtifact(temporary, deps);
		throw error;
	}
	return { destination, temporary };
}

function stageRemoval(destination) {
	return { destination, remove: true };
}

// Cleanup is best effort because an I/O error while removing a temporary
// sibling must not replace the staging or publication error that triggered it.
function removeAssemblyArtifact(path, deps) {
	try {
		deps.rmSync(path, { recursive: true, force: true });
	} catch {
		// Preserve the primary assembly error.
	}
}

function removeStagedArtifacts(staged, deps) {
	for (const { temporary } of staged) {
		if (temporary) removeAssemblyArtifact(temporary, deps);
	}
}

function restoreAssemblyDestination(backup, destination, deps) {
	try {
		deps.renameSync(backup, destination);
	} catch {
		// Preserve the primary assembly error.
	}
}

function snapshotAssemblyDestination(destination, backup, deps) {
	deps.rmSync(backup, { recursive: true, force: true });
	const hadDestination = deps.existsSync(destination);
	try {
		if (hadDestination) {
			deps.mkdirSync(dirname(backup), { recursive: true });
			deps.cpSync(destination, backup, { recursive: true });
		}
	} catch (error) {
		removeAssemblyArtifact(backup, deps);
		throw error;
	}
	return { backup, hadDestination };
}

function snapshotPluginGeneration(root, pluginRoot, deps, runId) {
	const transactionRoot = resolve(
		dirname(pluginRoot),
		`.pfdsl-gen-txn-${runId}`,
	);
	deps.rmSync(transactionRoot, { recursive: true, force: true });
	try {
		const snapshots = [
			[
				pluginRoot,
				snapshotAssemblyDestination(
					pluginRoot,
					resolve(transactionRoot, "plugin-root"),
					deps,
				),
			],
			[
				resolve(root, ".claude-plugin/marketplace.json"),
				snapshotAssemblyDestination(
					resolve(root, ".claude-plugin/marketplace.json"),
					resolve(transactionRoot, "marketplace.json"),
					deps,
				),
			],
			[
				resolve(root, ".claude/skills/pfd-ops/install"),
				snapshotAssemblyDestination(
					resolve(root, ".claude/skills/pfd-ops/install"),
					resolve(transactionRoot, "install"),
					deps,
				),
			],
		];
		return { transactionRoot, snapshots };
	} catch (error) {
		removeAssemblyArtifact(transactionRoot, deps);
		throw error;
	}
}

function restoreAssemblySnapshot(destination, snapshot, deps) {
	removeAssemblyArtifact(destination, deps);
	if (!snapshot.hadDestination) return true;
	try {
		deps.renameSync(snapshot.backup, destination);
		return true;
	} catch {
		return false;
	}
}

// All outputs are staged before replacing any final destination. During the
// replacement phase, preserve prior destinations as siblings and restore them
// if an individual rename fails. This keeps a failed generation from exposing
// a mixed old/new Codex surface or a half-written generated tree.
function publishStaged(staged, deps, runId) {
	const published = [];
	const backups = [];
	try {
		for (const entry of staged) {
			const backup = temporaryAssemblySibling(entry.destination, "prev", runId);
			deps.rmSync(backup, { recursive: true, force: true });
			const hadDestination = deps.existsSync(entry.destination);
			if (hadDestination) deps.renameSync(entry.destination, backup);
			backups.push({ ...entry, backup, hadDestination });
		}
		for (const entry of backups) {
			if (!entry.remove) {
				deps.renameSync(entry.temporary, entry.destination);
				published.push(entry);
			}
		}
	} catch (error) {
		for (const entry of published.reverse()) {
			removeAssemblyArtifact(entry.destination, deps);
		}
		for (const entry of backups.reverse()) {
			if (entry.hadDestination)
				restoreAssemblyDestination(entry.backup, entry.destination, deps);
		}
		removeStagedArtifacts(staged, deps);
		throw error;
	}
	for (const entry of backups) {
		if (entry.hadDestination) {
			removeAssemblyArtifact(entry.backup, deps);
		}
	}
}

function acquireCodexAssemblyLock(root, deps) {
	const lockPath = resolve(root, CODEX_ASSEMBLY_LOCK_DIRECTORY);
	try {
		deps.mkdirSync(lockPath);
	} catch (error) {
		if (error?.code === "EEXIST") {
			throw new Error(
				`Codex asset assembly lock is held at ${lockPath}; retry after the active generator completes.`,
			);
		}
		throw error;
	}
	return lockPath;
}

function releaseCodexAssemblyLock(lockPath, deps) {
	removeAssemblyArtifact(lockPath, deps);
}

function commandSkillManifestPath(pluginRoot) {
	return resolve(pluginRoot, ".codex-plugin", CODEX_COMMAND_SKILLS_MANIFEST);
}

function validOwnedSkillDirectories(path, owned) {
	if (
		!Array.isArray(owned) ||
		new Set(owned).size !== owned.length ||
		owned.some(
			(name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name),
		)
	) {
		throw new Error(`${path}: invalid Codex command skill ownership manifest.`);
	}
	return owned;
}

function commandSkillNames() {
	const names = DISTRIBUTED_COMMANDS.map(codexCommandSkillName);
	if (new Set(names).size !== names.length) {
		throw new Error("Codex command skill names must be unique.");
	}
	return names;
}

function readOwnedCommandSkillDirectories(pluginRoot, deps) {
	const path = commandSkillManifestPath(pluginRoot);
	if (!deps.existsSync(path)) return { codex: [], legacy: [] };
	let manifest;
	try {
		manifest = JSON.parse(deps.readFileSync(path, "utf-8"));
	} catch {
		throw new Error(`${path}: invalid Codex command skill ownership manifest.`);
	}
	if (!manifest || typeof manifest !== "object") {
		throw new Error(`${path}: invalid Codex command skill ownership manifest.`);
	}
	const owned = validOwnedSkillDirectories(
		path,
		manifest.ownedSkillDirectories,
	);
	if (
		manifest.skillRoot === undefined ||
		manifest.skillRoot === "codex/skills"
	) {
		return { codex: [], legacy: owned };
	}
	if (manifest.skillRoot !== CODEX_SKILLS_ROOT) {
		throw new Error(`${path}: invalid Codex command skill ownership manifest.`);
	}
	return { codex: owned, legacy: [] };
}

/**
 * Generates the Codex repository and plugin assets from the maintained
 * Claude sources. Each output is first written to a temporary sibling; only
 * after every write succeeds are the destinations replaced together.
 * @param {{root: string, pluginRoot: string, codexPluginRoot?: string, deps?: object}} options
 */
export function assembleCodexAssets({
	root,
	pluginRoot,
	codexPluginRoot = resolve(root, "plugin/pfdsl-codex"),
	deps = {
		cpSync,
		existsSync,
		mkdirSync,
		newRunId: randomUUID,
		readdirSync,
		readFileSync,
		renameSync,
		rmSync,
		writeFileSync,
	},
}) {
	const staged = [];
	const lockPath = acquireCodexAssemblyLock(root, deps);
	let primaryError;
	try {
		const runId = deps.newRunId?.() ?? randomUUID();
		const read = (path) => deps.readFileSync(path, "utf-8");
		const cliVersion = JSON.parse(
			read(resolve(root, "packages/cli/package.json")),
		).version;
		const description = buildPluginDescription({
			root,
			readFileSync: deps.readFileSync,
		});
		const names = commandSkillNames();
		readOwnedCommandSkillDirectories(codexPluginRoot, deps);
		const legacyOwned = readOwnedCommandSkillDirectories(pluginRoot, deps);
		const protectedSkillDirectories = new Set([
			...DISTRIBUTED_SKILLS,
			...Object.keys(GENERATED_SKILLS),
		]);
		staged.push(
			stageFile(
				resolve(root, "AGENTS.md"),
				claudeInstructionsToAgents(read(resolve(root, "CLAUDE.md"))),
				deps,
				runId,
			),
		);
		staged.push(
			stageFile(
				resolve(root, ".codex/hooks.json"),
				claudeHooksToCodexHooks(read(resolve(root, ".claude/settings.json"))),
				deps,
				runId,
			),
		);
		staged.push(
			stageFile(
				resolve(codexPluginRoot, ".codex-plugin/plugin.json"),
				`${JSON.stringify(buildCodexPluginManifest({ version: cliVersion, description }), null, 2)}\n`,
				deps,
				runId,
			),
		);
		staged.push(stageCodexSkillTrees(root, deps, runId));
		const commandSkills = DISTRIBUTED_COMMANDS.map((source, index) => ({
			name: names[index],
			sourcePath: source,
			source: read(resolve(root, ".claude/commands", source)),
		}));
		staged.push(
			stageCodexPluginSkillTrees(
				pluginRoot,
				codexPluginRoot,
				commandSkills,
				legacyOwned.legacy,
				protectedSkillDirectories,
				deps,
				runId,
			),
		);
		staged.push(stageCodexPluginHooks(root, codexPluginRoot, deps, runId));
		staged.push(
			stageDirectory(
				resolve(root, ".codex/agents"),
				DISTRIBUTED_AGENTS.map((source) => ({
					path: source.replace(/\.md$/, ".toml"),
					content: agentToCodexToml(
						source,
						read(resolve(root, ".claude/agents", source)),
					),
				})),
				deps,
				runId,
			),
		);
		staged.push(
			stageFile(
				commandSkillManifestPath(codexPluginRoot),
				`${JSON.stringify({ skillRoot: CODEX_SKILLS_ROOT, ownedSkillDirectories: names }, null, 2)}\n`,
				deps,
				runId,
			),
		);
		for (const name of legacyOwned.legacy) {
			if (protectedSkillDirectories.has(name)) continue;
			staged.push(stageRemoval(resolve(pluginRoot, "skills", name)));
		}
		staged.push(stageRemoval(resolve(pluginRoot, ".codex-plugin")));
		staged.push(stageRemoval(resolve(pluginRoot, "codex")));

		publishStaged(staged, deps, runId);
	} catch (error) {
		primaryError = error;
		removeStagedArtifacts(staged, deps);
	}
	releaseCodexAssemblyLock(lockPath, deps);
	if (primaryError) throw primaryError;
}

// Assembles the Claude and Codex plugin roots except plugin/pfdsl/skills/pfdsl/SKILL.md, which embeds `pfdsl help` output and therefore needs packages/cli/dist — see scripts/gen-skill.mjs.
// None of this touches dist or spawns a child process, so scripts/pre-commit can drift-check it even when dist is missing/stale (#593, same split rationale as writeSkillRefs in #586).
// deps defaults to the real implementations; tests inject fakes to assert the wiring without touching the filesystem.
export function assemblePluginDistIndependent({
	root,
	pluginRoot,
	codexPluginRoot = resolve(root, "plugin/pfdsl-codex"),
	deps = {
		cpSync,
		genInstall,
		mirrorDir,
		mirrorFiles,
		writeSkillRefs,
		existsSync,
		readdirSync,
		readFileSync,
		renameSync,
		rmSync,
		writeFileSync,
		mkdirSync,
		writeBundleManifest,
		newRunId: randomUUID,
		assembleCodexAssets,
	},
}) {
	const runId = deps.newRunId?.() ?? randomUUID();
	const transaction = snapshotPluginGeneration(root, pluginRoot, deps, runId);
	let preserveTransaction = false;
	try {
		deps.genInstall(root);
		console.log(
			".claude/skills/pfd-ops/install ← repo-root sources (gen-install)",
		);

		for (const mirror of PLUGIN_MIRRORS) {
			if (mirror.whole) {
				// The source directory is copied entire, so its name is the bundle
				// root's name and the mirror runs from the repo root.
				deps.mirrorDir(mirror.dest, root, pluginRoot);
				console.log(`plugin/pfdsl/${mirror.dest} ← ${mirror.src}`);
			} else if (mirror.trees) {
				for (const name of mirror.trees) {
					deps.mirrorDir(
						name,
						resolve(root, mirror.src),
						resolve(pluginRoot, mirror.dest),
					);
					console.log(
						`plugin/pfdsl/${mirror.dest}/${name} ← ${mirror.src}/${name}`,
					);
				}
			} else {
				deps.mirrorFiles(
					mirror.files,
					resolve(root, mirror.src),
					resolve(pluginRoot, mirror.dest),
				);
				for (const file of mirror.files) {
					console.log(
						`plugin/pfdsl/${mirror.dest}/${file} ← ${mirror.src}/${file}`,
					);
				}
			}
		}

		const cliVersion = JSON.parse(
			deps.readFileSync(resolve(root, "packages/cli/package.json"), "utf-8"),
		).version;
		const manifest = buildPluginManifest({ cliVersion });
		const pluginManifestDir = resolve(pluginRoot, ".claude-plugin");
		deps.mkdirSync(pluginManifestDir, { recursive: true });
		deps.writeFileSync(
			resolve(pluginManifestDir, "plugin.json"),
			`${JSON.stringify(manifest, null, "\t")}\n`,
		);
		console.log(
			"plugin/pfdsl/.claude-plugin/plugin.json ← packages/cli/package.json version",
		);

		// The repo-root marketplace listing duplicates the per-plugin description
		// (a separate file so /plugin marketplace can list plugins without
		// fetching each one's own manifest) — keep it derived from the same bundle
		// contents as plugin.json instead of hand-edited, so it can't drift the
		// way it had (#685). Only the description is touched; $schema, the
		// marketplace-level description, owner, and the plugin's source (pinned
		// separately by scripts/lib/release-config.mjs at release time) pass
		// through unchanged.
		const marketplacePath = resolve(root, ".claude-plugin/marketplace.json");
		const marketplace = JSON.parse(deps.readFileSync(marketplacePath, "utf-8"));
		marketplace.plugins[0].description = manifest.description;
		deps.writeFileSync(
			marketplacePath,
			`${JSON.stringify(marketplace, null, "\t")}\n`,
		);
		console.log(
			".claude-plugin/marketplace.json ← plugin manifest description",
		);

		deps.writeSkillRefs(root, resolve(pluginRoot, "skills/pfdsl"));

		// Last inside the Claude root: the recorded hash covers every other file in the bundle.
		// Recording it before Codex assembly means a manifest failure rolls back this root before the other transaction begins.
		deps.writeBundleManifest(pluginRoot);
		console.log(
			`plugin/pfdsl/${BUNDLE_MANIFEST_RELATIVE_PATH} ← content hash of the assembled bundle`,
		);

		deps.assembleCodexAssets({ root, pluginRoot, codexPluginRoot, deps });
	} catch (error) {
		for (const [destination, snapshot] of [
			...transaction.snapshots,
		].reverse()) {
			if (!restoreAssemblySnapshot(destination, snapshot, deps)) {
				preserveTransaction = true;
			}
		}
		if (preserveTransaction && error && typeof error === "object") {
			error.rollbackBackup = transaction.transactionRoot;
			error.rollbackBackups = transaction.snapshots.map(
				([, snapshot]) => snapshot.backup,
			);
		}
		throw error;
	} finally {
		if (!preserveTransaction)
			removeAssemblyArtifact(transaction.transactionRoot, deps);
	}
}
