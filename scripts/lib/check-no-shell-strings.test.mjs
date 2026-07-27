import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findShellExecutors } from "./check-no-shell-strings.mjs";

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
