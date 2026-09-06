import {
	cpSync,
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { capabilitiesForTarget } from "./harness-capability-contract.mjs";
import {
	AGENT_EXCLUSIONS,
	LOCAL_CLAUDE_ROOT_ENTRIES,
	SKILL_EXCLUSIONS,
} from "./harness-inventory.mjs";
import { tryGit } from "./run-exec.mjs";

/**
 * Collect every file under `consumerPath` (a fixture directory copied from
 * `sourceRelativeRoot` in the source repo) paired with the path it came from,
 * relative to the source repo root — the form `git check-ignore` expects.
 *
 * `ownedRoots` holds every mapping's `consumerPath` in the current call to
 * `pruneGitIgnoredFixtureEntries`. A nested mapping (e.g.
 * `.claude/skills/pfdsl`, copied from `plugin/pfdsl/skills/pfdsl` rather than
 * from `.claude/skills/pfdsl`, which is a symlink in the source repo) owns
 * its own subtree; walking into it from an ancestor mapping would attribute
 * its files to the wrong source path, and `git check-ignore` refuses a
 * pathspec that reaches through a symlink.
 */
function collectFixtureEntries(
	consumerPath,
	sourceRelativeRoot,
	entries,
	ownedRoots,
	ownRoot,
) {
	if (!existsSync(consumerPath)) return;
	const stats = lstatSync(consumerPath);
	if (stats.isDirectory()) {
		for (const entry of readdirSync(consumerPath, { withFileTypes: true })) {
			const childPath = join(consumerPath, entry.name);
			if (childPath !== ownRoot && ownedRoots.has(childPath)) continue;
			collectFixtureEntries(
				childPath,
				join(sourceRelativeRoot, entry.name),
				entries,
				ownedRoots,
				ownRoot,
			);
		}
		return;
	}
	entries.push({ consumerPath, sourceRelativePath: sourceRelativeRoot });
}

/**
 * Remove fixture entries the source repo's Git ignores.
 *
 * `mappings` pairs each fixture path copied into the consumer tree with the
 * path it was copied from in `sourceRoot` — the two differ when a fixture
 * renames its copy (e.g. `plugin/pfdsl` -> `plugin`) or substitutes a
 * different source subtree for a symlink (see `collectFixtureEntries`).
 * Consumer fixtures are built by `cpSync`-ing the working tree whole, so
 * untracked-but-ignored files (a stray `.DS_Store`, an editor swap file)
 * ride along and read as undeclared output surfaces to the closure check.
 * `git check-ignore` is the source of truth here, not
 * `git ls-files -o -i --exclude-standard`, which misses ignored symlinks
 * such as `.claude/skills/pfdsl`.
 * @param {string} sourceRoot
 * @param {{sourceRelative: string, consumerPath: string}[]} mappings
 */
export function pruneGitIgnoredFixtureEntries(sourceRoot, mappings) {
	const ownedRoots = new Set(mappings.map(({ consumerPath }) => consumerPath));
	const entries = [];
	for (const { sourceRelative, consumerPath } of mappings) {
		collectFixtureEntries(
			consumerPath,
			sourceRelative,
			entries,
			ownedRoots,
			consumerPath,
		);
	}
	if (entries.length === 0) return;
	const result = tryGit(["check-ignore", "--stdin"], {
		cwd: sourceRoot,
		input: entries.map((entry) => entry.sourceRelativePath).join("\n"),
	});
	// `check-ignore` exits 1 when none of the paths are ignored — that is a
	// normal result, not a failure. Any other non-zero exit (e.g. `sourceRoot`
	// is not a Git repository) must not be swallowed as "nothing ignored".
	if (!result.ok && result.status !== 1) {
		throw new Error(`git check-ignore failed: ${result.out}`);
	}
	const ignored = new Set(result.out.split("\n").filter(Boolean));
	for (const entry of entries) {
		if (ignored.has(entry.sourceRelativePath)) {
			rmSync(entry.consumerPath, { force: true });
		}
	}
}

function copyClaudeRepositoryFixture(sourceRoot, consumerRoot) {
	cpSync(join(sourceRoot, "CLAUDE.md"), join(consumerRoot, "CLAUDE.md"));
	cpSync(join(sourceRoot, ".claude"), join(consumerRoot, ".claude"), {
		recursive: true,
		dereference: true,
	});
	// The copy above takes `.claude/` whole, so a maintainer's local entries ride
	// along into the fixture and read as undeclared output surfaces.
	for (const name of Object.keys(LOCAL_CLAUDE_ROOT_ENTRIES)) {
		rmSync(join(consumerRoot, ".claude", name), {
			recursive: true,
			force: true,
		});
	}
	rmSync(join(consumerRoot, ".claude/skills/pfdsl"), {
		recursive: true,
		force: true,
	});
	cpSync(
		join(sourceRoot, "plugin/pfdsl/skills/pfdsl"),
		join(consumerRoot, ".claude/skills/pfdsl"),
		{ recursive: true },
	);
	for (const skill of Object.keys(SKILL_EXCLUSIONS)) {
		rmSync(join(consumerRoot, ".claude/skills", skill), {
			recursive: true,
			force: true,
		});
	}
	for (const agent of Object.keys(AGENT_EXCLUSIONS)) {
		rmSync(join(consumerRoot, ".claude/agents", agent), {
			force: true,
		});
	}
	rmSync(join(consumerRoot, ".claude/pfd-ops-install-manifest.json"), {
		force: true,
	});
	// Runs last so it prunes the swapped-in .claude/skills/pfdsl (copied from
	// plugin/pfdsl/skills/pfdsl above) rather than the maintainer's local
	// symlink this fixture already replaced. The two mappings below tell
	// pruneGitIgnoredFixtureEntries about that swap so it attributes
	// .claude/skills/pfdsl's files to their real source.
	pruneGitIgnoredFixtureEntries(sourceRoot, [
		{ sourceRelative: ".claude", consumerPath: join(consumerRoot, ".claude") },
		{
			sourceRelative: "plugin/pfdsl/skills/pfdsl",
			consumerPath: join(consumerRoot, ".claude/skills/pfdsl"),
		},
	]);
}

function copyClaudePluginFixture(sourceRoot, consumerRoot) {
	cpSync(join(sourceRoot, "plugin/pfdsl"), join(consumerRoot, "plugin"), {
		recursive: true,
	});
	pruneGitIgnoredFixtureEntries(sourceRoot, [
		{
			sourceRelative: "plugin/pfdsl",
			consumerPath: join(consumerRoot, "plugin"),
		},
	]);
}

function copyCodexRepositoryFixture(sourceRoot, consumerRoot) {
	for (const relativePath of ["AGENTS.md", ".agents", ".codex"]) {
		cpSync(join(sourceRoot, relativePath), join(consumerRoot, relativePath), {
			recursive: true,
		});
	}
	pruneGitIgnoredFixtureEntries(
		sourceRoot,
		["AGENTS.md", ".agents", ".codex"].map((relativePath) => ({
			sourceRelative: relativePath,
			consumerPath: join(consumerRoot, relativePath),
		})),
	);
}

function copyCodexPluginFixture(sourceRoot, consumerRoot) {
	cpSync(join(sourceRoot, "plugin/pfdsl-codex"), join(consumerRoot, "plugin"), {
		recursive: true,
	});
	pruneGitIgnoredFixtureEntries(sourceRoot, [
		{
			sourceRelative: "plugin/pfdsl-codex",
			consumerPath: join(consumerRoot, "plugin"),
		},
	]);
}

function assertReadPathWithin(targetRoot, path, resolvePath) {
	const resolvedRoot = resolvePath(targetRoot);
	const resolvedPath = resolvePath(path);
	const rootPrefix = `${resolvedRoot.replace(/\/$/, "")}${sep}`;
	if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootPrefix)) {
		throw new Error(
			`consumer probe read outside target root: ${path} resolves to ${resolvedPath}`,
		);
	}
}

