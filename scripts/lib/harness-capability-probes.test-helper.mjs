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
import { AGENT_EXCLUSIONS, SKILL_EXCLUSIONS } from "./harness-inventory.mjs";

function copyClaudeRepositoryFixture(sourceRoot, consumerRoot) {
	cpSync(join(sourceRoot, "CLAUDE.md"), join(consumerRoot, "CLAUDE.md"));
	cpSync(join(sourceRoot, ".claude"), join(consumerRoot, ".claude"), {
		recursive: true,
		dereference: true,
	});
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
}

function copyClaudePluginFixture(sourceRoot, consumerRoot) {
	cpSync(join(sourceRoot, "plugin/pfdsl"), join(consumerRoot, "plugin"), {
		recursive: true,
	});
}

function copyCodexRepositoryFixture(sourceRoot, consumerRoot) {
	for (const relativePath of ["AGENTS.md", ".agents", ".codex"]) {
		cpSync(join(sourceRoot, relativePath), join(consumerRoot, relativePath), {
			recursive: true,
		});
	}
}

function copyCodexPluginFixture(sourceRoot, consumerRoot) {
	cpSync(join(sourceRoot, "plugin/pfdsl-codex"), join(consumerRoot, "plugin"), {
		recursive: true,
	});
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
