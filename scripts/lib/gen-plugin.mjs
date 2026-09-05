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

import {
	BUNDLE_MANIFEST_RELATIVE_PATH,
	writeBundleManifest,
} from "./bundle-manifest.mjs";
import { canonicalPluginSkillSource } from "./distribution-sources.mjs";
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
import { genInstall } from "./gen-install.mjs";
import { writeSkillRefs } from "./gen-skill-refs.mjs";
import {
	assertTargetOutputClosure,
	capabilitiesForTarget,
	validateCapabilityContract,
} from "./harness-capability-contract.mjs";
import {
	AGENT_EXCLUSIONS,
	CLAUDE_PLUGIN_MIRRORS,
	DISTRIBUTED_AGENTS,
	DISTRIBUTED_COMMANDS,
	DISTRIBUTED_SKILLS,
	GENERATED_SKILLS,
} from "./harness-inventory.mjs";
import { decodeHarnessSources } from "./harness-source-decoder.mjs";

const CODEX_ASSEMBLY_LOCK_DIRECTORY = ".codex-assets-assembly.lock";
const CODEX_COMMAND_SKILLS_MANIFEST = "codex-command-skills.json";
const CODEX_SKILLS_ROOT = "skills";
const CODEX_REPOSITORY_DESTINATIONS = Object.freeze([
	["AGENTS.md", "agents.md"],
	[".codex/config.toml", "codex-config.toml"],
	[".codex/hooks.json", "codex-hooks.json"],
	[".codex/GENERATED.md", "codex-generated.md"],
	[".agents/skills", "agent-skills"],
	[".codex/agents", "codex-agents"],
]);
const HARNESS_PROBE_KINDS = new Set([
	"claude-repository-consumer",
	"claude-plugin-consumer",
	"codex-repository-consumer",
	"codex-plugin-consumer",
]);

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

function decodeHarnessCapabilities({ root }) {
	return validateCapabilityContract(decodeHarnessSources({ root }), {
		probeKinds: HARNESS_PROBE_KINDS,
	});
}

function capabilityRecord(capabilities, id) {
	const record = capabilities.find((capability) => capability.id === id);
	if (!record) throw new Error(`missing harness capability ${id}`);
	return record;
}

function targetCapabilityRecord(capabilities, target, id) {
	const record = capabilitiesForTarget(capabilities, target).find(
		(capability) => capability.id === id,
	);
	if (!record) throw new Error(`missing harness capability ${id}`);
	return record;
}

function targetOutputEntries(capabilities, target) {
	return capabilitiesForTarget(capabilities, target).flatMap(
		({ id, mapping }) =>
			mapping.disposition === "intentional-exclusion"
				? []
				: mapping.outputs.map((surface) => ({
						surface,
						capabilityId: id,
					})),
	);
}

