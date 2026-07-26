#!/usr/bin/env node
// CLI wrapper for scripts/lib/sync-install.mjs (#547): reconciles the
// pfd-ops install/ canonical <-> deployed pair bidirectionally.
//
// Usage:
//   node scripts/sync-install.mjs            # manual mode: lift all divergence
//   node scripts/sync-install.mjs --staged   # pre-commit mode: staged-side wins
//
// --staged mode is the one wired into scripts/pre-commit: it reads the
// staged file set, refuses (exit 1, touching nothing) if any pair is
// ambiguous (both sides staged with differing content), otherwise applies
// the resolved copies and `git add`s everything it wrote — including a
// gen-plugin.mjs re-run + `git add plugin` when the canonical side changed,
// since plugin/pfdsl/skills/pfd-ops/ mirrors install/ and would otherwise go
// stale in the same commit.

import { execFileSync, execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyInstallSync, planInstallSync } from "./lib/sync-install.mjs";
import { isDistStale } from "./lib/dist-freshness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalDir = resolve(root, ".claude/skills/pfd-ops/install");
const targetRoot = root;
const cliDist = resolve(root, "packages/cli/dist/cli.js");
// The one part of the generated plugin tree that mirrors install/ (see the
// gen-plugin call below for why the staging scope matters).
const PLUGIN_INSTALL_MIRROR = "plugin/pfdsl/skills/pfd-ops/install";

const staged = process.argv.includes("--staged");

function getStagedPaths() {
	const out = execSync("git diff --cached --name-only --diff-filter=d", { cwd: root, encoding: "utf-8" });
	return out.split("\n").filter(Boolean);
}

function gitAdd(paths) {
	if (paths.length === 0) return;
	execFileSync("git", ["add", ...paths], { cwd: root, stdio: "inherit" });
}

function printGroup(title, items) {
	if (items.length === 0) return;
	console.log(title);
	for (const item of items) console.log(`  ${item}`);
}

function main() {
	const stagedPaths = staged ? getStagedPaths() : undefined;
	const plan = planInstallSync({ canonicalDir, targetRoot, stagedPaths });

	if (staged) {
		const ambiguous = plan.filter((e) => e.action === "ambiguous");
		if (ambiguous.length > 0) {
			console.error("sync-install: ambiguous install/ divergence (both sides staged with differing content):");
			for (const e of ambiguous) {
				console.error(`  ${e.canonicalRepoPath} <-> ${e.deployedRepoPath}`);
			}
			console.error(
				"Stage only the side you want to win, or reconcile manually (edit one side to match the other) and re-stage.",
			);
			process.exit(1);
		}
	}

	const changed = applyInstallSync(plan);

	if (!staged) {
		if (changed.length === 0) {
			console.log("sync-install: install/ canonical and deployed copies are in sync.");
		} else {
			printGroup(
				"Lifted (deployed -> canonical):",
				changed.filter((c) => c.action === "lift").map((c) => c.rel),
			);
			printGroup(
				"Deployed (canonical -> deployed):",
				changed.filter((c) => c.action === "deploy").map((c) => c.rel),
			);
		}
		process.exit(0);
	}

	// --staged mode from here on: auto-stage what we wrote so the commit
	// succeeds in one shot (#547) — a deliberately different idiom from the
	// other pre-commit checks (biome, snapshots, gen-skill/gen-plugin drift),
	// which fix-then-`exit 1` and make the human re-stage. Those checks guard
	// derived output a human could plausibly want to inspect before
	// committing; this one only ever copies one already-staged file's bytes
	// onto its sibling, so there's nothing to review — auto-staging removes a
	// forgettable manual step (the exact failure mode that produced #547/#546)
	// without hiding anything.
	if (changed.length > 0) {
		gitAdd(changed.map((c) => c.wrote));

		const canonicalChanged = changed.some((c) => c.action === "lift");
		if (canonicalChanged) {
			// A lift just wrote into .claude/skills/pfd-ops/install/, which
			// plugin/pfdsl/skills/pfd-ops/ mirrors — regenerate now so the
			// later gen-plugin drift check in scripts/pre-commit finds nothing
			// to complain about.
			if (isDistStale(cliDist)) {
				console.log(
					"note: skipping gen-plugin refresh (packages/cli/dist/cli.js missing or stale) — run 'pnpm -r build' to enable locally; CI verifies it.",
				);
			} else {
				execFileSync(process.execPath, [resolve(root, "scripts/gen-plugin.mjs")], { cwd: root, stdio: "inherit" });
				// Stage only the subtree a lift can actually affect. gen-plugin
				// rebuilds all of plugin/pfdsl/ from the working tree, so a blanket
				// `git add plugin` would also stage output derived from *unstaged*
				// edits under .claude/skills/** — content the human never staged and
				// would never see. Anything beyond this path is unrelated drift, and
				// leaving it unstaged is what makes the gen-plugin check_drift step
				// later in scripts/pre-commit fail loudly instead of silently
				// committing it.
				gitAdd([PLUGIN_INSTALL_MIRROR]);
			}
		}
	}

	process.exit(0);
}

main();
