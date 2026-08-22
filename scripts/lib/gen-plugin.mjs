import {
	cpSync,
	existsSync,
	mkdirSync,
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
import { genInstall } from "./gen-install.mjs";
import { writeSkillRefs } from "./gen-skill-refs.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The agents bundled into plugin/pfdsl/agents/, as .claude/agents/-relative
// filenames. Single source of truth: gen-plugin.mjs mirrors this list, and
// gen-plugin-trigger.mjs derives its drift-trigger alternation from it, so
// adding an agent cannot land in one place and be forgotten in the other.
export const PLUGIN_AGENT_FILES = ["pfd-lens.md", "pfd-implementer.md"];

// The skill trees mirrored into plugin/pfdsl/skills/ from .claude/skills/, and
// the commands mirrored into plugin/pfdsl/commands/. Named here for the same
// reason as PLUGIN_AGENT_FILES: assemblePluginDistIndependent bundles exactly
// these, and scripts/lib/distribution-review.mjs maps a bundled file back to
// the source a reviewer edits, so the two cannot disagree about what ships.
// The pfdsl skill is absent because it is rendered, not mirrored (gen-skill).
export const PLUGIN_SKILL_DIRS = [
	"pfd-grill",
	"pfd-ops",
	"pfd-retro",
	"pfd-ecosystem",
];
export const PLUGIN_COMMAND_FILES = [
	"pfd-cycle.md",
	"pfd-init.md",
	"pfd-retro.md",
];

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
export const PLUGIN_MIRRORS = [
	{ dest: "skills", src: ".claude/skills", trees: PLUGIN_SKILL_DIRS },
	{ dest: "commands", src: ".claude/commands", files: PLUGIN_COMMAND_FILES },
	{ dest: "agents", src: ".claude/agents", files: PLUGIN_AGENT_FILES },
	{ dest: "hooks", src: "hooks", whole: true },
];

// Agents that stay out of the bundle, with why — an adopting repo gets the
// pfd-* ones because they operate on the .pfdsl files it now has, and nothing
// else. Named rather than merely absent so a drift test can require every file
// in .claude/agents/ to be either bundled or listed here (#613).
export const PLUGIN_AGENT_EXCLUSIONS = {
	"ci-triage.md": "reads this repo's GitHub Actions logs",
	"issue-worker.md": "encodes this repo's worktree and PR conventions",
	"local-check-triage.md": "triages this repo's make/pre-commit/test failures",
	"vscode-ext-debugger.md": "debugs the extension this repo builds",
};

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

// Assembles everything gen-plugin.mjs bundles into plugin/pfdsl/ except
// plugin/pfdsl/skills/pfdsl/SKILL.md (which embeds `pfdsl help` output and
// therefore needs packages/cli/dist — see scripts/gen-skill.mjs). None of
// this touches dist or spawns a child process, so scripts/pre-commit can
// drift-check it even when dist is missing/stale (#593, same split
// rationale as writeSkillRefs in #586). deps defaults to the real
// implementations; tests inject fakes to assert the wiring without touching
// the filesystem.
export function assemblePluginDistIndependent({
	root,
	pluginRoot,
	deps = {
		genInstall,
		mirrorDir,
		mirrorFiles,
		writeSkillRefs,
		readFileSync,
		writeFileSync,
		mkdirSync,
		writeBundleManifest,
	},
}) {
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
	console.log(".claude-plugin/marketplace.json ← plugin manifest description");

	deps.writeSkillRefs(root, resolve(pluginRoot, "skills/pfdsl"));

	// Last: the recorded hash covers every other file in the bundle, so anything
	// written after this point would leave it describing a bundle that is no
	// longer on disk. The manifest excludes itself, which is what keeps a second
	// run byte-identical (and the gen-plugin-bulk drift gate green).
	deps.writeBundleManifest(pluginRoot);
	console.log(
		`plugin/pfdsl/${BUNDLE_MANIFEST_RELATIVE_PATH} ← content hash of the assembled bundle`,
	);
}