function readProbeTree(path, readPaths, targetRoot, resolvePath) {
	assertReadPathWithin(targetRoot, path, resolvePath);
	const linkStats = lstatSync(path);
	const stats = linkStats.isSymbolicLink() ? statSync(path) : linkStats;
	if (stats.isDirectory()) {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			readProbeTree(join(path, entry.name), readPaths, targetRoot, resolvePath);
		}
		return;
	}
	if (!stats.isFile()) throw new Error(`consumer probe expected file: ${path}`);
	readPaths.push(path);
	readFileSync(path, "utf-8");
}

function addObserved(observed, surface, capabilityId) {
	if (!observed.has(surface)) observed.set(surface, { surface, capabilityId });
}

function readManifestSurface(
	targetRoot,
	surface,
	capabilityId,
	readPaths,
	observed,
	resolvePath,
) {
	const [, manifestPath] = surface.match(/^manifest:(.+):([^:]+)$/);
	const path = join(targetRoot, manifestPath);
	assertReadPathWithin(targetRoot, path, resolvePath);
	readPaths.push(path);
	const manifest = JSON.parse(readFileSync(path, "utf-8"));
	for (const field of Object.keys(manifest)) {
		addObserved(observed, `manifest:${manifestPath}:${field}`, capabilityId);
	}
}

