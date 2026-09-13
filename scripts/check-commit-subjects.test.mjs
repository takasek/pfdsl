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

	it("names only the rule it enforces when a CJK subject fails", () => {
		// The predicate rejects CJK outside quoted spans and lets other
		// non-English scripts through, so a message promising English would
		// send a reader looking for a check that does not exist.
		const from = headSha(root);
		const head = commit(root, "fix(cli): 直す");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stderr, /CJK/);
		assert.doesNotMatch(r.stderr, /English/);
	});

	it("rejects a subject whose type is preceded by whitespace", () => {
		// git keeps the leading space, and Conventional Commits does not allow
		// it. Trimming each record instead of stripping only its terminator
		// would turn this into a pass, and every other fixture here is clean
		// enough not to notice.
		const from = headSha(root);
		const head = commit(root, " feat(cli): indented");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 1, r.stdout + r.stderr);
		assert.match(r.stdout, /Conventional/);
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

	it("honours a --head that is not the current tip", () => {
		// Every other case names a head that happens to be the tip at the time,
		// so ignoring --head entirely and always using HEAD passes them all.
		// Here the tip carries an invalid subject the chosen range excludes.
		const from = headSha(root);
		const head = commit(root, "chore: chosen head");
		commit(root, "not conventional at the tip");
		const r = runCli(root, ["--base", from, "--head", head]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, /PASS/);
	});

	it("exits 2 when --base is missing", () => {
		const r = runCli(root, []);
		assert.equal(r.status, 2, r.stdout + r.stderr);
	});
});

