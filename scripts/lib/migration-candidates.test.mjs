import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DISTRIBUTION_ROOTS } from "./distribution-review.mjs";
import {
	listMigrationCandidates,
	migrationCandidateGitArgs,
	migrationCandidatePaths,
	parseMigrationCandidateArgs,
} from "./migration-candidates.mjs";

describe("migrationCandidatePaths", () => {
	it("takes the distribution roots from their source and adds the CLI and spec directories", () => {
		assert.deepEqual(migrationCandidatePaths(), [
			...DISTRIBUTION_ROOTS,
			"packages/",
			"docs/spec/",
		]);
	});
});

describe("parseMigrationCandidateArgs", () => {
	it("defaults the end of the interval to HEAD", () => {
		assert.deepEqual(parseMigrationCandidateArgs(["--from", "v0.0.26"]), {
			from: "v0.0.26",
			to: "HEAD",
		});
	});

	it("takes an explicit end", () => {
		assert.deepEqual(
			parseMigrationCandidateArgs(["--from", "v0.0.26", "--to", "dc94909e"]),
			{ from: "v0.0.26", to: "dc94909e" },
		);
	});

	it("requires the start of the interval", () => {
		assert.throws(() => parseMigrationCandidateArgs([]), /--from is required/);
		assert.throws(
			() => parseMigrationCandidateArgs(["--to", "HEAD"]),
			/--from is required/,
		);
		assert.throws(
			() => parseMigrationCandidateArgs(["--from", ""]),
			/--from is required/,
		);
	});

	it("rejects an empty end instead of listing up to HEAD", () => {
		assert.throws(
			() => parseMigrationCandidateArgs(["--from", "v0.0.26", "--to="]),
			/--to must not be empty/,
		);
		assert.throws(
			() => parseMigrationCandidateArgs(["--from", "v0.0.26", "--to", ""]),
			/--to must not be empty/,
		);
	});

	it("rejects a flag given twice instead of keeping the last one", () => {
		assert.throws(
			() => parseMigrationCandidateArgs(["--from", "a", "--from", "b"]),
			/--from was given more than once/,
		);
		assert.throws(
			() =>
				parseMigrationCandidateArgs(["--from", "a", "--to", "b", "--to", "c"]),
			/--to was given more than once/,
		);
	});

	it("rejects unknown flags and positionals instead of skipping them", () => {
		assert.throws(() =>
			parseMigrationCandidateArgs(["--from", "v0.0.26", "--since", "x"]),
		);
		assert.throws(() =>
			parseMigrationCandidateArgs(["--from", "v0.0.26", "x"]),
		);
	});

	it("rejects a revision that git would read as an option", () => {
		assert.throws(
			() => parseMigrationCandidateArgs(["--from=--output=/tmp/x"]),
			/must not start with '-'/,
		);
		assert.throws(
			() => parseMigrationCandidateArgs(["--from", "v0.0.26", "--to=-n"]),
			/must not start with '-'/,
		);
	});
});

describe("migrationCandidateGitArgs", () => {
	it("lists non-merge commits in the interval, limited to the candidate paths", () => {
		assert.deepEqual(
			migrationCandidateGitArgs({ from: "v0.0.26", to: "HEAD" }),
			[
				"log",
				"--no-merges",
				"--format=%h %s",
				"v0.0.26..HEAD",
				"--",
				...migrationCandidatePaths(),
			],
		);
	});
});

describe("listMigrationCandidates", () => {
	it("runs git with separate arguments in the given directory and returns its output", () => {
		const calls = [];
		const out = listMigrationCandidates(
			{ from: "a", to: "b" },
			{
				cwd: "/repo",
				exec: (args, options) => {
					calls.push({ args, options });
					return "abc1234 feat: x\n";
				},
			},
		);

		assert.equal(out, "abc1234 feat: x\n");
		assert.deepEqual(calls, [
			{
				args: migrationCandidateGitArgs({ from: "a", to: "b" }),
				options: { cwd: "/repo" },
			},
		]);
	});
});
