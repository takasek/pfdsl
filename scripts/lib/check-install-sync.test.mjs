import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	existsSync,
	symlinkSync,
	chmodSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

	it("skips a locally-edited file without --force and leaves it untouched", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-edited");
		writeFile(targetRoot, "a.txt", "locally-edited");

		const { copied, skipped } = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(copied.sort(), ["sub/b.txt"]);
		assert.deepEqual(skipped, ["a.txt"]);
		assert.equal(readFileSync(join(targetRoot, "a.txt"), "utf-8"), "locally-edited");
	});

	it("overwrites a locally-edited file when force is given", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-force");
		writeFile(targetRoot, "a.txt", "locally-edited");

		const { copied, skipped } = deployInstall(skillRoot, targetRoot, { force: true });
		assert.deepEqual(copied.sort(), ["a.txt", "sub/b.txt"]);
		assert.deepEqual(skipped, []);
		assert.equal(readFileSync(join(targetRoot, "a.txt"), "utf-8"), "canonical-a");
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

		const forced = deployInstall(skillRoot, targetRoot, { force: true });
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

describe("parseArgs", () => {
	it("parses --deploy, --force, --upstream, and --target with a value", () => {
		const args = parseArgs(["--target", "/tmp/foo", "--deploy", "--force", "--upstream"]);
		assert.equal(args.target, "/tmp/foo");
		assert.equal(args.deploy, true);
		assert.equal(args.force, true);
		assert.equal(args.upstream, true);
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
