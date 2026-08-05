import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	extractTestGlobs,
	findUnrunTestFiles,
	matchesGlob,
} from "./test-glob-coverage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("extractTestGlobs", () => {
	it("extracts the quoted globs of a `node --test` invocation", () => {
		const source =
			'\tnode --test "scripts/lib/*.test.mjs" "scripts/pfdsl/lib/*.test.mjs"\n';
		assert.deepEqual(extractTestGlobs(source), [
			"scripts/lib/*.test.mjs",
			"scripts/pfdsl/lib/*.test.mjs",
		]);
	});

	it("extracts from a workflow `- run:` line the same way as from a Makefile recipe", () => {
		const source = '      - run: node --test "scripts/lib/*.test.mjs"\n';
		assert.deepEqual(extractTestGlobs(source), ["scripts/lib/*.test.mjs"]);
	});

	it("collects globs from several `node --test` lines in one file", () => {
		const source = [
			'node --test "a/*.test.mjs"',
			"other command",
			'node --test "b/*.test.mjs" "c/*.test.mjs"',
		].join("\n");
		assert.deepEqual(extractTestGlobs(source), [
			"a/*.test.mjs",
			"b/*.test.mjs",
			"c/*.test.mjs",
		]);
	});

	it("ignores a `node --test` line whose arguments are unquoted", () => {
		// Unquoted arguments are shell-expanded before node sees them, so they
		// carry no glob to compare against and must not be mistaken for one.
		assert.deepEqual(
			extractTestGlobs("node --test scripts/lib/*.test.mjs\n"),
			[],
		);
	});

	it("returns an empty array when no `node --test` line is present", () => {
		assert.deepEqual(
			extractTestGlobs(
				'node scripts/check-script-imports.mjs\nrun: pnpm -r test "x"\n',
			),
			[],
		);
	});
});

describe("matchesGlob", () => {
	it("matches a file in the globbed directory", () => {
		assert.equal(
			matchesGlob("scripts/lib/gate-check.test.mjs", "scripts/lib/*.test.mjs"),
			true,
		);
	});

	it("does not let `*` span a directory separator", () => {
		assert.equal(
			matchesGlob("scripts/lib/nested/deep.test.mjs", "scripts/lib/*.test.mjs"),
			false,
		);
	});

	it("does not match a file in a sibling directory", () => {
		assert.equal(
			matchesGlob(
				"scripts/review-measurement.test.mjs",
				"scripts/lib/*.test.mjs",
			),
			false,
		);
	});

	it("treats regex metacharacters in the glob as literals", () => {
		assert.equal(matchesGlob("scripts/a.test.mjs", "scripts/*.test.mjs"), true);
		assert.equal(
			matchesGlob("scripts/axtestxmjs", "scripts/*.test.mjs"),
			false,
		);
	});

	it("lets `**` span directories, matching node --test's own glob semantics", () => {
		assert.equal(
			matchesGlob(
				"scripts/pfdsl/lib/gh-compat.test.mjs",
				"scripts/**/*.test.mjs",
			),
			true,
		);
	});

	it("lets `**` match zero directories too", () => {
		assert.equal(
			matchesGlob(
				"scripts/review-measurement.test.mjs",
				"scripts/**/*.test.mjs",
			),
			true,
		);
	});
});

describe("findUnrunTestFiles", () => {
	it("returns nothing when every file is covered by some glob", () => {
		const files = ["scripts/lib/a.test.mjs", "scripts/pfdsl/lib/b.test.mjs"];
		const globs = ["scripts/lib/*.test.mjs", "scripts/pfdsl/lib/*.test.mjs"];
		assert.deepEqual(findUnrunTestFiles(files, globs), []);
	});

	it("returns the files no glob matches", () => {
		const files = ["scripts/lib/a.test.mjs", "scripts/orphan.test.mjs"];
		assert.deepEqual(findUnrunTestFiles(files, ["scripts/lib/*.test.mjs"]), [
			"scripts/orphan.test.mjs",
		]);
	});

	it("returns every file when the glob list is empty", () => {
		assert.deepEqual(findUnrunTestFiles(["a.test.mjs"], []), ["a.test.mjs"]);
	});
});

describe("the repository's own test globs", () => {
	/** Tracked `*.test.mjs` paths, repo-relative — the set that must all be run. */
	function trackedTestFiles() {
		const stdout = execFileSync("git", ["ls-files", "*.test.mjs"], {
			cwd: root,
			encoding: "utf-8",
		});
		return stdout.split("\n").filter(Boolean);
	}

	const makefile = readFileSync(resolve(root, "Makefile"), "utf-8");
	const workflow = readFileSync(
		resolve(root, ".github/workflows/test.yml"),
		"utf-8",
	);

	it("`make test` runs every tracked *.test.mjs file", () => {
		const unrun = findUnrunTestFiles(
			trackedTestFiles(),
			extractTestGlobs(makefile),
		);
		assert.deepEqual(
			unrun,
			[],
			`Makefile's node --test globs never reach: ${unrun.join(", ")}`,
		);
	});

	it("CI runs every tracked *.test.mjs file", () => {
		const unrun = findUnrunTestFiles(
			trackedTestFiles(),
			extractTestGlobs(workflow),
		);
		assert.deepEqual(
			unrun,
			[],
			`test.yml's node --test globs never reach: ${unrun.join(", ")}`,
		);
	});

	it("CI and `make test` use the same glob set, so a local pass predicts CI", () => {
		assert.deepEqual(extractTestGlobs(workflow), extractTestGlobs(makefile));
	});
});
