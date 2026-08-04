import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
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

// End-to-end guards for the parts that only exist at the process boundary: how
// the ref reaches git, and what the scan reports. The pure parsing and
// summarising is covered in lib/review-measurement.test.mjs.
//
// The scan cases run against a repository built here rather than against this
// one. CI checks out with fetch-depth 1, so an assertion anchored to a real
// commit fails there — and a fixture repo holds the exact shape under test (a
// back-merge inside a PR merge) instead of waiting for history to contain one
// by accident.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/review-measurement.mjs");

/** @returns {{status: number, stdout: string, stderr: string}} */
function run(args, cwd = root) {
	try {
		const stdout = execFileSync(process.execPath, [script, ...args], {
			cwd,
			encoding: "utf-8",
			maxBuffer: 32 * 1024 * 1024,
		});
		return { status: 0, stdout, stderr: "" };
	} catch (e) {
		return {
			status: e.status ?? 1,
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? String(e.message),
		};
	}
}

describe("review-measurement CLI argument handling", () => {
	it("does not let a ref reach a shell", () => {
		const marker = resolve(
			tmpdir(),
			`review-measurement-injection-${process.pid}`,
		);
		rmSync(marker, { force: true });

		// The trailing `#` swallows the `..HEAD` the script appends, so a shell
		// would create exactly `marker` rather than a suffixed name.
		const result = run(["--since", `HEAD; touch ${marker} #`]);

		assert.equal(
			existsSync(marker),
			false,
			"the ref was interpreted as a shell command",
		);
		assert.notEqual(
			result.status,
			0,
			"an unusable ref must fail rather than report a clean run",
		);
	});

	it("fails when --since is given without a ref instead of silently dropping the scan", () => {
		const result = run(["--since"]);

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /--since/);
	});
});

describe("review-measurement scan over a built repository", () => {
	/** @type {string} */
	let repo;
	/** @type {Record<string, string>} */
	const sha = {};

	const git = (args) =>
		execFileSync("git", args, {
			cwd: repo,
			encoding: "utf-8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@example.invalid",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@example.invalid",
			},
		});

	const commit = (path, body, message) => {
		mkdirSync(dirname(join(repo, path)), { recursive: true });
		writeFileSync(join(repo, path), body);
		git(["add", "-A"]);
		git(["commit", "-q", "-m", message]);
	};

	before(() => {
		repo = mkdtempSync(join(tmpdir(), "review-measurement-"));
		execFileSync("git", ["init", "-q", "-b", "main", repo], {
			encoding: "utf-8",
		});
		commit("README.md", "start\n", "chore: start");
		sha.base = git(["rev-parse", "HEAD"]).trim();

		// A branch that changes code, back-merges main, then lands on main. The
		// back-merge is the shape the scan must not mistake for a cycle: on it ^1
		// is the branch tip and ^2 is main, so its diff reads as main's changes.
		git(["switch", "-q", "-c", "feature"]);
		commit("scripts/tool.mjs", "// work\n", "feat(scripts): add a tool");
		git(["switch", "-q", "main"]);
		commit("docs/note.md", "prose\n", "docs: unrelated prose");
		git(["switch", "-q", "feature"]);
		git([
			"merge",
			"-q",
			"--no-ff",
			"main",
			"-m",
			"Merge remote-tracking branch 'origin/main' into feature",
		]);
		sha.backMerge = git(["rev-parse", "HEAD"]).trim();
		git(["switch", "-q", "main"]);
		git([
			"merge",
			"-q",
			"--no-ff",
			"feature",
			"-m",
			"Merge pull request #1 from feature",
		]);
		sha.unrecorded = git(["rev-parse", "HEAD"]).trim();

		// A branch that changes code and records a trailer.
		git(["switch", "-q", "-c", "recorded"]);
		writeFileSync(join(repo, "scripts/tool.mjs"), "// more\n");
		git(["add", "-A"]);
		git([
			"commit",
			"-q",
			"-m",
			"feat(scripts): extend the tool\n\nReview-Measurement: sample=in new=1 adopted=1 tool=simplify",
		]);
		git(["switch", "-q", "main"]);
		git([
			"merge",
			"-q",
			"--no-ff",
			"recorded",
			"-m",
			"Merge pull request #2 from recorded",
		]);
		sha.recorded = git(["rev-parse", "HEAD"]).trim();
	});

	after(() => {
		if (repo) rmSync(repo, { recursive: true, force: true });
	});

	it("does not treat a back-merge of main into a branch as a cycle", () => {
		const result = run(["--since", sha.base], repo);

		assert.doesNotMatch(result.stdout, new RegExp(sha.backMerge.slice(0, 7)));
	});

	it("reports a code-changing merge that carries no record", () => {
		const result = run(["--since", sha.base], repo);

		assert.match(
			result.stdout,
			new RegExp(`${sha.unrecorded.slice(0, 7)}.*no record`),
		);
	});

	it("stays silent about a merge that recorded one trailer", () => {
		const result = run(["--since", sha.base], repo);

		assert.doesNotMatch(
			result.stdout,
			new RegExp(`${sha.recorded.slice(0, 7)}.*no record`),
		);
	});

	it("accepts the --since=<ref> form", () => {
		const result = run([`--since=${sha.base}`], repo);

		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(
			result.stdout,
			/pass --since <ref>/,
			"the scan was skipped",
		);
	});
});
