import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { genInstall } from "./gen-install.mjs";

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "gen-install-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeFile(root, relPath, content) {
	const full = join(root, ...relPath.split("/"));
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

function installPath(root, relPath) {
	return join(root, ".claude/skills/pfd-ops/install", ...relPath.split("/"));
}

describe("genInstall", () => {
	it("copies a listed source into the mirror", () => {
		writeFile(tmp, "a.txt", "hello");

		genInstall(tmp, ["a.txt"]);

		assert.equal(readFileSync(installPath(tmp, "a.txt"), "utf-8"), "hello");
	});

	it("copies both a nested source path and a dotfile-directory source path", () => {
		writeFile(tmp, "scripts/pfdsl/lib/x.mjs", "export const x = 1;");
		writeFile(tmp, ".github/workflows/y.yml", "name: y");

		genInstall(tmp, ["scripts/pfdsl/lib/x.mjs", ".github/workflows/y.yml"]);

		assert.equal(readFileSync(installPath(tmp, "scripts/pfdsl/lib/x.mjs"), "utf-8"), "export const x = 1;");
		assert.equal(readFileSync(installPath(tmp, ".github/workflows/y.yml"), "utf-8"), "name: y");
	});

	it("preserves the source file's mode on the generated copy, including the executable bit", () => {
		writeFile(tmp, "exec.sh", "#!/bin/sh\necho hi\n");
		chmodSync(join(tmp, "exec.sh"), 0o755);

		genInstall(tmp, ["exec.sh"]);

		assert.equal(statSync(installPath(tmp, "exec.sh")).mode & 0o777, 0o755);
	});

	it("re-applies the source mode even when the mirror copy already exists with a different mode", () => {
		writeFile(tmp, "a.txt", "hello");
		chmodSync(join(tmp, "a.txt"), 0o755);
		writeFile(tmp, ".claude/skills/pfd-ops/install/a.txt", "hello");
		chmodSync(installPath(tmp, "a.txt"), 0o644);

		genInstall(tmp, ["a.txt"]);

		assert.equal(statSync(installPath(tmp, "a.txt")).mode & 0o777, 0o755);
	});

	it("removes a file under install/ that is not in the template list", () => {
		writeFile(tmp, "a.txt", "hello");
		writeFile(tmp, ".claude/skills/pfd-ops/install/stale.txt", "leftover from a dropped template");

		genInstall(tmp, ["a.txt"]);

		assert.equal(existsSync(installPath(tmp, "stale.txt")), false);
		assert.equal(readFileSync(installPath(tmp, "a.txt"), "utf-8"), "hello");
	});

	it("raises a clear error naming a missing listed source, and does not partially write", () => {
		writeFile(tmp, "present.txt", "here");
		// "missing.txt" is intentionally never created.

		assert.throws(() => genInstall(tmp, ["present.txt", "missing.txt"]), /missing\.txt/);
		assert.equal(existsSync(installPath(tmp, "present.txt")), false);
	});

	it("is idempotent: running twice produces no second-run changes", () => {
		writeFile(tmp, "a.txt", "hello");
		writeFile(tmp, "sub/b.txt", "world");

		genInstall(tmp, ["a.txt", "sub/b.txt"]);
		const second = genInstall(tmp, ["a.txt", "sub/b.txt"]);

		assert.deepEqual(second.changed, []);
		assert.deepEqual(second.removed, []);
		assert.deepEqual(second.unchanged.sort(), ["a.txt", "sub/b.txt"]);
	});

	it("reports which paths it changed vs left alone", () => {
		writeFile(tmp, "a.txt", "hello");
		writeFile(tmp, "b.txt", "world");
		genInstall(tmp, ["a.txt", "b.txt"]);

		writeFile(tmp, "a.txt", "hello-edited");
		const result = genInstall(tmp, ["a.txt", "b.txt"]);

		assert.deepEqual(result.changed, ["a.txt"]);
		assert.deepEqual(result.unchanged, ["b.txt"]);
	});

	it("reports a newly added template as changed on its first run", () => {
		writeFile(tmp, "a.txt", "hello");

		const result = genInstall(tmp, ["a.txt"]);

		assert.deepEqual(result.changed, ["a.txt"]);
		assert.deepEqual(result.unchanged, []);
	});

	it("never touches the git index (no .git side effects)", () => {
		// genInstall must be pure file I/O — this is a smoke check that it does
		// not shell out to git at all: running it against a directory with no
		// .git present must not throw.
		writeFile(tmp, "a.txt", "hello");
		assert.doesNotThrow(() => genInstall(tmp, ["a.txt"]));
	});
});
