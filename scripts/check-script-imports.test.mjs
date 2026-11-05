import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { makeGitRepository } from "./lib/git-test-repository.test-helper.mjs";

const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("script import CLI against working-tree deletions", () => {
	let root;
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" });
	const cli = () =>
		spawnSync(process.execPath, ["scripts/check-script-imports.mjs"], {
			cwd: root,
			encoding: "utf8",
		});

	beforeEach(() => {
		root = makeGitRepository({ prefix: "script-import-deletion-" });
		for (const path of [
			"scripts/check-script-imports.mjs",
			"scripts/lib/check-script-imports.mjs",
			"scripts/lib/relative-imports.mjs",
			"scripts/lib/run-exec.mjs",
			"scripts/lib/git-environment.mjs",
		]) {
			const destination = join(root, path);
			mkdirSync(dirname(destination), { recursive: true });
			copyFileSync(join(sourceRoot, path), destination);
		}
		writeFileSync(
			join(root, "scripts/removed.mjs"),
			"export const value = 1;\n",
		);
		git("add", "--", "scripts");
		rmSync(join(root, "scripts/removed.mjs"));
	});

	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("accepts an unstaged deletion when no remaining script imports it", () => {
		const result = cli();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /script\(s\) resolve cleanly/);
		assert.ok(git("ls-files").includes("scripts/removed.mjs"));
	});

	it("still reports a remaining import of the deleted file", () => {
		writeFileSync(
			join(root, "scripts/consumer.mjs"),
			'import { value } from "./removed.mjs";\nexport { value };\n',
		);
		git("add", "--", "scripts/consumer.mjs");
		const result = cli();
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(
			result.stdout,
			/scripts\/consumer\.mjs: "\.\/removed\.mjs" does not resolve/,
		);
		assert.doesNotMatch(result.stderr, /ENOENT/);
	});
});
