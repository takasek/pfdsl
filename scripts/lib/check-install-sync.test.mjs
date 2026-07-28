import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	copyFileSync,
	rmSync,
	existsSync,
	symlinkSync,
	chmodSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
	listInstallFiles,
	checkInstallSync,
	deployInstall,
	parseArgs,
} from "../../.claude/skills/pfd-ops/scripts/check-install-sync.mjs";

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "check-install-sync-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeFile(root, relPath, content) {
	const full = join(root, ...relPath.split("/"));
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

// Shared fixture for checkInstallSync/deployInstall tests: a skill root with
// a two-file install/ tree (one top-level file, one nested).
function makeSkillRoot() {
	const skillRoot = join(tmp, "skill");
	writeFile(join(skillRoot, "install"), "a.txt", "canonical-a");
	writeFile(join(skillRoot, "install"), "sub/b.txt", "canonical-b");
	return skillRoot;
}

describe("listInstallFiles", () => {
	it("enumerates nested files under install/ as relative paths", () => {
		const installDir = join(tmp, "install");
		writeFile(installDir, ".github/workflows/flow-on-issue-close.yml", "a");
		writeFile(installDir, "scripts/audit-issues-flow.mjs", "b");
		writeFile(installDir, "scripts/lib/issues-flow-audit.mjs", "c");

		assert.deepEqual(listInstallFiles(installDir), [
			".github/workflows/flow-on-issue-close.yml",
			"scripts/audit-issues-flow.mjs",
			"scripts/lib/issues-flow-audit.mjs",
		]);
	});

	it("returns an empty array when install/ does not exist", () => {
		assert.deepEqual(listInstallFiles(join(tmp, "nonexistent")), []);
	});

	it("includes a symlinked file rather than silently dropping it", () => {
		const installDir = join(tmp, "install");
		writeFile(installDir, "real.txt", "a");
		symlinkSync(join(installDir, "real.txt"), join(installDir, "linked.txt"));

		assert.deepEqual(listInstallFiles(installDir), ["linked.txt", "real.txt"]);
	});
});

describe("checkInstallSync", () => {
	it("reports not-adopted when zero deployed files exist at target", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-empty");
		mkdirSync(targetRoot, { recursive: true });

		const { adopted, results } = checkInstallSync(skillRoot, targetRoot);
		assert.equal(adopted, false);
		assert.ok(results.every((r) => r.status === "missing"));
	});

	it("classifies ok/modified/missing per file", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-mixed");
		writeFile(targetRoot, "a.txt", "canonical-a"); // matches -> ok
		writeFile(targetRoot, "sub/b.txt", "locally-edited"); // differs -> modified
		// (no scripts/audit... third file expected: only 2 files declared above)

		const { adopted, results } = checkInstallSync(skillRoot, targetRoot);
		assert.equal(adopted, true);
		const byPath = Object.fromEntries(results.map((r) => [r.path, r.status]));
		assert.equal(byPath["a.txt"], "ok");
		assert.equal(byPath["sub/b.txt"], "modified");
	});

	it("classifies a file as missing when absent from target", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-partial");
		writeFile(targetRoot, "a.txt", "canonical-a");

		const { results } = checkInstallSync(skillRoot, targetRoot);
		const byPath = Object.fromEntries(results.map((r) => [r.path, r.status]));
		assert.equal(byPath["a.txt"], "ok");
		assert.equal(byPath["sub/b.txt"], "missing");
	});

	it("reports a file removed from canonical install/ as orphaned, using the deploy manifest", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-orphan");
		mkdirSync(targetRoot, { recursive: true });

		// Simulate a prior deploy when sub/b.txt was still canonical.
		deployInstall(skillRoot, targetRoot);

		// Simulate a future pfdsl release dropping sub/b.txt from canonical install/.
		rmSync(join(skillRoot, "install", "sub", "b.txt"));

		const { results } = checkInstallSync(skillRoot, targetRoot);
		const byPath = Object.fromEntries(results.map((r) => [r.path, r.status]));
		assert.equal(byPath["a.txt"], "ok");
		assert.equal(byPath["sub/b.txt"], "orphaned");
	});

	it("does not report a file as orphaned when no manifest exists (never deployed via this tool)", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-no-manifest");
		// A file that merely happens to match a canonical filename, placed by
		// some other means (no prior --deploy, no manifest) is not "orphaned".
		writeFile(targetRoot, "unrelated.txt", "whatever");

		const { results } = checkInstallSync(skillRoot, targetRoot);
		assert.ok(!results.some((r) => r.path === "unrelated.txt"));
	});

	it("ignores malformed manifest entries instead of crashing", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-malformed-manifest");
		writeFile(targetRoot, "a.txt", "canonical-a");
		writeFile(
			targetRoot,
			".claude/pfd-ops-install-manifest.json",
			JSON.stringify({ files: [{}, "not-an-object", { path: 123, hash: "x" }, { path: "a.txt", hash: "irrelevant" }] }),
		);

		const { results } = checkInstallSync(skillRoot, targetRoot);
		assert.ok(!results.some((r) => r.status === "orphaned"));
	});
});

