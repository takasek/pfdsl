import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// End-to-end guards for the parts that only exist at the process boundary:
// how the ref reaches git, and what the exit code says. The pure parsing and
// summarising is covered in lib/review-measurement.test.mjs.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/review-measurement.mjs");

/** @returns {{status: number, stdout: string, stderr: string}} */
function run(args) {
	try {
		const stdout = execFileSync(process.execPath, [script, ...args], {
			cwd: root,
			encoding: "utf-8",
			maxBuffer: 32 * 1024 * 1024,
		});
		return { status: 0, stdout, stderr: "" };
	} catch (e) {
		return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? String(e.message) };
	}
}

describe("review-measurement CLI", () => {
	it("does not let a ref reach a shell", () => {
		const marker = resolve(tmpdir(), `review-measurement-injection-${process.pid}`);
		rmSync(marker, { force: true });

		// The trailing `#` swallows the `..HEAD` the script appends, so a shell
		// would create exactly `marker` rather than a suffixed name.
		const result = run(["--since", `HEAD; touch ${marker} #`]);

		assert.equal(existsSync(marker), false, "the ref was interpreted as a shell command");
		assert.notEqual(result.status, 0, "an unusable ref must fail rather than report a clean run");
	});

	it("fails when --since is given without a ref instead of silently dropping the scan", () => {
		const result = run(["--since"]);

		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /--since/);
	});

	it("accepts the --since=<ref> form", () => {
		const result = run(["--since=HEAD~5"]);

		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(result.stdout, /pass --since <ref>/, "the scan was skipped");
	});

	it("does not treat a back-merge of main into a branch as a cycle", () => {
		// d115b57 is a PR merge whose branch side contains the back-merge 79d8885
		// ("Merge remote-tracking branch 'origin/main' into ..."). On a back-merge
		// ^1 is the branch tip and ^2 is main, so the diff reads as main's changes
		// and ^1..^2 as already-merged commits — it is not a cycle at all.
		const result = run(["--since", "d115b57~1"]);

		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(result.stdout, /79d8885/);
		assert.match(result.stdout, /d115b57/, "PR merges must still be scanned");
	});
});
