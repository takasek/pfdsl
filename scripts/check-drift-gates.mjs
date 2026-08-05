#!/usr/bin/env node
/**
 * check-drift-gates.mjs
 *
 * The pre-commit checks of the form "regenerate the derived output, fail if it
 * changed". Reports every stale one in a single pass, so clearing two of them
 * costs one commit attempt rather than two (takasek/pfdsl#755).
 *
 * The gates live here rather than in scripts/pre-commit because the sh version
 * passed each check to `eval` as a command line — the one place in this repo
 * where check logic sat outside scripts/lib and its tests. Commands are named
 * as executable + argv (scripts/check-no-shell-strings.mjs).
 *
 * CI runs these checks via different mechanisms (a dedicated workflow for
 * gen-skill, since it also needs its own checkout for cross-repo install-skill
 * consumption; an inline `make check-readme-cli` step in test.yml; a vitest
 * test for gen-samples, since dogfooding the exporter is itself the check).
 * Left as-is — no functional difference, and converging them isn't worth the
 * churn (see #265).
 *
 * The .claude/skills/pfdsl dev copy has no gate of its own: it is a symlink to
 * plugin/pfdsl/skills/pfdsl (#714), so the tracked-copy gates below cover the
 * same bytes. Its trigger pattern (scripts/lib/gen-skill-trigger.mjs) is still
 * used by gate-check.mjs.
 *
 * Usage: node scripts/check-drift-gates.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isDistStale } from "./lib/dist-freshness.mjs";
import { GEN_INSTALL_TRIGGER } from "./lib/gen-install-trigger.mjs";
import { GEN_PLUGIN_TRIGGER } from "./lib/gen-plugin-trigger.mjs";
import { runDriftGates } from "./lib/pre-commit-drift.mjs";
import { git, tryRun } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CLI_DIST = "packages/cli/dist/cli.js";

/**
 * The shape four of these gates share: run the generator, then ask git whether
 * it wrote anything. Spelled once so a gate cannot be added with the diff step
 * mis-typed — `git diff` without `--quiet` exits 0 whatever it finds, which
 * would leave the gate permanently, silently green.
 * @param {[string, string[]]} regenerate
 * @param {string[]} diffPaths - pathspecs, as `git diff -- <paths>` takes them
 * @returns {[string, string[]][]}
 */
function regenerateThenDiff(regenerate, diffPaths) {
	return [regenerate, ["git", ["diff", "--quiet", "--", ...diffPaths]]];
}

/**
 * Declaration order is load-bearing: gen-install rewrites .claude/skills/
 * pfd-ops/install/, and the gen-plugin gates mirror that tree into plugin/.
 * Running gen-plugin first would diff plugin/ against an install/ that is about
 * to change.
 * @type {import("./lib/pre-commit-drift.mjs").DriftGate[]}
 */
const GATES = [
	{
		id: "gen-install",
		// install/ is a generated mirror of its repo-root sources (#547) — one
		// direction only. Needs no build output, unlike the gen-plugin gates.
		trigger: GEN_INSTALL_TRIGGER,
		requireDist: [],
		commands: regenerateThenDiff(
			["node", ["scripts/gen-install.mjs"]],
			[".claude/skills/pfd-ops/install"],
		),
		hint: ".claude/skills/pfd-ops/install is stale (or was hand-edited). Run 'make gen-install' and re-stage.",
	},
	{
		id: "gen-plugin-skill-md",
		// The only part of plugin/ that needs the CLI dist: SKILL.md embeds
		// `pfdsl help` output and the CLI version. Scoped to that one file so a
		// stale dist doesn't also skip the dist-independent bulk below (#593).
		// Uses the plugin trigger, not the narrower skill one — a CLI version bump
		// must re-stamp SKILL.md too.
		trigger: GEN_PLUGIN_TRIGGER,
		requireDist: [CLI_DIST],
		commands: regenerateThenDiff(
			["node", ["scripts/gen-skill.mjs", "--out", "plugin/pfdsl/skills/pfdsl"]],
			["plugin/pfdsl/skills/pfdsl/SKILL.md"],
		),
		hint: "plugin/pfdsl/skills/pfdsl/SKILL.md is stale. Run 'make gen-plugin' and re-stage the plugin files.",
	},
	{
		id: "gen-plugin-bulk",
		// Everything else gen-plugin assembles, none of which reads the CLI dist
		// (assemblePluginDistIndependent, #593). With dist missing this is the only
		// gen-plugin gate that can run, so its hint names the dist-free command
		// rather than `make gen-plugin`, which would fail on the SKILL.md step.
		trigger: GEN_PLUGIN_TRIGGER,
		requireDist: [],
		commands: regenerateThenDiff(
			["node", ["scripts/gen-plugin-dist-independent.mjs"]],
			[
				"plugin",
				":(exclude)plugin/pfdsl/skills/pfdsl/SKILL.md",
				".claude-plugin/marketplace.json",
			],
		),
		hint: "plugin/pfdsl or .claude-plugin/marketplace.json is stale (SKILL.md checked above). Run 'node scripts/gen-plugin-dist-independent.mjs' (dist-free) and re-stage the plugin/marketplace files, or 'pnpm -r build && make gen-plugin' to regenerate everything.",
	},
	{
		id: "samples-dot",
		// The .dot/README guard and the .svg guard are separate vitest suites (see
		// the "docs/samples drift" comment in graphviz-exporter's index.test.ts).
		// Kept as two gates so each reports its own failure and waits on only the
		// dist it reads.
		trigger: /^docs\/samples\//,
		requireDist: [
			"packages/core/dist/index.js",
			"packages/graphviz-exporter/dist/index.js",
		],
		commands: [
			[
				"pnpm",
				[
					"--filter",
					"@pfdsl/graphviz-exporter",
					"exec",
					"vitest",
					"run",
					"index.test",
				],
			],
		],
		hint: "docs/samples drift: run 'make gen-samples' and re-stage .dot / README.md.",
	},
	{
		id: "samples-svg",
		trigger: /^docs\/samples\//,
		requireDist: ["packages/preview-engine/dist/index.js"],
		commands: [
			[
				"pnpm",
				[
					"--filter",
					"@pfdsl/preview-engine",
					"exec",
					"vitest",
					"run",
					"index.test",
				],
			],
		],
		hint: "docs/samples .svg drift: run 'make gen-samples' and re-stage .svg.",
	},
	{
		id: "readme-cli",
		// Verifies the README `## CLI` generated block matches `pfdsl help`.
		trigger: /^(packages\/cli\/src\/|README\.md)/,
		requireDist: [CLI_DIST],
		commands: regenerateThenDiff(
			["node", ["scripts/gen-readme-cli.mjs"]],
			["README.md"],
		),
		hint: "README.md CLI section is stale. Run 'make gen-readme-cli' and re-stage README.md.",
	},
];

const stagedFiles = git(["diff", "--cached", "--name-only"], { cwd: root })
	.split("\n")
	.filter(Boolean);

const { failures, notes } = runDriftGates(GATES, {
	stagedFiles,
	isDistFresh: (path) => !isDistStale(path),
	runCommand: (file, args) =>
		tryRun(file, args, { cwd: root, captureStderr: true }).ok,
});

for (const note of notes) {
	console.log(note);
}
for (const failure of failures) {
	console.log(failure.hint);
}

if (failures.length > 0) {
	process.exit(1);
}