describe("checkInstallSync rename candidates", () => {
	// Renaming a canonical file splits into an unrelated-looking "missing" and
	// "orphaned" pair, so a repo carrying a local edit on the old path gets the
	// bare upstream file at the new path with no hint that its customization
	// needs carrying over (#603).
	function deployThenRename(targetRoot, from, to, { newContent } = {}) {
		const skillRoot = join(tmp, "skill-rename");
		writeFile(join(skillRoot, "install"), from, "canonical-original");
		deployInstall(skillRoot, targetRoot);
		rmSync(join(skillRoot, "install", ...from.split("/")));
		writeFile(join(skillRoot, "install"), to, newContent ?? "canonical-original");
		return skillRoot;
	}

	it("pairs an orphan with a missing file that carries the same canonical hash", () => {
		const targetRoot = join(tmp, "target-rename-hash");
		const skillRoot = deployThenRename(targetRoot, "scripts/old.mjs", "scripts/pfdsl/new.mjs");

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, [
			{ from: "scripts/old.mjs", to: "scripts/pfdsl/new.mjs", reason: "same canonical hash" },
		]);
	});

	it("pairs a moved file whose content also changed, by basename", () => {
		const targetRoot = join(tmp, "target-rename-basename");
		const skillRoot = deployThenRename(targetRoot, "scripts/lib/gh-exec.mjs", "scripts/pfdsl/lib/gh-exec.mjs", {
			newContent: "canonical-rewritten",
		});

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, [
			{
				from: "scripts/lib/gh-exec.mjs",
				to: "scripts/pfdsl/lib/gh-exec.mjs",
				reason: "same basename",
			},
		]);
	});

	it("pairs a prefixed basename when the prefix ends at a separator", () => {
		const targetRoot = join(tmp, "target-rename-suffix");
		const skillRoot = deployThenRename(
			targetRoot,
			".github/workflows/flow-on-issue-close.yml",
			".github/workflows/pfdsl-flow-on-issue-close.yml",
			{ newContent: "canonical-rewritten" },
		);

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, [
			{
				from: ".github/workflows/flow-on-issue-close.yml",
				to: ".github/workflows/pfdsl-flow-on-issue-close.yml",
				reason: "same basename suffix",
			},
		]);
	});

	it("does not pair an orphan with an unrelated missing file", () => {
		const targetRoot = join(tmp, "target-rename-unrelated");
		const skillRoot = deployThenRename(targetRoot, "scripts/old.mjs", "scripts/unrelated.mjs", {
			newContent: "canonical-rewritten",
		});

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, []);
	});

	it("does not treat a mid-word basename overlap as a suffix match", () => {
		const targetRoot = join(tmp, "target-rename-midword");
		const skillRoot = deployThenRename(targetRoot, "scripts/exec.mjs", "scripts/ghexec.mjs", {
			newContent: "canonical-rewritten",
		});

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, []);
	});

	it("reports no candidates when nothing was renamed", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-rename-none");
		deployInstall(skillRoot, targetRoot);

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, []);
	});
});

