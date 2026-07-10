import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	listInstallFiles,
	checkInstallSync,
	deployInstall,
	checkUpstreamVersion,
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
});

describe("checkInstallSync", () => {
	function makeSkillRoot() {
		const skillRoot = join(tmp, "skill");
		writeFile(join(skillRoot, "install"), "a.txt", "canonical-a");
		writeFile(join(skillRoot, "install"), "sub/b.txt", "canonical-b");
		return skillRoot;
	}

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
});

describe("deployInstall", () => {
	function makeSkillRoot() {
		const skillRoot = join(tmp, "skill");
		writeFile(join(skillRoot, "install"), "a.txt", "canonical-a");
		writeFile(join(skillRoot, "install"), "sub/b.txt", "canonical-b");
		return skillRoot;
	}

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

describe("checkUpstreamVersion", () => {
	function makePluginSkillRoot(localVersion) {
		const pluginRoot = join(tmp, "plugin-root");
		const skillRoot = join(pluginRoot, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeFile(pluginRoot, ".claude-plugin/plugin.json", JSON.stringify({ version: localVersion }));
		return skillRoot;
	}

	function fakeFetch(remoteVersion) {
		return async () => ({
			ok: true,
			json: async () => ({ version: remoteVersion }),
		});
	}

	it("returns a warning string when the upstream version differs", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const warning = await checkUpstreamVersion(skillRoot, fakeFetch("2.0.0"));
		assert.match(warning, /1\.0\.0/);
		assert.match(warning, /2\.0\.0/);
	});

	it("returns null when the upstream version matches", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const warning = await checkUpstreamVersion(skillRoot, fakeFetch("1.0.0"));
		assert.equal(warning, null);
	});

	it("returns null silently when the injected fetch rejects", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const rejectingFetch = async () => {
			throw new Error("network down");
		};
		const warning = await checkUpstreamVersion(skillRoot, rejectingFetch);
		assert.equal(warning, null);
	});

	it("returns null silently when the local plugin.json is absent (repo-local run)", async () => {
		const skillRoot = join(tmp, "repo-local-skill");
		mkdirSync(skillRoot, { recursive: true });
		const warning = await checkUpstreamVersion(skillRoot, fakeFetch("2.0.0"));
		assert.equal(warning, null);
	});
});
