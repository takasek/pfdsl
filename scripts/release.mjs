#!/usr/bin/env node
// Shared driver for the release / release-libs / vscode-package Makefile
// targets. Usage: node scripts/release.mjs <cli|libs|vscode> [--version X.Y.Z]
//
// Order (deliberate — see docs/adr or issue #346 for the "why"):
//   1. branch check
//   2. fetch + verify local main == origin/main (before touching anything)
//   3. clean working tree check
//   4. resolve target version (from --version, or the current package.json)
//   5. tag-duplicate check (cheap, version is already known)
//   6. pre-tag checks: build, test, check-docs, gen-skill identity
//   7. bump package.json(s) + commit (only if --version was given)
//   8. push origin main
//   9. kind-specific pre-tag step (vscode: vsce package)
//   10. git tag + push tag
//   11. watch the publish workflow (skipped for vscode, which has none)
//
// Checks run *before* the version bump commit, so a check failure never
// leaves a dangling local commit to clean up.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASE_KINDS, bumpVersionInPackageJson, tagName } from "./lib/release-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function run(cmd, args, opts = {}) {
	execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
}

function capture(cmd, args) {
	return execFileSync(cmd, args, { cwd: root, encoding: "utf-8" }).trim();
}

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

// --- Parse args ---

const [, , kindArg, ...rest] = process.argv;
const kind = RELEASE_KINDS[kindArg];
if (!kind) {
	fail(`unknown release kind '${kindArg}' (expected one of: ${Object.keys(RELEASE_KINDS).join(", ")})`);
}
const versionFlagIdx = rest.indexOf("--version");
const explicitVersion = versionFlagIdx === -1 ? undefined : rest[versionFlagIdx + 1];
if (versionFlagIdx !== -1 && !explicitVersion) {
	fail("--version requires a value");
}

// --- 1. branch check ---

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
	fail(`must run on main branch (currently on: ${branch})`);
}

// --- 2. fetch + verify local main == origin/main ---

run("git", ["fetch", "origin", "main", "--quiet"]);
const localHead = capture("git", ["rev-parse", "HEAD"]);
const remoteHead = capture("git", ["rev-parse", "origin/main"]);
if (localHead !== remoteHead) {
	fail("local main does not match origin/main. Pull (or push) first.");
}

// --- 3. clean working tree check ---

if (capture("git", ["status", "--porcelain"]) !== "") {
	fail("working tree has uncommitted changes.");
}

// --- 4. resolve target version ---

const firstPackagePath = resolve(root, kind.packages[0]);
const currentVersion = JSON.parse(readFileSync(firstPackagePath, "utf-8")).version;
const version = explicitVersion ?? currentVersion;

// --- 5. tag-duplicate check ---

const tag = tagName(kind, version);
try {
	execFileSync("git", ["rev-parse", tag], { cwd: root, stdio: "ignore" });
	fail(`tag ${tag} already exists (bump the version).`);
} catch (err) {
	if (err.status === undefined) throw err; // execFileSync itself failed to spawn
	// non-zero exit from `git rev-parse` means the tag doesn't exist — expected.
}

// --- 6. pre-tag checks ---

console.log("Running pre-tag checks (build, test, check-docs, gen-skill identity)...");
run("make", ["build"]);
run("make", ["test"]);
run("make", ["check-docs"]);
run("make", ["gen-skill"]);
// make gen-skill only checks .claude/skills/pfdsl and skills/pfdsl match each
// other (both freshly regenerated, so they almost always do) — it does not
// check that the regeneration matches what's committed. Mirror what CI's
// check-gen-skill.yml does: regenerate, then diff against the committed tree.
try {
	execFileSync("git", ["diff", "--exit-code", ".claude/skills/pfdsl", "skills/pfdsl"], {
		cwd: root,
		stdio: "ignore",
	});
} catch (err) {
	if (err.status === undefined) throw err; // execFileSync itself failed to spawn
	fail(
		"generated skill dirs (.claude/skills/pfdsl, skills/pfdsl) are stale — " +
			"run 'make gen-skill' and commit the result before releasing.",
	);
}

// --- 7. bump + commit (only if --version was given) ---

if (explicitVersion) {
	for (const pkgPath of kind.packages) {
		const abs = resolve(root, pkgPath);
		writeFileSync(abs, bumpVersionInPackageJson(readFileSync(abs, "utf-8"), explicitVersion));
	}
	run("git", ["add", ...kind.packages]);
	run("git", ["commit", "-m", kind.commitMessage(explicitVersion)]);
}

// --- 8. push origin main ---

run("git", ["push", "origin", "main", "--quiet"]);

// --- 9. kind-specific pre-tag step ---

if (kindArg === "vscode") {
	run("vsce", ["package", "--no-dependencies"], { cwd: resolve(root, "packages/vscode-extension") });
}

// --- 10. tag + push tag ---

console.log(`Tagging ${tag} and pushing (kind: ${kindArg})...`);
run("git", ["tag", tag]);
run("git", ["push", "origin", tag]);

// --- 11. watch the publish workflow ---

if (kind.workflow) {
	console.log("Waiting for GHA run to appear...");
	execFileSync("sleep", ["8"]);
	const runId = capture("gh", [
		"run",
		"list",
		"--workflow",
		kind.workflow,
		"--json",
		"databaseId,headBranch",
		"--jq",
		`.[] | select(.headBranch=="${tag}") | .databaseId`,
	]).split("\n")[0];
	if (!runId) {
		fail(`GHA run not found: gh run list --workflow ${kind.workflow}`);
	}
	run("gh", ["run", "watch", runId, "--exit-status"]);
} else {
	console.log(`${tag} tagged and pushed (no publish workflow for this kind).`);
}