describe("check-commit-subjects workflow", () => {
	// Compared whole, against the document below, rather than property by
	// property. Enumerating the ways a workflow can stop judging does not
	// terminate: guarding the step's env leaves the job's and the workflow's,
	// rejecting shell operators leaves a template that ignores the script
	// placeholder, and reading the options as a map hides a duplicate whose
	// value is a command substitution. Each of those runs the pull request's
	// own code with the checkout already in place, and each is invisible to an
	// assertion about some other property.
	//
	// The cost is that every edit to this file must be mirrored here, including
	// harmless ones such as spelling out an equivalent shell. For a workflow
	// that executes PR-controlled code, that is the intended trade: the diff
	// says what changed, and a reviewer sees it.
	const EXPECTED = {
		name: "check commit subjects",
		on: {
			// "edited" is not decoration: the default types all track the branch,
			// so retargeting a PR swaps the range without firing the workflow. No
			// paths filter either — the check is about the range, so no path's
			// absence makes it inapplicable.
			pull_request: {
				types: ["opened", "synchronize", "reopened", "edited"],
			},
		},
		// Nothing is used after the clone, and the job runs a script from the
		// pull request's head.
		permissions: { contents: "read" },
		jobs: {
			check: {
				// Named: branch protection identifies a required check by the job's
				// name, and three other workflows here already run a `check`.
				name: "check commit subjects",
				// GitHub-hosted: on a persistent runner the PR's code shares a host
				// that neither of the two settings above protects.
				"runs-on": "ubuntu-latest",
				steps: [
					{
						uses: "actions/checkout@v6",
						with: {
							// Full history, at the head rather than the synthetic merge
							// commit, and no token left on disk.
							"fetch-depth": 0,
							// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not an interpolation
							ref: "${{ github.event.pull_request.head.sha }}",
							"persist-credentials": false,
						},
					},
					{ uses: "actions/setup-node@v6", with: { "node-version": 24 } },
					{
						name: "Lint the branch's commit subjects",
						// origin/<base_ref>, not the payload's base.sha: that value is
						// the base tip as of the event and stops matching the gate's
						// range once the base advances.
						run: 'node scripts/check-commit-subjects.mjs --base "origin/$BASE_REF" --head "$HEAD_SHA"',
						env: {
							// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not an interpolation
							BASE_REF: "${{ github.base_ref }}",
							// biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not an interpolation
							HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
						},
					},
				],
			},
		},
	};

	const workflow = (() => {
		const parsed = parseYaml(
			readFileSync(
				resolve(__dirname, "../.github/workflows/check-commit-subjects.yml"),
				"utf-8",
			),
		);
		// "on:" is the YAML boolean true under some schemas.
		if (true in parsed) {
			parsed.on = parsed[true];
			delete parsed[true];
		}
		return parsed;
	})();
	const job = workflow.jobs?.check ?? {};
	const steps = job.steps ?? [];
	const runSteps = steps.filter((s) => typeof s.run === "string");
	const lint = runSteps[0] ?? {};
	const checkouts = steps.filter((s) =>
		String(s.uses ?? "").startsWith("actions/checkout"),
	);

	// Stated as invariants, alongside the snapshot above. The snapshot rejects
	// any property nobody thought to name, but it is satisfied by an edit that
	// changes the workflow and mirrors the change here in one go. These say
	// what must hold, so relaxing one means writing down that masking or
	// skipping is now allowed — visible as intent in the diff rather than as
	// routine mirroring.
	it("cannot be skipped or have its failure masked", () => {
		for (const owner of [lint, job]) {
			assert.equal(owner.if, undefined);
			assert.ok(
				[undefined, false].includes(owner["continue-on-error"]),
				`continue-on-error must be absent or false, got ${JSON.stringify(owner["continue-on-error"])}`,
			);
		}
		for (const shell of [
			lint.shell,
			workflow.defaults?.run?.shell,
			job.defaults?.run?.shell,
		].filter(Boolean)) {
			// A built-in name, never a custom template. `shell: true {0}` holds
			// no operator and still never runs the script GitHub generates, and
			// the safe custom spellings buy this job nothing.
			assert.ok(
				["bash", "sh", "pwsh", "python", "cmd", "powershell"].includes(shell),
				`only a built-in shell is allowed here, got: ${shell}`,
			);
		}
		// The command itself, not only the shell it runs under: `; true` after
		// the checker discards its status just as surely as a shell template
		// that ignores the script.
		assert.doesNotMatch(lint.run, /[|;&]/);
	});

	it("runs exactly one command, from published actions, on a hosted runner", () => {
		assert.equal(runSteps.length, 1);
		assert.equal(lint.run.trim().replace(/\\\n/g, " ").split("\n").length, 1);
		assert.deepEqual(steps.map((s) => s.uses).filter(Boolean), [
			"actions/checkout@v6",
			"actions/setup-node@v6",
		]);
		assert.ok(
			["ubuntu-latest", "ubuntu-24.04", "ubuntu-22.04"].includes(
				job["runs-on"],
			),
			`unexpected runner: ${job["runs-on"]}`,
		);
		// The whole argv, stated here as well as in the document above. Checking
		// that a correct --base exists is not enough: a second one appended
		// later wins in parseArgs, and `--base "$HEAD_SHA"` turns the range into
		// an empty one that SKIPs at exit 0 while the first, correct option is
		// still there for a regex to find.
		const tokens = lint.run
			.trim()
			.replace(/\\\n/g, " ")
			.split(/\s+/)
			.map((t) => t.replace(/["']/g, "").replace(/\$\{(\w+)}/g, "$$$1"));
		assert.deepEqual(tokens, [
			"node",
			"scripts/check-commit-subjects.mjs",
			"--base",
			"origin/$BASE_REF",
			"--head",
			"$HEAD_SHA",
		]);
	});

	it("hands the PR's own code no credentials and no extra environment", () => {
		assert.equal(checkouts.length, 1);
		assert.equal(String(checkouts[0]?.with?.["persist-credentials"]), "false");
		assert.deepEqual(workflow.permissions, { contents: "read" });
		assert.deepEqual(Object.keys(lint.env ?? {}).sort(), [
			"BASE_REF",
			"HEAD_SHA",
		]);
		assert.equal(workflow.env, undefined);
		assert.equal(job.env, undefined);
	});

	it("judges every pull request, including one that was retargeted", () => {
		assert.deepEqual(Object.keys(workflow.on.pull_request), ["types"]);
		assert.ok(workflow.on.pull_request.types.includes("edited"));
	});
	it("matches the reviewed document exactly", () => {
		const workflow = parseYaml(
			readFileSync(
				resolve(__dirname, "../.github/workflows/check-commit-subjects.yml"),
				"utf-8",
			),
		);
		// "on:" is the YAML boolean true under some schemas.
		if (true in workflow) {
			workflow.on = workflow[true];
			delete workflow[true];
		}
		assert.deepEqual(workflow, EXPECTED);
	});
});
