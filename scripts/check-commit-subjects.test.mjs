/**
 * The CLI's process boundary: exit codes and argument wiring.
 *
 * The shared checker has its own tests, but they call the function. CI judges
 * this script by its exit code alone, so a missing `process.exit(1)` would
 * print a FAIL line and still report success — every function-level test would
 * stay green while the check stopped blocking anything (#1174).
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { makeGitRepository } from "./lib/git-test-repository.test-helper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "check-commit-subjects.mjs");

/**
 * git with an identity supplied per command: a test machine need not have one
 * configured, and the throwaway repository's own config stays untouched.
 */
function git(root, args) {
	return execFileSync(
		"git",
		["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
		{ cwd: root, encoding: "utf-8" },
	);
}

function headSha(root) {
	return git(root, ["rev-parse", "HEAD"]).trim();
}

/** Commit with an exact subject. */
function commit(root, subject) {
	git(root, [
		"commit",
		"--allow-empty",
		"--allow-empty-message",
		"-m",
		subject,
	]);
	return headSha(root);
}

/** @returns {{status: number, stdout: string, stderr: string}} */
function runCli(cwd, args) {
	const r = spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf-8",
	});
	return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe("check-commit-subjects CLI", () => {
	/** @type {string} */
	let root;
	/** @type {string} */
	let base;

	before(() => {
		root = makeGitRepository({ prefix: "check-commit-subjects-" });
		base = commit(root, "chore: base");
	});

	after(() => rmSync(root, { recursive: true, force: true }));

	it("exits 0 on a range whose subjects all pass", () => {
		const head = commit(root, "feat(cli): add a thing");
		const r = runCli(root, ["--base", base, "--head", head]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /PASS/);
	});

	it("exits 1 on a non-Conventional subject", () => {
		const from = headSha(root);
		const head = commit(root, "add a thing");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stdout, /FAIL/);
		assert.match(r.stdout, /add a thing/);
	});

	it("exits 1 on a commit with an empty subject", () => {
		const from = headSha(root);
		const head = commit(root, "");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
	});

	it("exits 1 when the range cannot be read", () => {
		const r = runCli(root, ["--base", "origin/does-not-exist"]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
	});

	it("exits 0 and reports SKIP on an empty range", () => {
		const head = headSha(root);
		const r = runCli(root, ["--base", head, "--head", head]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /SKIP/);
	});

	it("FAILs on a subject reachable only through a merge's side parent", () => {
		// --no-merges drops the merge commit itself, which git wrote; it must
		// not drop what the merge brought in. A traversal-narrowing option such
		// as --first-parent would, and every argv assertion elsewhere is on the
		// options rather than on the commits that survive them.
		const from = headSha(root);
		git(root, ["checkout", "-q", "-b", "side"]);
		commit(root, "add a side thing");
		git(root, ["checkout", "-q", "-"]);
		git(root, ["merge", "--no-ff", "-m", "chore: merge side", "side"]);
		const r = runCli(root, ["--base", from, "--head", headSha(root)]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stdout, /add a side thing/);
	});

	it("exits 2 on an unknown flag even when the range is complete", () => {
		// A bare --nope would exit 2 through the missing-base branch too, so
		// dropping `strict: true` would leave that version of this test green
		// while a typo'd --head was silently ignored and the default HEAD
		// linted instead.
		const head = headSha(root);
		const r = runCli(root, ["--base", head, "--head", head, "--nope"]);
		assert.equal(r.status, 2, r.stdout + r.stderr);
		assert.match(r.stderr, /Unknown option/);
	});

	it("exits 2 on a misspelled --head rather than linting the default range", () => {
		const head = headSha(root);
		const r = runCli(root, ["--base", head, "--hed", head]);
		assert.equal(r.status, 2, r.stdout + r.stderr);
		assert.match(r.stderr, /Unknown option/);
	});

	it("defaults --head to HEAD rather than to some other ref", () => {
		// Every other case names --head, so changing the default to any resolvable
		// ref would keep them green while a range that ends somewhere other than
		// the branch tip was linted — and an invalid subject on the tip would be
		// reported as an empty range.
		const from = headSha(root);
		commit(root, "add an untipped thing");
		const r = runCli(root, ["--base", from]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stdout, /add an untipped thing/);
	});

	it("exits 2 when --base is missing", () => {
		const r = runCli(root, []);
		assert.equal(r.status, 2, r.stdout + r.stderr);
	});
});

describe("check-commit-subjects workflow", () => {
	// The workflow is the only place the range definition and the trigger set
	// live, and nothing else in this suite reads it: dropping `edited` from the
	// types, or the checkout depth, breaks the check while every unit test
	// stays green.
	const workflow = parseYaml(
		readFileSync(
			resolve(__dirname, "../.github/workflows/check-commit-subjects.yml"),
			"utf-8",
		),
	);
	// `on:` is the YAML boolean true once parsed.
	const trigger = workflow[true] ?? workflow.on;
	const steps = workflow.jobs.check.steps;
	const checkout = steps.find((s) =>
		String(s.uses ?? "").startsWith("actions/checkout"),
	);
	const lint = steps.find((s) => typeof s.run === "string");
	// The run step is compared as tokens rather than as text: the folded
	// scalar's line breaks and the shell quoting around each value are free to
	// change without changing what runs.
	const runTokens = lint.run
		.trim()
		.split(/\s+/)
		.map((t) => t.replace(/^["']|["']$/g, ""));

	it("reruns when the base changes, not only when the branch does", () => {
		assert.deepEqual([...trigger.pull_request.types].sort(), [
			"edited",
			"opened",
			"reopened",
			"synchronize",
		]);
	});

	it("checks out full history at the PR head so a range can be formed", () => {
		// Number(), not a strict compare against 0: `fetch-depth: "0"` is valid
		// YAML and means the same thing to the action, so a quoting change must
		// not turn CI red.
		assert.equal(Number(checkout.with["fetch-depth"]), 0);
		assert.match(checkout.with.ref, /pull_request\.head\.sha/);
	});

	it("ranges from the live base ref to the head SHA", () => {
		assert.deepEqual(runTokens, [
			"node",
			"scripts/check-commit-subjects.mjs",
			"--base",
			"origin/$BASE_REF",
			"--head",
			"$HEAD_SHA",
		]);
		// Exact, not "mentions head.sha": an expression such as
		// `head.sha && base.sha` names it and still evaluates to the base SHA,
		// which makes the range empty and every commit SKIP at exit 0.
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not an interpolation
		assert.equal(lint.env.BASE_REF, "${{ github.base_ref }}");
		assert.equal(
			lint.env.HEAD_SHA,
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not an interpolation
			"${{ github.event.pull_request.head.sha }}",
		);
		// The tokens above are compared with their quotes stripped, so the
		// quoting itself is asserted here: single quotes keep Bash from
		// expanding these, and the checker would be handed the literal text.
		assert.match(lint.run, /--base "origin\/\$BASE_REF"/);
		assert.match(lint.run, /--head "\$HEAD_SHA"/);
	});

	it("lets the checker's exit code decide the job", () => {
		// A run step is shell, so the verdict can be discarded in passing: an
		// appended `|| true`, or a swap to `echo`, keeps every argument in place
		// while the job reports success on a FAIL. Asserting the exact token
		// list above already pins the program; this states the reason, and
		// catches an operator appended anywhere in the line.
		for (const operator of ["||", "&&", ";", "|"]) {
			assert.ok(
				!runTokens.includes(operator),
				`the run step must not mask the checker's exit code; found ${operator}`,
			);
		}
	});
});