function addConcreteAdapterWrites({
	actualWrites,
	capabilities,
	root,
	pluginRoot,
	codexPluginRoot,
	observedByTarget,
}) {
	const roots = [
		["codex-plugin", codexPluginRoot],
		["claude-plugin", pluginRoot],
		["codex-repository", root],
	];
	for (const path of actualWrites) {
		if (path.includes(".codex-tmp-") || path.includes(".codex-prev-")) continue;
		let target;
		let targetRoot;
		for (const [candidate, candidateRoot] of roots) {
			if (path === candidateRoot || path.startsWith(`${candidateRoot}/`)) {
				target = candidate;
				targetRoot = candidateRoot;
				break;
			}
		}
		if (!target) continue;
		const surface = path.slice(targetRoot.length).replace(/^\//, "");
		if (!surface) continue;
		if (target === "codex-repository") {
			if (
				!surface.startsWith(".codex/") &&
				!surface.startsWith(".agents/") &&
				surface !== "AGENTS.md"
			) {
				continue;
			}
		}
		if (
			[
				".codex/GENERATED.md",
				".codex-plugin/codex-command-skills.json",
				BUNDLE_MANIFEST_RELATIVE_PATH,
				"GENERATED.md",
			].includes(surface)
		) {
			continue;
		}
		const declared = targetOutputEntries(capabilities, target);
		const owner = declared.find(({ surface: declaredSurface }) => {
			if (declaredSurface.startsWith("manifest:")) {
				const manifestPath = declaredSurface.split(":")[1];
				return (
					manifestPath === surface || manifestPath.startsWith(`${surface}/`)
				);
			}
			return (
				surface === declaredSurface ||
				surface.startsWith(`${declaredSurface}/`) ||
				declaredSurface.startsWith(`${surface}/`)
			);
		});
		if (!owner) {
			observedByTarget[target].push({
				surface,
				capabilityId: "adapter:unclassified",
			});
		}
	}
}

function observeRecordOutputs(observed, record) {
	if (record.mapping.disposition === "intentional-exclusion") return;
	for (const surface of record.mapping.outputs) {
		observed.push({ surface, capabilityId: record.id });
	}
}

function observeManifestFields(observed, record, path, manifest) {
	for (const field of Object.keys(manifest)) {
		observed.push({
			surface: `manifest:${path}:${field}`,
			capabilityId: record.id,
		});
	}
}

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

// Builds both plugin manifest descriptions solely from the frozen semantic
// records produced by the decoder. Adapters never reopen a maintained source.
export function buildPluginDescription({ capabilities }) {
	if (!Array.isArray(capabilities)) {
		throw new TypeError("plugin description capabilities must be an array.");
	}
	const records = capabilitiesForTarget(capabilities, "claude-plugin").filter(
		({ kind, mapping }) =>
			(kind === "skill" || kind === "command") &&
			mapping.disposition !== "intentional-exclusion",
	);
	const expectedIds = [
		...["pfdsl", ...PLUGIN_SKILL_DIRS].map((name) => `skill:${name}`),
		...PLUGIN_COMMAND_FILES.map(
			(file) => `command:${file.replace(/\.md$/, "")}`,
		),
	];
	const recordsById = new Map(records.map((record) => [record.id, record]));
	for (const id of expectedIds) {
		if (!recordsById.has(id)) {
			throw new Error(`missing decoded plugin description record ${id}`);
		}
	}
	for (const { id } of records) {
		if (!expectedIds.includes(id)) {
			throw new Error(`unexpected decoded plugin description record ${id}`);
		}
	}
	const orderedRecords = expectedIds.map((id) => recordsById.get(id));
	const skillParts = orderedRecords
		.filter(({ kind }) => kind === "skill")
		.map((record) => {
			if (
				typeof record.semantic?.summary !== "string" ||
				!record.semantic.summary.trim()
			) {
				throw new Error(`${record.id}: missing decoded skill summary.`);
			}
			return `${record.semantic.summary} (${record.id.slice("skill:".length)} skill)`;
		});
	const commandParts = orderedRecords
		.filter(({ kind }) => kind === "command")
		.map(({ id }) => `/${id.slice("command:".length)}`);
	return `PFD-DSL authoring toolkit: ${skillParts.join(", ")}, and ${commandParts.join(", ")} commands.`;
}

// Builds the Claude Code plugin manifest object for .claude-plugin/plugin.json.
// Identity and version are derived from the decoded plugin metadata record, so sibling harness manifests cannot split when a source file changes mid-run.
// description is derived from the actual bundle contents (buildPluginDescription)
// so it can't drift from what plugin/pfdsl/ ships. Used by scripts/gen-plugin.mjs.

export function buildPluginManifest({ record, description }) {
	const semantic = record?.semantic;
	if (!semantic || Array.isArray(semantic) || typeof semantic !== "object") {
		throw new Error("plugin metadata semantic record must be an object.");
	}
	const identity = semantic.identity;
	if (!identity || Array.isArray(identity) || typeof identity !== "object") {
		throw new Error("plugin metadata identity must be an object.");
	}
	if (typeof semantic.version !== "string" || !semantic.version.trim()) {
		throw new Error("plugin metadata version must be a non-empty string.");
	}
	return {
		name: identity.name,
		description,
		version: semantic.version,
		author: identity.author,
		homepage: identity.homepage,
		license: identity.license,
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

function isPfdOpsInstallPath(relative) {
	return (
		relative === "pfd-ops/install" || relative.startsWith("pfd-ops/install/")
	);
}

function normalizeCodexMarkdownTree(
	directory,
	canonicalSource,
	deps,
	relative = "",
	skipPfdOpsInstall = false,
) {
	if (!deps.readdirSync) return;
	for (const entry of deps.readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		const sourcePath = relative ? `${relative}/${entry.name}` : entry.name;
		if (skipPfdOpsInstall && isPfdOpsInstallPath(sourcePath)) continue;
		if (entry.isDirectory()) {
			normalizeCodexMarkdownTree(
				path,
				canonicalSource,
				deps,
				sourcePath,
				skipPfdOpsInstall,
			);
			continue;
		}
		if (!entry.isFile() || !path.endsWith(".md")) continue;
		const source = deps.readFileSync(path, "utf-8");
		const normalized = addGeneratedMarkdownNotice(
			claudeInstructionsToAgents(source).replace(/(?:\r?\n){2,}$/, "\n"),
			canonicalSource(sourcePath),
		);
		if (normalized !== source) deps.writeFileSync(path, normalized);
	}
}

function normalizeCodexJavascriptTree(
	directory,
	canonicalSource,
	deps,
	relative = "",
	skipPfdOpsInstall = false,
) {
	if (!deps.readdirSync) return;
	for (const entry of deps.readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		const sourcePath = relative ? `${relative}/${entry.name}` : entry.name;
		if (skipPfdOpsInstall && isPfdOpsInstallPath(sourcePath)) continue;
		if (entry.isDirectory()) {
			normalizeCodexJavascriptTree(
				path,
				canonicalSource,
				deps,
				sourcePath,
				skipPfdOpsInstall,
			);
			continue;
		}
		if (!entry.isFile() || !path.endsWith(".mjs")) continue;
		const source = deps.readFileSync(path, "utf-8");
		const normalized = addGeneratedSourceComment(
			source,
			canonicalSource(sourcePath),
		);
		if (normalized !== source) deps.writeFileSync(path, normalized);
	}
}

function stageTargetSkillTree({
	root,
	capabilities,
	target,
	destination,
	skillRoot,
	deps,
	runId,
}) {
	const temporary = temporaryAssemblySibling(destination, "tmp", runId);
	const observed = [];
	try {
		deps.rmSync(temporary, { recursive: true, force: true });
		deps.mkdirSync(temporary, { recursive: true });
		for (const record of capabilitiesForTarget(capabilities, target)) {
			if (
				record.mapping.disposition === "intentional-exclusion" ||
				(record.kind !== "skill" && record.kind !== "command")
			)
				continue;
			const [surface] = record.mapping.outputs;
			if (!surface.startsWith(`${skillRoot}/`)) {
				throw new Error(
					`${record.id}: invalid ${target} skill surface ${surface}`,
				);
			}
			const output = resolve(temporary, surface.slice(skillRoot.length + 1));
			if (record.kind === "skill") {
				const source = resolve(
					root,
					record.source.generated?.target ?? record.source.path,
				);
				deps.cpSync(source, output, {
					recursive: true,
					filter: excludeSkillRootClaudeMd(source),
				});
				observeRecordOutputs(observed, record);
				continue;
			}
			deps.mkdirSync(output, { recursive: true });
			deps.writeFileSync(
				resolve(output, "SKILL.md"),
				commandCapabilityToCodexSkill(record, basename(output)),
			);
			observeRecordOutputs(observed, record);
		}
		normalizeCodexMarkdownTree(
			temporary,
			canonicalPluginSkillSource,
			deps,
			"",
			true,
		);
		normalizeCodexJavascriptTree(
			temporary,
			canonicalPluginSkillSource,
			deps,
			"",
			true,
		);
	} catch (error) {
		removeAssemblyArtifact(temporary, deps);
		throw error;
	}
	return { destination, temporary, observed };
}

function stageCodexPluginHooks(root, codexPluginRoot, record, deps, runId) {
	const destination = resolve(codexPluginRoot, "hooks");
	const temporary = temporaryAssemblySibling(destination, "tmp", runId);
	try {
		deps.rmSync(temporary, { recursive: true, force: true });
		deps.cpSync(resolve(root, "hooks"), temporary, { recursive: true });
		normalizeCodexJavascriptTree(
			temporary,
			(relativePath) => `hooks/${relativePath}`,
			deps,
		);
	} catch (error) {
		removeAssemblyArtifact(temporary, deps);
		throw error;
	}
	const observed = [];
	observeRecordOutputs(observed, record);
	return { destination, temporary, observed };
}

// Cleanup is best effort because an I/O error while removing a temporary
// sibling must not replace the staging or publication error that triggered it.
function removeAssemblyArtifact(path, deps) {
	try {
		deps.rmSync(path, { recursive: true, force: true });
		return true;
	} catch {
		// Preserve the primary assembly error.
		return false;
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

function snapshotPluginGeneration(
	root,
	pluginRoot,
	codexPluginRoot,
	deps,
	runId,
) {
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
				codexPluginRoot,
				snapshotAssemblyDestination(
					codexPluginRoot,
					resolve(transactionRoot, "codex-plugin-root"),
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
			...CODEX_REPOSITORY_DESTINATIONS.map(([destination, backup]) => [
				resolve(root, destination),
				snapshotAssemblyDestination(
					resolve(root, destination),
					resolve(transactionRoot, backup),
					deps,
				),
			]),
			[
				resolve(root, GENERATED_SKILLS.pfdsl.target),
				snapshotAssemblyDestination(
					resolve(root, GENERATED_SKILLS.pfdsl.target),
					resolve(transactionRoot, "generated-pfdsl-skill"),
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

function releaseCodexAssemblyLock(lockPath, deps, runId) {
	if (removeAssemblyArtifact(lockPath, deps)) return;
	const stalePath = `${lockPath}.stale-${runId}`;
	try {
		deps.renameSync(lockPath, stalePath);
		console.warn(
			`Codex assembly lock cleanup failed; quarantined recovery path: ${stalePath}`,
		);
	} catch {
		console.warn(
			`Codex assembly lock cleanup failed; recovery path: ${lockPath}`,
		);
	}
}

function commandSkillManifestPath(pluginRoot) {
	return resolve(pluginRoot, ".codex-plugin", CODEX_COMMAND_SKILLS_MANIFEST);
}

function repositoryCodexOwnershipGuide() {
	return [
		"<!-- DO NOT EDIT. Authoritative source: scripts/lib/gen-plugin.mjs. -->",
		"",
		"# Generated Codex assets",
		"",
		"This directory is generated by `scripts/gen-codex-assets.mjs`.",
		"`hooks.json` is JSON and cannot contain comments. Its authoritative source is `.claude/settings.json`.",
		"",
	].join("\n");
}

function pluginCodexOwnershipGuide() {
	return [
		"<!-- DO NOT EDIT. Authoritative source: scripts/lib/gen-plugin.mjs. -->",
		"",
		"# Generated Codex plugin assets",
		"",
		"This directory is generated by `scripts/gen-plugin.mjs`.",
		"`.codex-plugin/plugin.json` is JSON and cannot contain comments. Its authoritative source is `scripts/lib/gen-plugin.mjs`.",
		"`.codex-plugin/codex-command-skills.json` is JSON and cannot contain comments. Its authoritative source is `scripts/lib/gen-plugin.mjs`.",
		"`hooks/hooks.json` is JSON and cannot contain comments. Its authoritative source is `hooks/hooks.json`.",
		"",
	].join("\n");
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

function legacyClaudeCleanupDestinations(
	pluginRoot,
	legacyOwnedNames,
	protectedSkillDirectories,
) {
	return [
		...legacyOwnedNames
			.filter((name) => !protectedSkillDirectories.has(name))
			.map((name) => resolve(pluginRoot, "skills", name)),
		resolve(pluginRoot, ".codex-plugin"),
		resolve(pluginRoot, "codex"),
	];
}

/**
 * Generates the Codex repository and plugin assets from the maintained
 * Claude sources. Each output is first written to a temporary sibling; only
 * after every write succeeds are the destinations replaced together.
 * @param {{root: string, codexPluginRoot?: string, capabilities?: object[], deps?: object}} options
 */
export function assembleCodexAssets({
	root,
	codexPluginRoot = resolve(root, "plugin/pfdsl-codex"),
	capabilities: suppliedCapabilities,
	deps = {
		cpSync,
		decodeHarnessCapabilities,
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
	const runId = deps.newRunId?.() ?? randomUUID();
	const lockPath = acquireCodexAssemblyLock(root, deps);
	let primaryError;
	let observed;
	try {
		const capabilities =
			suppliedCapabilities ?? deps.decodeHarnessCapabilities({ root });
		observed = {
			"codex-repository": [],
			"codex-plugin": [],
		};
		const metadata = capabilityRecord(capabilities, "plugin-metadata");
		const repositoryInstructions = targetCapabilityRecord(
			capabilities,
			"codex-repository",
			"repository-instructions",
		);
		const repositoryHooks = targetCapabilityRecord(
			capabilities,
			"codex-repository",
			"repository-hooks",
		);
		const pluginHooks = targetCapabilityRecord(
			capabilities,
			"codex-plugin",
			"plugin-hooks",
		);
		const pluginMetadata = capabilitiesForTarget(
			capabilities,
			"codex-plugin",
		).find((record) => record.id === "plugin-metadata");
		const codexPluginManifest = buildCodexPluginManifest({
			record: metadata,
			mapping: pluginMetadata.mapping,
			description: buildPluginDescription({ capabilities }),
		});
		readOwnedCommandSkillDirectories(codexPluginRoot, deps);
		staged.push(
			stageFile(
				resolve(root, "AGENTS.md"),
				claudeRootInstructionsToAgents(repositoryInstructions.semantic.body),
				deps,
				runId,
			),
		);
		observeRecordOutputs(observed["codex-repository"], repositoryInstructions);
		staged.push(
			stageFile(
				resolve(root, ".codex/config.toml"),
				buildCodexProjectConfig(),
				deps,
				runId,
			),
		);
		staged.push(
			stageFile(
				resolve(root, ".codex/hooks.json"),
				hookCapabilityToCodexHooks(repositoryHooks),
				deps,
				runId,
			),
		);
		observeRecordOutputs(observed["codex-repository"], repositoryHooks);
		staged.push(
			stageFile(
				resolve(root, ".codex/GENERATED.md"),
				repositoryCodexOwnershipGuide(),
				deps,
				runId,
			),
		);
		staged.push(
			stageFile(
				resolve(codexPluginRoot, ".codex-plugin/plugin.json"),
				`${JSON.stringify(codexPluginManifest, null, 2)}\n`,
				deps,
				runId,
			),
		);
		observeManifestFields(
			observed["codex-plugin"],
			metadata,
			".codex-plugin/plugin.json",
			codexPluginManifest,
		);
		staged.push(
			stageFile(
				resolve(codexPluginRoot, "GENERATED.md"),
				pluginCodexOwnershipGuide(),
				deps,
				runId,
			),
		);
		const repositorySkills = stageTargetSkillTree({
			root,
			capabilities,
			target: "codex-repository",
			destination: resolve(root, ".agents/skills"),
			skillRoot: ".agents/skills",
			deps,
			runId,
		});
		staged.push(repositorySkills);
		observed["codex-repository"].push(...repositorySkills.observed);
		const pluginSkills = stageTargetSkillTree({
			root,
			capabilities,
			target: "codex-plugin",
			destination: resolve(codexPluginRoot, CODEX_SKILLS_ROOT),
			skillRoot: CODEX_SKILLS_ROOT,
			deps,
			runId,
		});
		staged.push(pluginSkills);
		observed["codex-plugin"].push(...pluginSkills.observed);
		const pluginHookStage = stageCodexPluginHooks(
			root,
			codexPluginRoot,
			pluginHooks,
			deps,
			runId,
		);
		staged.push(pluginHookStage);
		observed["codex-plugin"].push(...pluginHookStage.observed);
		const agents = capabilitiesForTarget(
			capabilities,
			"codex-repository",
		).filter((record) => record.kind === "agent");
		staged.push(
			stageDirectory(
				resolve(root, ".codex/agents"),
				agents.map((record) => ({
					path: record.mapping.outputs[0].replace(".codex/agents/", ""),
					content: agentCapabilityToCodexToml(record),
				})),
				deps,
				runId,
			),
		);
		for (const record of agents) {
			observeRecordOutputs(observed["codex-repository"], record);
		}
		staged.push(
			stageFile(
				commandSkillManifestPath(codexPluginRoot),
				`${JSON.stringify(
					{
						skillRoot: CODEX_SKILLS_ROOT,
						ownedSkillDirectories: capabilitiesForTarget(
							capabilities,
							"codex-plugin",
						)
							.filter((record) => record.kind === "command")
							.map((record) =>
								record.mapping.outputs[0].slice("skills/".length),
							),
					},
					null,
					2,
				)}\n`,
				deps,
				runId,
			),
		);
		publishStaged(staged, deps, runId);
	} catch (error) {
		primaryError = error;
		removeStagedArtifacts(staged, deps);
	}
	releaseCodexAssemblyLock(lockPath, deps, runId);
	if (primaryError) throw primaryError;
	return { observed };
}

export function assembleClaudeAssets({ root, pluginRoot, capabilities, deps }) {
	const observed = {
		"claude-repository": [],
		"claude-plugin": [],
	};
	for (const record of capabilitiesForTarget(
		capabilities,
		"claude-repository",
	)) {
		if (record.mapping.disposition !== "intentional-exclusion") {
			observed["claude-repository"].push({
				surface: record.source.path,
				capabilityId: record.id,
			});
		}
	}
	deps.genInstall(root);
	console.log(
		".claude/skills/pfd-ops/install ← repo-root sources (gen-install)",
	);

	for (const mirror of PLUGIN_MIRRORS) {
		if (mirror.whole) {
			// The source directory is copied entire, so its name is the bundle
			// root's name and the mirror runs from the repo root.
			deps.mirrorDir(mirror.dest, root, pluginRoot);
			observeRecordOutputs(
				observed["claude-plugin"],
				targetCapabilityRecord(capabilities, "claude-plugin", "plugin-hooks"),
			);
			console.log(`plugin/pfdsl/${mirror.dest} ← ${mirror.src}`);
		} else if (mirror.trees) {
			for (const name of mirror.trees) {
				deps.mirrorDir(
					name,
					resolve(root, mirror.src),
					resolve(pluginRoot, mirror.dest),
				);
				observeRecordOutputs(
					observed["claude-plugin"],
					targetCapabilityRecord(
						capabilities,
						"claude-plugin",
						`skill:${name}`,
					),
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
				const kind = mirror.dest === "commands" ? "command" : "agent";
				observeRecordOutputs(
					observed["claude-plugin"],
					targetCapabilityRecord(
						capabilities,
						"claude-plugin",
						`${kind}:${file.replace(/\.md$/, "")}`,
					),
				);
				console.log(
					`plugin/pfdsl/${mirror.dest}/${file} ← ${mirror.src}/${file}`,
				);
			}
		}
	}

	const metadata = capabilityRecord(capabilities, "plugin-metadata");
	const manifest = buildPluginManifest({
		record: metadata,
		description: buildPluginDescription({ capabilities }),
	});
	const pluginManifestDir = resolve(pluginRoot, ".claude-plugin");
	deps.mkdirSync(pluginManifestDir, { recursive: true });
	deps.writeFileSync(
		resolve(pluginManifestDir, "plugin.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	observeManifestFields(
		observed["claude-plugin"],
		metadata,
		".claude-plugin/plugin.json",
		manifest,
	);
	console.log(
		"plugin/pfdsl/.claude-plugin/plugin.json ← decoded plugin metadata",
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
	console.log(".claude-plugin/marketplace.json ← plugin manifest description");

	const generatedPfdslSkill = resolve(
		root,
		targetCapabilityRecord(capabilities, "claude-plugin", "skill:pfdsl").source
			.generated.target,
	);
	deps.writeSkillRefs(root, generatedPfdslSkill);
	deps.mirrorDir(
		"pfdsl",
		dirname(generatedPfdslSkill),
		resolve(pluginRoot, "skills"),
	);
	observeRecordOutputs(
		observed["claude-plugin"],
		targetCapabilityRecord(capabilities, "claude-plugin", "skill:pfdsl"),
	);
	const legacyOwned = readOwnedCommandSkillDirectories(pluginRoot, deps);
	const protectedSkillDirectories = new Set([
		...DISTRIBUTED_SKILLS,
		...Object.keys(GENERATED_SKILLS),
	]);
	for (const destination of legacyClaudeCleanupDestinations(
		pluginRoot,
		legacyOwned.legacy,
		protectedSkillDirectories,
	)) {
		deps.rmSync(destination, { recursive: true, force: true });
	}

	// Last inside the Claude root: the recorded hash covers every other file in the bundle.
	// Recording it before Codex assembly means a manifest failure rolls back this root before the other transaction begins.
	deps.writeBundleManifest(pluginRoot);
	console.log(
		`plugin/pfdsl/${BUNDLE_MANIFEST_RELATIVE_PATH} ← content hash of the assembled bundle`,
	);
	return {
		observed,
	};
}

// Assembles the Claude and Codex plugin roots from the generated pfdsl skill tree, whose SKILL.md embeds `pfdsl help` output and therefore needs packages/cli/dist — see scripts/gen-skill.mjs.
// None of this touches dist or spawns a child process, so scripts/pre-commit can drift-check it even when dist is missing/stale (#593, same split rationale as writeSkillRefs in #586).
// deps defaults to the real implementations; tests inject fakes to assert the wiring without touching the filesystem.
export function assemblePluginDistIndependent({
	root,
	pluginRoot,
	codexPluginRoot = resolve(root, "plugin/pfdsl-codex"),
	deps = {
		cpSync,
		decodeHarnessCapabilities,
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
		assembleClaudeAssets,
	},
}) {
	const runId = deps.newRunId?.() ?? randomUUID();
	const transaction = snapshotPluginGeneration(
		root,
		pluginRoot,
		codexPluginRoot,
		deps,
		runId,
	);
	let preserveTransaction = false;
	try {
		const actualWrites = new Set();
		const trackedDeps = {
			...deps,
			genInstall(installRoot, ...args) {
				actualWrites.add(
					resolve(installRoot, ".claude/skills/pfd-ops/install"),
				);
				return deps.genInstall(installRoot, ...args);
			},
			mkdirSync(path, ...args) {
				actualWrites.add(path);
				return deps.mkdirSync(path, ...args);
			},
			mirrorDir(name, sourceRoot, destinationRoot, ...args) {
				actualWrites.add(resolve(destinationRoot, name));
				return deps.mirrorDir(name, sourceRoot, destinationRoot, ...args);
			},
			mirrorFiles(names, sourceRoot, destinationRoot, ...args) {
				for (const name of names) {
					actualWrites.add(resolve(destinationRoot, name));
				}
				return deps.mirrorFiles(names, sourceRoot, destinationRoot, ...args);
			},
			renameSync(from, to, ...args) {
				actualWrites.add(to);
				return deps.renameSync(from, to, ...args);
			},
			writeBundleManifest(bundleRoot, ...args) {
				actualWrites.add(resolve(bundleRoot, BUNDLE_MANIFEST_RELATIVE_PATH));
				return deps.writeBundleManifest(bundleRoot, ...args);
			},
			writeFileSync(path, ...args) {
				actualWrites.add(path);
				return deps.writeFileSync(path, ...args);
			},
			writeSkillRefs(skillRoot, outputRoot, ...args) {
				actualWrites.add(outputRoot);
				return deps.writeSkillRefs(skillRoot, outputRoot, ...args);
			},
			cpSync(from, to, ...args) {
				actualWrites.add(to);
				return deps.cpSync(from, to, ...args);
			},
		};
		const capabilities = (
			deps.decodeHarnessCapabilities ?? decodeHarnessCapabilities
		)({
			root,
		});
		const assertClosure =
			deps.assertTargetOutputClosure ?? assertTargetOutputClosure;
		const claude = (deps.assembleClaudeAssets ?? assembleClaudeAssets)({
			root,
			pluginRoot,
			capabilities,
			deps: trackedDeps,
		});
		const codex = deps.assembleCodexAssets({
			root,
			codexPluginRoot,
			capabilities,
			deps: trackedDeps,
		});
		const observedByTarget = {
			...claude.observed,
			...codex.observed,
		};
		addConcreteAdapterWrites({
			actualWrites,
			capabilities,
			root,
			pluginRoot,
			codexPluginRoot,
			observedByTarget,
		});
		for (const [target, observed] of Object.entries(observedByTarget)) {
			assertClosure({
				target,
				declared: targetOutputEntries(capabilities, target),
				observed,
			});
		}
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