function probeMappingOutputs({
	targetRoot,
	mapping,
	capabilityId,
	readPaths,
	observed,
	directoryRoots,
	resolvePath,
}) {
	for (const surface of mapping.outputs) {
		if (surface.startsWith("manifest:")) {
			readManifestSurface(
				targetRoot,
				surface,
				capabilityId,
				readPaths,
				observed,
				resolvePath,
			);
			continue;
		}
		const path = join(targetRoot, surface);
		if (!existsSync(path)) continue;
		const stats = lstatSync(path);
		const resolvedStats = stats.isSymbolicLink() ? statSync(path) : stats;
		if (resolvedStats.isDirectory()) {
			readProbeTree(path, readPaths, targetRoot, resolvePath);
			addObserved(observed, surface, capabilityId);
			const siblings = directoryRoots.get(dirname(surface)) ?? [];
			for (const entry of readdirSync(join(targetRoot, dirname(surface)), {
				withFileTypes: true,
			})) {
				const siblingSurface = join(dirname(surface), entry.name);
				if (entry.name === "GENERATED.md") continue;
				const declared = siblings.find(
					({ surface: declaredSurface }) => declaredSurface === siblingSurface,
				);
				if (declared?.containerOnly) continue;
				addObserved(
					observed,
					siblingSurface,
					declared?.capabilityId ?? "consumer:unclassified",
				);
			}
			continue;
		}
		if (!resolvedStats.isFile()) {
			throw new Error(`consumer probe expected file: ${path}`);
		}
		assertReadPathWithin(targetRoot, path, resolvePath);
		readPaths.push(path);
		readFileSync(path, "utf-8");
		addObserved(observed, surface, capabilityId);
	}
}

export const PROBE_FIXTURES = Object.freeze({
	"claude-repository-consumer": Object.freeze({
		target: "claude-repository",
		forbidden: ["plugin", ".agents", ".codex"],
		prepare: copyClaudeRepositoryFixture,
		probe: probeMappingOutputs,
	}),
	"claude-plugin-consumer": Object.freeze({
		target: "claude-plugin",
		forbidden: [".claude", ".agents", ".codex", "AGENTS.md"],
		prepare: copyClaudePluginFixture,
		probe: probeMappingOutputs,
	}),
	"codex-repository-consumer": Object.freeze({
		target: "codex-repository",
		forbidden: [".claude", "plugin"],
		prepare: copyCodexRepositoryFixture,
		probe: probeMappingOutputs,
	}),
	"codex-plugin-consumer": Object.freeze({
		target: "codex-plugin",
		forbidden: [".claude", ".agents", ".codex", "AGENTS.md"],
		prepare: copyCodexPluginFixture,
		probe: probeMappingOutputs,
	}),
});

export function runTargetConsumerProbe(
	fixture,
	consumerRoot,
	capabilities,
	{ resolvePath = realpathSync } = {},
) {
	const { target } = fixture;
	const targetRoot =
		target === "claude-plugin" || target === "codex-plugin"
			? join(consumerRoot, "plugin")
			: consumerRoot;
	const readPaths = [];
	const observed = new Map();
	const directoryRoots = new Map();
	for (const record of capabilitiesForTarget(capabilities, target)) {
		if (record.mapping.disposition === "intentional-exclusion") continue;
		for (const surface of record.mapping.outputs) {
			if (surface.startsWith("manifest:")) {
				const [, manifestPath] = surface.match(/^manifest:(.+):([^:]+)$/);
				const container = dirname(manifestPath);
				const parent = dirname(container);
				const roots = directoryRoots.get(parent) ?? [];
				if (!roots.some(({ surface: candidate }) => candidate === container)) {
					roots.push({
						surface: container,
						capabilityId: record.id,
						containerOnly: true,
					});
				}
				directoryRoots.set(parent, roots);
				continue;
			}
			const parent = dirname(surface);
			let container = parent;
			while (container !== ".") {
				const containerParent = dirname(container);
				const containers = directoryRoots.get(containerParent) ?? [];
				if (
					!containers.some(({ surface: candidate }) => candidate === container)
				) {
					containers.push({
						surface: container,
						capabilityId: record.id,
						containerOnly: true,
					});
				}
				directoryRoots.set(containerParent, containers);
				container = containerParent;
			}
			const roots = directoryRoots.get(parent) ?? [];
			roots.push({ surface, capabilityId: record.id });
			directoryRoots.set(parent, roots);
		}
	}
	for (const record of capabilitiesForTarget(capabilities, target)) {
		if (record.mapping.disposition === "intentional-exclusion") continue;
		const probe = PROBE_FIXTURES[record.mapping.probe.kind];
		if (probe !== fixture) {
			throw new Error(
				`${record.id}: ${target} mapping references ${record.mapping.probe.kind} fixture for ${probe?.target ?? "missing"}`,
			);
		}
		probe.probe({
			targetRoot,
			mapping: record.mapping,
			capabilityId: record.id,
			readPaths,
			observed,
			directoryRoots,
			resolvePath,
		});
	}
	for (const [parent, declaredEntries] of directoryRoots) {
		const parentPath = join(targetRoot, parent);
		if (!existsSync(parentPath)) continue;
		assertReadPathWithin(targetRoot, parentPath, resolvePath);
		for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
			const surface = join(parent, entry.name);
			if (entry.name === "GENERATED.md") continue;
			const path = join(parentPath, entry.name);
			assertReadPathWithin(targetRoot, path, resolvePath);
			const declared = declaredEntries.find(
				({ surface: candidate }) => candidate === surface,
			);
			if (declared?.containerOnly) continue;
			addObserved(
				observed,
				surface,
				declared?.capabilityId ?? "consumer:unclassified",
			);
		}
	}
	return {
		observed: [...observed.values()],
		readPaths,
		targetRoot,
	};
}
