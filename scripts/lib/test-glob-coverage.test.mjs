import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
	extractEntrypointTestGlobs,
	extractTestGlobs,
	findUnrunTestFiles,
	matchesGlob,
} from "./test-glob-coverage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("extractEntrypointTestGlobs", () => {
	const packages = [
		{ path: "packages/app", testScript: 'node --test "test/*.test.mjs"' },
		{ path: "packages/library", testScript: "vitest run --coverage" },
	];
	it("includes workspace test scripts at their package working directories", () => {
		assert.deepEqual(
			extractEntrypointTestGlobs(
				["pnpm -r test", 'node --test "scripts/*.test.mjs"'],
				packages,
			),
			["packages/app/test/*.test.mjs", "scripts/*.test.mjs"],
		);
	});
	it("does not credit workspace tests when the entrypoint does not run them", () => {
		assert.deepEqual(
			extractEntrypointTestGlobs(
				["pnpm -r build", 'node --test "scripts/*.test.mjs"'],
				packages,
			),
			["scripts/*.test.mjs"],
		);
	});
	it("retains duplicate execution paths so the repository check can reject them", () => {
		assert.deepEqual(
			extractEntrypointTestGlobs(
				["pnpm -r test", 'node --test "packages/app/test/*.test.mjs"'],
				packages,
			),
			["packages/app/test/*.test.mjs", "packages/app/test/*.test.mjs"],
		);
	});
});

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
			matchesGlob("scripts/gate-check.test.mjs", "scripts/lib/*.test.mjs"),
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
			matchesGlob("scripts/gate-check.test.mjs", "scripts/**/*.test.mjs"),
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
	/** Tracked Node test paths, repo-relative — each must run once per entrypoint. */
	function trackedTestFiles() {
		const stdout = execFileSync(
			"git",
			["ls-files", "*.test.mjs", "*.test.cjs"],
			{
				cwd: root,
				encoding: "utf-8",
			},
		);
		return stdout.split("\n").filter(Boolean);
	}

	const makefile = readFileSync(resolve(root, "Makefile"), "utf-8");
	const recipe = /^test:[^\n]*\n((?:\t[^\n]*\n)*)/m.exec(makefile);
	assert.ok(recipe, "Makefile must declare the test recipe");
	const makeCommands = recipe[1]
		.trim()
		.split("\n")
		.map((line) => line.trim());
	const workflow = parse(
		readFileSync(resolve(root, ".github/workflows/test.yml"), "utf-8"),
	);
	const workflowCommands = workflow.jobs.test.steps.flatMap((step) =>
		step.run ? step.run.split("\n") : [],
	);
	const workspacePackages = JSON.parse(
		execFileSync("pnpm", ["-r", "list", "--depth", "-1", "--json"], {
			cwd: root,
			encoding: "utf8",
		}),
	).map(({ path }) => ({
		path: relative(root, path).replaceAll("\\", "/"),
		testScript:
			JSON.parse(readFileSync(resolve(path, "package.json"), "utf8")).scripts
				?.test ?? "",
	}));
	const entrypoints = [
		["make test", makeCommands],
		["CI", workflowCommands],
	].map(([name, commands]) => ({
		name,
		globs: extractEntrypointTestGlobs(commands, workspacePackages),
	}));

	for (const { name, globs } of entrypoints) {
		it(`${name} runs every tracked Node test exactly once`, () => {
			const unexpected = trackedTestFiles().flatMap((file) => {
				const runs = globs.filter((glob) => matchesGlob(file, glob)).length;
				return runs === 1 ? [] : [{ file, runs }];
			});
			assert.deepEqual(
				unexpected,
				[],
				`${name}: missing or repeated test files`,
			);
		});
	}

	it("CI and `make test` use the same glob set, so a local pass predicts CI", () => {
		assert.deepEqual(entrypoints[1].globs, entrypoints[0].globs);
	});
});