describe("deployInstall", () => {
	it("copies every canonical file into an empty target, creating directories as needed", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-fresh");
		mkdirSync(targetRoot, { recursive: true });

		const { copied, skipped } = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(copied.sort(), ["a.txt", "sub/b.txt"]);
		assert.deepEqual(skipped, []);
		assert.equal(readFileSync(join(targetRoot, "a.txt"), "utf-8"), "canonical-a");
		assert.equal(readFileSync(join(targetRoot, "sub", "b.txt"), "utf-8"), "canonical-b");
	});

	it("skips a locally-edited file without --force-overwrite and leaves it untouched", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-edited");
		writeFile(targetRoot, "a.txt", "locally-edited");

		const { copied, skipped } = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(copied.sort(), ["sub/b.txt"]);
		assert.deepEqual(skipped, ["a.txt"]);
		assert.equal(readFileSync(join(targetRoot, "a.txt"), "utf-8"), "locally-edited");
	});

	it("overwrites a locally-edited file when forceOverwrite is given", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-force");
		writeFile(targetRoot, "a.txt", "locally-edited");

		const { copied, skipped } = deployInstall(skillRoot, targetRoot, { forceOverwrite: true });
		assert.deepEqual(copied.sort(), ["a.txt", "sub/b.txt"]);
		assert.deepEqual(skipped, []);
		assert.equal(readFileSync(join(targetRoot, "a.txt"), "utf-8"), "canonical-a");
	});

	it("keeps a locally-edited file when only forceRemoveOrphans is given", () => {
		// The #603 accident: sweeping an orphaned old path must not also revert
		// the customization just re-applied to the surviving canonical path.
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-force-orphans-only");
		deployInstall(skillRoot, targetRoot);
		writeFile(targetRoot, "a.txt", "locally-edited");
		writeFile(targetRoot, "sub/b.txt", "locally-edited-before-drop");
		rmSync(join(skillRoot, "install", "sub", "b.txt"));

		const { copied, skipped, removed } = deployInstall(skillRoot, targetRoot, {
			forceRemoveOrphans: true,
		});
		assert.deepEqual(copied, []);
		assert.deepEqual(skipped, ["a.txt"]);
		assert.deepEqual(removed, ["sub/b.txt"]);
		assert.equal(readFileSync(join(targetRoot, "a.txt"), "utf-8"), "locally-edited");
	});

	it("keeps a locally-modified orphan when only forceOverwrite is given", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-force-overwrite-only");
		deployInstall(skillRoot, targetRoot);
		writeFile(targetRoot, "a.txt", "locally-edited");
		writeFile(targetRoot, "sub/b.txt", "locally-edited-before-drop");
		rmSync(join(skillRoot, "install", "sub", "b.txt"));

		const { copied, removed, orphanSkipped } = deployInstall(skillRoot, targetRoot, {
			forceOverwrite: true,
		});
		assert.deepEqual(copied, ["a.txt"]);
		assert.deepEqual(removed, []);
		assert.deepEqual(orphanSkipped, ["sub/b.txt"]);
		assert.equal(existsSync(join(targetRoot, "sub", "b.txt")), true);
	});

	it("removes an unmodified file that a later canonical release dropped from install/", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-orphan-cleanup");
		deployInstall(skillRoot, targetRoot);

		rmSync(join(skillRoot, "install", "sub", "b.txt"));
		const { removed, orphanSkipped } = deployInstall(skillRoot, targetRoot);

		assert.deepEqual(removed, ["sub/b.txt"]);
		assert.deepEqual(orphanSkipped, []);
		assert.equal(existsSync(join(targetRoot, "sub", "b.txt")), false);
	});

	it("skips removing an orphaned file that was locally modified, unless forced", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-orphan-edited");
		deployInstall(skillRoot, targetRoot);
		writeFile(targetRoot, "sub/b.txt", "locally-edited-before-drop");

		rmSync(join(skillRoot, "install", "sub", "b.txt"));
		const first = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(first.removed, []);
		assert.deepEqual(first.orphanSkipped, ["sub/b.txt"]);
		assert.equal(existsSync(join(targetRoot, "sub", "b.txt")), true);

		const forced = deployInstall(skillRoot, targetRoot, { forceRemoveOrphans: true });
		assert.deepEqual(forced.removed, ["sub/b.txt"]);
		assert.equal(existsSync(join(targetRoot, "sub", "b.txt")), false);
	});

	it("ignores malformed manifest entries instead of crashing", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-malformed-manifest-deploy");
		writeFile(
			targetRoot,
			".claude/pfd-ops-install-manifest.json",
			JSON.stringify({ files: [{}, "not-an-object", { path: 123, hash: "x" }] }),
		);

		const { copied } = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(copied.sort(), ["a.txt", "sub/b.txt"]);
	});

	it("copies the canonical file's mode onto a freshly created target file", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-mode-fresh");
		mkdirSync(targetRoot, { recursive: true });
		chmodSync(join(skillRoot, "install", "a.txt"), 0o755);

		deployInstall(skillRoot, targetRoot);
		assert.equal(statSync(join(targetRoot, "a.txt")).mode & 0o777, 0o755);
	});

	it("re-applies the canonical mode onto a target file that already exists with a different mode", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-mode-existing");
		writeFile(targetRoot, "a.txt", "canonical-a");
		chmodSync(join(targetRoot, "a.txt"), 0o644);
		chmodSync(join(skillRoot, "install", "a.txt"), 0o755);

		deployInstall(skillRoot, targetRoot);
		assert.equal(statSync(join(targetRoot, "a.txt")).mode & 0o777, 0o755);
	});
});

