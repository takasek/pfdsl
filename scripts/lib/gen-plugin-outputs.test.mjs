import assert from "node:assert/strict";
import { relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";

import {
	ownedPluginOutputRoots,
	pluginGenerationSnapshotTargets,
} from "./gen-plugin.mjs";
import {
	GEN_INSTALL_OUTPUT,
	GEN_PLUGIN_OUTPUTS,
	GEN_SKILL_MD_OUTPUT,
	genPluginDriftPathspecs,
} from "./gen-plugin-outputs.mjs";

// Everything `node scripts/gen-plugin.mjs` rewrites, spelled out here rather
// than read back from the module so that dropping a surface from the contract
// fails this test instead of silently shrinking every consumer at once.
const EVERY_GEN_PLUGIN_OUTPUT = [
	"generated",
	"plugin",
	".claude-plugin/marketplace.json",
	"CLAUDE.md",
	"AGENTS.md",
	".agents",
	".codex",
	".claude/skills/pfd-ops/install",
];

const sorted = (paths) => [...paths].sort();

describe("gen-plugin output contract", () => {
	it("names every surface the generator rewrites", () => {
		assert.deepEqual(
			sorted(GEN_PLUGIN_OUTPUTS),
			sorted(EVERY_GEN_PLUGIN_OUTPUT),
		);
	});

	it("gives the terminal gate the whole contract, which has no earlier install or SKILL.md gate", () => {
		assert.deepEqual(
			sorted(genPluginDriftPathspecs("terminal")),
			sorted(EVERY_GEN_PLUGIN_OUTPUT),
		);
	});

	it("leaves install/ to the CI workflow that regenerates it with gen-install", () => {
		assert.deepEqual(
			sorted(genPluginDriftPathspecs("ci")),
			sorted(EVERY_GEN_PLUGIN_OUTPUT.filter((p) => p !== GEN_INSTALL_OUTPUT)),
		);
	});

	it("leaves install/ and SKILL.md to the pre-commit gates declared before the bulk", () => {
		assert.deepEqual(
			sorted(genPluginDriftPathspecs("pre-commit")),
			sorted([
				...EVERY_GEN_PLUGIN_OUTPUT.filter((p) => p !== GEN_INSTALL_OUTPUT),
				`:(exclude)${GEN_SKILL_MD_OUTPUT}`,
			]),
		);
	});

	it("rejects a consumer it does not know", () => {
		assert.throws(() => genPluginDriftPathspecs("release"), /release/);
	});

	it("covers exactly the destinations a failed generation restores", () => {
		const root = resolve("/repo");
		const targets = pluginGenerationSnapshotTargets(
			root,
			resolve(root, "plugin/pfdsl"),
			resolve(root, "plugin/pfdsl-codex"),
		).map(([destination]) => relative(root, destination).split(sep).join("/"));
		const within = (path, output) =>
			path === output || path.startsWith(`${output}/`);

		const uncovered = targets.filter(
			(target) => !GEN_PLUGIN_OUTPUTS.some((output) => within(target, output)),
		);
		assert.deepEqual(uncovered, [], "restored but never drift-checked");
		const unrestored = GEN_PLUGIN_OUTPUTS.filter(
			(output) => !targets.some((target) => within(target, output)),
		);
		assert.deepEqual(unrestored, [], "drift-checked but never restored");
	});

	it("restores every root a generation empties before rebuilding it", () => {
		const root = resolve("/repo");
		const pluginRoot = resolve(root, "plugin/pfdsl");
		const codexPluginRoot = resolve(root, "plugin/pfdsl-codex");
		const targets = pluginGenerationSnapshotTargets(
			root,
			pluginRoot,
			codexPluginRoot,
		).map(([destination]) => destination);

		const unrestored = ownedPluginOutputRoots(
			root,
			pluginRoot,
			codexPluginRoot,
		).filter(
			(owned) =>
				!targets.some(
					(target) => owned === target || owned.startsWith(`${target}${sep}`),
				),
		);
		assert.deepEqual(unrestored, [], "emptied but never restored");
	});
});
