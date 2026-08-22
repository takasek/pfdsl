/**
 * The pre-commit gate list, built from what the commit stages.
 *
 * Six of these gates have the "regenerate the derived output, fail if it
 * changed" shape and were a static array (takasek/pfdsl#755). The three added
 * here — snapshot freshness, .pfdsl canonical format, markdown line breaks —
 * were still `exit 1` in scripts/pre-commit, so each hid every gate after it
 * and turned one bad commit into as many attempts as it had problems (#759).
 *
 * Two of the three cannot be spelled as a fixed argv: `pfdsl fmt` takes one
 * file, and check-md-linebreaks.mjs takes the staged paths. Rather than teach
 * DriftGate about dynamic arguments — which would also mean teaching the runner
 * to report *which* command in a gate failed, to keep the file name in the hint
 * — the gate list itself became a function of the staged files. The fmt check
 * is then one gate per file, and DriftGate and runDriftGates are unchanged.
 */

import { GEN_INSTALL_TRIGGER } from "./gen-install-trigger.mjs";
import { GEN_PLUGIN_TRIGGER } from "./gen-plugin-trigger.mjs";

const CLI_DIST = "packages/cli/dist/cli.js";

/** Operational .pfdsl files. docs/ teaching material is exempt (#529). */
const OPS_PFDSL = /^\.pfdsl\/.*\.pfdsl$/;

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
 * Only the staged paths that still exist are needed here: they are what a
 * per-file check can be pointed at. Whether a gate is relevant at all is the
 * runner's question, and it asks each gate's trigger against the full staged
 * list, deletions included — a deleted source still means its generated output
 * has to be re-derived.
 * @param {object} input
 * @param {string[]} input.stagedPresent
 * @returns {import("./pre-commit-drift.mjs").DriftGate[]}
 */
export function buildGates({ stagedPresent }) {
	const pfdslFiles = stagedPresent.filter((f) => OPS_PFDSL.test(f));
	const mdFiles = stagedPresent.filter((f) => f.endsWith(".md"));

	// Declaration order is load-bearing among the generator gates: gen-install
	// rewrites .claude/skills/pfd-ops/install/, and the gen-plugin gates mirror
	// that tree into plugin/. Running gen-plugin first would diff plugin/ against
	// an install/ that is about to change.
	return [
		{
			id: "pfdsl-snapshots",
			// Triggered by every staged .pfdsl, deletions included — a removed
			// fixture changes the snapshot as surely as an edited one does.
			trigger: /\.pfdsl$/,
			requireDist: [],
			commands: regenerateThenDiff(
				["pnpm", ["--filter", "@pfdsl/core", "exec", "vitest", "run", "-u"]],
				["packages/core/src/__snapshots__/"],
			),
			hint: "Snapshots are stale. Run 'pnpm --filter @pfdsl/core exec vitest run -u' and re-stage the snapshot file.",
		},
		// One gate per file: DriftGate carries a single hint, and the operator
		// needs the name of the file that is unformatted, not the news that one of
		// them is.
		...pfdslFiles.map((file) => ({
			id: `pfdsl-fmt:${file}`,
			// The trigger is satisfied by construction — this gate exists because
			// `file` is staged — so it says which files the check covers rather
			// than singling out its own, which would need the path escaped into a
			// pattern for no decision it takes part in.
			trigger: OPS_PFDSL,
			requireDist: [CLI_DIST],
			commands: /** @type {[string, string[]][]} */ ([
				["node", [CLI_DIST, "fmt", file, "--check"]],
			]),
			hint: `${file} is not canonically formatted. Run 'make fmt-pfdsl' and re-stage.`,
		})),
		// Same per-file shape, same scope: a location: that no longer resolves is
		// a property only the operational graphs have. docs/ samples and the core
		// fixtures carry illustrative paths on purpose, so resolving is not
		// something they are supposed to do (#937).
		...pfdslFiles.map((file) => ({
			id: `pfdsl-links:${file}`,
			trigger: OPS_PFDSL,
			requireDist: [CLI_DIST],
			commands: /** @type {[string, string[]][]} */ ([
				["node", [CLI_DIST, "meta", "check-links", file]],
			]),
			hint: `${file} has a location: that does not resolve. Run 'node ${CLI_DIST} meta check-links ${file}' to see which node, then fix the path or restore the file.`,
		})),
		// Built only when there are paths to pass: check-md-linebreaks.mjs falls
		// back to every tracked .md when called with none, so an empty argument
		// list would quietly turn this into a repo-wide check.
		...(mdFiles.length > 0
			? [
					{
						id: "md-linebreaks",
						trigger: /\.md$/,
						requireDist: [],
						commands: /** @type {[string, string[]][]} */ ([
							["node", ["scripts/check-md-linebreaks.mjs", ...mdFiles]],
						]),
						// The runner captures command output, so the violations
						// themselves are not printed — the hint has to be the command
						// that prints them.
						hint: `Markdown prose has mid-sentence line breaks. Run 'node scripts/check-md-linebreaks.mjs ${mdFiles.join(" ")}' to see them, fix, and re-stage.`,
					},
				]
			: []),
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
				[
					"node",
					["scripts/gen-skill.mjs", "--out", "plugin/pfdsl/skills/pfdsl"],
				],
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
					"AGENTS.md",
					".agents",
					".codex",
				],
			),
			hint: "Claude and Codex outputs are stale (plugin/pfdsl, plugin/pfdsl-codex, .claude-plugin/marketplace.json, AGENTS.md, .agents, or .codex; SKILL.md checked above). Run 'node scripts/gen-plugin-dist-independent.mjs' (dist-free) and re-stage the Claude and Codex outputs, or 'pnpm -r build && make gen-plugin' to regenerate everything.",
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
			// Verifies both generated CLI listings match `pfdsl help`: the root
			// README's raw block and packages/cli/README.md's tables (#850).
			trigger: /^(packages\/cli\/src\/|packages\/cli\/README\.md|README\.md)/,
			requireDist: [CLI_DIST],
			commands: regenerateThenDiff(
				["node", ["scripts/gen-readme-cli.mjs"]],
				["README.md", "packages/cli/README.md"],
			),
			hint: "A README's CLI section is stale. Run 'make gen-readme-cli' and re-stage README.md and packages/cli/README.md.",
		},
	];
}