describe("CLI output", () => {
	const scriptPath = fileURLToPath(
		new URL("../../.claude/skills/pfd-ops/scripts/check-install-sync.mjs", import.meta.url),
	);

	function runCli(skillRoot, targetRoot, extraArgs = []) {
		// The script resolves install/ from its own location, so it has to be
		// copied into the fixture skill root rather than symlinked there: the
		// ESM loader realpath-resolves import.meta.url (see the note at the
		// bottom of the script), so a symlink would silently point skillRoot at
		// the repository's own install/ tree and the fixture would go unread.
		// plugin-version-check.mjs comes along as the script's only sibling
		// import.
		const stubScripts = join(skillRoot, "scripts");
		mkdirSync(stubScripts, { recursive: true });
		const stubScript = join(stubScripts, "check-install-sync.mjs");
		copyFileSync(scriptPath, stubScript);
		copyFileSync(join(dirname(scriptPath), "plugin-version-check.mjs"), join(stubScripts, "plugin-version-check.mjs"));
		return spawnSync(process.execPath, [stubScript, "--target", targetRoot, ...extraArgs], {
			encoding: "utf-8",
		});
	}

	it("surfaces rename candidates on --deploy, not just on a bare check", () => {
		// The #603 report: --deploy printed nothing pointing the old path's
		// local edit at the new path, so the customization was silently lost.
		// The fixture basename is deliberately absent from this repo's own
		// install/ tree, so a stub that failed to override skillRoot would show
		// up as a failure here instead of matching the real tree by accident.
		const skillRoot = join(tmp, "skill-cli");
		const targetRoot = join(tmp, "target-cli");
		writeFile(join(skillRoot, "install"), "scripts/lib/fixture-tool.mjs", "canonical-original");
		deployInstall(skillRoot, targetRoot);
		rmSync(join(skillRoot, "install", "scripts", "lib", "fixture-tool.mjs"));
		writeFile(join(skillRoot, "install"), "scripts/pfdsl/lib/fixture-tool.mjs", "canonical-rewritten");

		const checked = runCli(skillRoot, targetRoot);
		assert.match(checked.stdout, /Possible renames/);

		// Deploying resolves the drift, so this has to run second to still see
		// the pre-deploy state the hint is derived from.
		const deployed = runCli(skillRoot, targetRoot, ["--deploy"]);
		assert.match(deployed.stdout, /Possible renames/);
		assert.match(deployed.stdout, /scripts\/lib\/fixture-tool\.mjs -> scripts\/pfdsl\/lib\/fixture-tool\.mjs/);
	});

	it("exits non-zero with a migration message when given the retired --force", () => {
		const skillRoot = join(tmp, "skill-cli-force");
		const targetRoot = join(tmp, "target-cli-force");
		writeFile(join(skillRoot, "install"), "a.txt", "canonical-a");
		mkdirSync(targetRoot, { recursive: true });

		const result = runCli(skillRoot, targetRoot, ["--deploy", "--force"]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /--force was split into --force-overwrite and --force-remove-orphans/);
	});
});

describe("parseArgs", () => {
	it("parses --deploy, both force flags, --upstream, and --target with a value", () => {
		const args = parseArgs([
			"--target",
			"/tmp/foo",
			"--deploy",
			"--force-overwrite",
			"--force-remove-orphans",
			"--upstream",
		]);
		assert.equal(args.target, "/tmp/foo");
		assert.equal(args.deploy, true);
		assert.equal(args.forceOverwrite, true);
		assert.equal(args.forceRemoveOrphans, true);
		assert.equal(args.upstream, true);
	});

	it("keeps the two force flags independent", () => {
		const overwriteOnly = parseArgs(["--deploy", "--force-overwrite"]);
		assert.equal(overwriteOnly.forceOverwrite, true);
		assert.equal(overwriteOnly.forceRemoveOrphans, false);

		const orphansOnly = parseArgs(["--deploy", "--force-remove-orphans"]);
		assert.equal(orphansOnly.forceOverwrite, false);
		assert.equal(orphansOnly.forceRemoveOrphans, true);
	});

	it("rejects the retired --force instead of silently ignoring it", () => {
		// Silently dropping it would run an unforced deploy while the caller
		// believes they forced one — the failure mode #603 is about.
		assert.throws(
			() => parseArgs(["--deploy", "--force"]),
			/--force was split into --force-overwrite and --force-remove-orphans/,
		);
	});

	it("throws when --target is immediately followed by another flag", () => {
		assert.throws(() => parseArgs(["--target", "--deploy"]), /--target requires a path argument/);
	});

	it("throws when --target is the last argument", () => {
		assert.throws(() => parseArgs(["--target"]), /--target requires a path argument/);
	});
});

// checkUpstreamVersion moved to plugin-version-check.mjs/.test.mjs (ADR-0028
// review: decoupled from install/ sync semantics for reuse by other skills).
