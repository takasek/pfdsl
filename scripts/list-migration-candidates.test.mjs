import assert from "node:assert/strict";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { git, tryRun, withoutGitTargetEnvironment } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = {
	...withoutGitTargetEnvironment(),
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_COUNT: "0",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

let fixture;
let expected;
let afterEnd;

const fixtureGit = (args) => git(args, { cwd: fixture, env });
const listing = (args, extraEnv = {}) =>
	tryRun(
		process.execPath,
		[join(fixture, "scripts/list-migration-candidates.mjs"), ...args],
		{
			// The command must use the repository beside its own file, not cwd.
			cwd: tmpdir(),
			captureStderr: true,
			env: { ...env, ...extraEnv },
		},
	);

function commit(subject, paths) {
	for (const path of paths) {
		const target = join(fixture, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, `${subject}\n`);
	}
	fixtureGit(["add", "."]);
	fixtureGit(["commit", "-m", subject]);
	return { hash: fixtureGit(["rev-parse", "HEAD"]).trim(), subject };
}

function assertListing(result, commits, length) {
	assert.equal(result.status, 0, result.out);
	const lines = result.out.trim().split("\n").filter(Boolean);
	assert.equal(lines.length, commits.length, result.out);
	const matched = new Set();
	for (const line of lines) {
		const space = line.indexOf(" ");
		const hash = line.slice(0, space);
		const subject = line.slice(space + 1);
		assert.match(hash, /^[0-9a-f]+$/);
		if (length !== undefined) assert.equal(hash.length, length);
		const match = commits.find(
			(commit) => commit.hash.startsWith(hash) && commit.subject === subject,
		);
		assert.ok(match, `Unexpected candidate: ${line}`);
		assert.ok(!matched.has(match.hash), `Duplicate candidate: ${line}`);
		matched.add(match.hash);
	}
}

describe("list-migration-candidates in a dependency-free Git fixture", () => {
	before(() => {
		fixture = mkdtempSync(join(tmpdir(), "migration-candidates-"));
		mkdirSync(join(fixture, "scripts"));
		cpSync(
			join(root, "scripts/list-migration-candidates.mjs"),
			join(fixture, "scripts/list-migration-candidates.mjs"),
		);
		// Copy the real implementation; a symlink could resolve dependencies in
		// the developer's checkout and hide an accidental generator import.
		cpSync(join(root, "scripts/lib"), join(fixture, "scripts/lib"), {
			recursive: true,
		});
		assert.equal(existsSync(join(fixture, "node_modules")), false);
		fixtureGit(["init", "--initial-branch=fixture-main"]);
		commit("chore: bootstrap", ["fixture.txt"]);
		commit("feat: before interval", ["plugin/pfdsl/before.md"]);
		commit("feat: exclusive start", ["docs/spec/start.md"]);
		fixtureGit(["tag", "fixture-start"]);
		fixtureGit(["branch", "fixture-side"]);

		// Author the expected set from the scenario, not the production paths or
		// Git argument builder. Ordinary subjects must qualify too.
		expected = [
			commit("fix: Claude prompt", ["plugin/pfdsl/skills/demo/SKILL.md"]),
			commit("fix: Codex hook", ["plugin/pfdsl-codex/hooks/demo.mjs"]),
			commit("feat!: package change", ["packages/cli/src/demo.ts"]),
			commit("docs: specification", ["docs/spec/demo.md"]),
			commit("fix: mixed paths", ["plugin/pfdsl/mixed.md", "docs/mixed.md"]),
		];
		commit("chore: outside roots", [
			"scripts/unrelated.mjs",
			"docs/usage.md",
			"plugin/pfdsl-other/demo.md",
			"packages-other/demo.ts",
			"docs/spec-other/demo.md",
		]);
		fixtureGit(["switch", "fixture-side"]);
		expected.push(commit("fix: side branch", ["plugin/pfdsl/side.md"]));
		fixtureGit(["switch", "fixture-main"]);
		fixtureGit(["merge", "--no-ff", "--no-commit", "fixture-side"]);
		// A merge-only target change makes removal of --no-merges observable.
		commit("merge: excluded", ["plugin/pfdsl/merge-only.md"]);
		expected.push(commit("fix: inclusive end", ["packages/cli/end.ts"]));
		fixtureGit(["tag", "fixture-end"]);
		afterEnd = commit("feat: after interval", ["plugin/pfdsl/after.md"]);
	});

	after(() => {
		if (fixture) rmSync(fixture, { recursive: true, force: true });
	});

	for (const [label, args, message] of [
		["missing start", [], /--from is required/],
		["unknown flag", ["--from", "HEAD", "--since", "HEAD"], /usage:/],
		["empty end", ["--from", "HEAD", "--to="], /--to must not be empty/],
		["repeated start", ["--from", "a", "--from", "b"], /more than once/],
		["option-like revision", ["--from=--all"], /must not start/],
	]) {
		it(`rejects ${label} with exit 2 without installed dependencies`, () => {
			const result = listing(args);
			assert.equal(result.status, 2, result.out);
			assert.match(result.out, message);
		});
	}

	it("lists an empty interval as no output", () => {
		const result = listing(["--from", "fixture-end", "--to", "fixture-end"]);
		assert.equal(result.status, 0, result.out);
		assert.equal(result.out, "");
	});

	it("reports an unknown revision with exit 1", () => {
		const result = listing(["--from", "no-such-revision-for-this-test"]);
		assert.equal(result.status, 1, result.out);
		assert.match(result.out, /error: could not list/);
	});

	for (const [label, extraEnv, length] of [
		["default abbreviations", {}, undefined],
		[
			"core.abbrev=12",
			{
				GIT_CONFIG_COUNT: "1",
				GIT_CONFIG_KEY_0: "core.abbrev",
				GIT_CONFIG_VALUE_0: "12",
			},
			12,
		],
	]) {
		it(`includes exactly the target commits in the interval with ${label}`, () => {
			assertListing(
				listing(["--from", "fixture-start", "--to", "fixture-end"], extraEnv),
				expected,
				length,
			);
		});
	}

	it("defaults the inclusive end to HEAD", () => {
		assertListing(listing(["--from", "fixture-start"]), [
			...expected,
			afterEnd,
		]);
	});
});
