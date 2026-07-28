import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { findShellExecutors, selectScannedFiles } from "./check-no-shell-strings.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("findShellExecutors", () => {
	it("flags importing execSync", () => {
		const found = findShellExecutors('import { execSync } from "node:child_process";');
		assert.equal(found.length, 1);
	});

	it("flags the bare child_process specifier as well as the node: one", () => {
		assert.equal(findShellExecutors('import { execSync } from "child_process";').length, 1);
	});

	it("flags an aliased import, which the name on the left still identifies", () => {
		const found = findShellExecutors('import { execSync as sh } from "node:child_process";');
		assert.equal(found.length, 1);
	});

	it("flags async exec too, which runs through a shell just the same", () => {
		assert.equal(findShellExecutors('import { exec } from "node:child_process";').length, 1);
	});

	it("leaves execFileSync alone, which takes argv", () => {
		assert.deepEqual(findShellExecutors('import { execFileSync } from "node:child_process";'), []);
	});

	it("leaves an argv-taking import list alone even when it is long", () => {
		assert.deepEqual(findShellExecutors('import { execFileSync, spawnSync } from "node:child_process";'), []);
	});

	it("flags only the shell-executing name in a mixed import list", () => {
		const found = findShellExecutors('import { execFileSync, execSync } from "node:child_process";');
		assert.equal(found.length, 1);
		assert.match(found[0].reason, /execSync/);
	});

	it("flags require of child_process, which hands over the whole module", () => {
		const found = findShellExecutors('const cp = require("node:child_process");');
		assert.equal(found.length, 1);
	});

	it("flags shell: true, which makes an argv-taking call run a command line", () => {
		const found = findShellExecutors('execFileSync(cmd, { shell: true });');
		assert.equal(found.length, 1);
		assert.match(found[0].reason, /shell: true/);
	});

	it("catches the evasion of assigning the command to a variable first", () => {
		// The point of banning the import: no argument analysis to slip past.
		const source = 'import { execSync } from "node:child_process";\nconst cmd = `git show ${ref}`;\nexecSync(cmd);';
		assert.equal(findShellExecutors(source).length, 1);
	});

	it("reports the line the import is on", () => {
		const found = findShellExecutors('const a = 1;\n\nimport { execSync } from "node:child_process";');
		assert.equal(found[0].line, 3);
	});

	it("passes a file that only uses the shared runner", () => {
		assert.deepEqual(findShellExecutors('import { git } from "./lib/run-exec.mjs";\ngit(["show", ref]);'), []);
	});
});

describe("selectScannedFiles", () => {
	it("scans a script outside scripts/, which an enumerated glob list would miss", () => {
		assert.deepEqual(selectScannedFiles(["hooks/retro-reminder-post-tool-use.mjs"]), [
			"hooks/retro-reminder-post-tool-use.mjs",
		]);
	});

	it("scans a directory nobody has created yet, so a new one needs no glob edit", () => {
		assert.deepEqual(selectScannedFiles(["tools/release/publish.mjs"]), ["tools/release/publish.mjs"]);
	});

	it("scans scripts/ at both its top level and nested", () => {
		const files = ["scripts/gate-check.mjs", "scripts/pfdsl/lib/gh-exec.mjs"];
		assert.deepEqual(selectScannedFiles(files), files);
	});

	it("skips test files, which hold the offending patterns as data", () => {
		assert.deepEqual(selectScannedFiles(["scripts/lib/gate-check.test.mjs"]), []);
	});

	it("skips the detector itself, whose patterns name the banned imports", () => {
		assert.deepEqual(selectScannedFiles(["scripts/lib/check-no-shell-strings.mjs"]), []);
	});

	it("skips the generated plugin mirror, whose sources are scanned and whose identity is gated", () => {
		const files = ["plugin/pfdsl/hooks/retro-reminder-post-tool-use.mjs", "hooks/retro-reminder-post-tool-use.mjs"];
		assert.deepEqual(selectScannedFiles(files), ["hooks/retro-reminder-post-tool-use.mjs"]);
	});

	it("skips non-.mjs files", () => {
		assert.deepEqual(selectScannedFiles(["scripts/pre-commit", "packages/cli/src/index.ts"]), []);
	});
});

describe("the repository's own scan set", () => {
	/** Every tracked `.mjs` path, repo-relative — the candidates the gate filters. */
	function trackedMjsFiles() {
		return execFileSync("git", ["ls-files", "*.mjs"], { cwd: root, encoding: "utf-8" }).split("\n").filter(Boolean);
	}

	it("covers every tracked .mjs that is not excluded on purpose", () => {
		const scanned = new Set(selectScannedFiles(trackedMjsFiles()));
		const missed = trackedMjsFiles().filter(
			(f) =>
				!scanned.has(f) &&
				!f.endsWith(".test.mjs") &&
				!f.startsWith("plugin/") &&
				f !== "scripts/lib/check-no-shell-strings.mjs",
		);
		assert.deepEqual(missed, [], `outside the gate's reach: ${missed.join(", ")}`);
	});

	it("reaches hooks/, which runs on every Bash tool call in an adopting repo", () => {
		assert.ok(selectScannedFiles(trackedMjsFiles()).includes("hooks/retro-reminder-post-tool-use.mjs"));
	});
});
