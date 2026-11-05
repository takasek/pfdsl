import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { withIndexSnapshot } from "./lib/index-snapshot.mjs";

const entry = new URL("./report-executor-vocabulary.mjs", import.meta.url);
const run = (args) =>
	spawnSync(process.execPath, [entry.pathname, ...args], { encoding: "utf8" });

it("fails check mode on the historical protocol and passes the cleaned canonical protocol", () => {
	const before = run([
		"--check",
		"--json",
		"scripts/lib/fixtures/executor-protocol/work-cycle-before-1504.md",
	]);
	assert.equal(before.status, 1, before.stderr);
	assert.ok(JSON.parse(before.stdout).findings.length > 0);
	const after = run(["--check", "--json"]);
	assert.equal(after.status, 0, after.stderr);
	assert.deepEqual(JSON.parse(after.stdout), {
		files: ["scripts/harness-template/skills/pfd-ops/references/work-cycle.md"],
		findings: [],
	});
	const missing = run(["--check", "does-not-exist-protocol.md"]);
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /ENOENT/);
});

it("checks staged protocol content despite an opposite unstaged edit", () => {
	const directory = mkdtempSync(join(tmpdir(), "pfdsl-protocol-index-"));
	const path = "protocol.md";
	try {
		execFileSync("git", ["init", "--quiet"], { cwd: directory });
		mkdirSync(join(directory, "packages/core"), { recursive: true });
		writeFileSync(
			join(directory, "packages/core/package.json"),
			'{"name":"@pfdsl/core"}\n',
		);
		for (const [staged, unstaged, status] of [
			["Commit the PR.\n", "Verify artifact criteria.\n", 1],
			["Verify artifact criteria.\n", "Commit the PR.\n", 0],
		]) {
			writeFileSync(join(directory, path), staged);
			execFileSync("git", ["add", "."], { cwd: directory });
			writeFileSync(join(directory, path), unstaged);
			withIndexSnapshot(directory, (snapshot) => {
				const result = run(["--check", "--json", join(snapshot, path)]);
				assert.equal(result.status, status, result.stderr);
				assert.equal(JSON.parse(result.stdout).findings.length, status);
			});
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

it("reports only selected files, stays successful on findings, and rejects missing inputs", () => {
	const directory = mkdtempSync(join(tmpdir(), "pfdsl-vocabulary-"));
	try {
		const target = join(directory, "selected.md");
		writeFileSync(
			target,
			"Commit in this PR.\n\n&#80;R uses pull&Tab;request.\n\npull`unrelated`request.\n",
		);
		writeFileSync(join(directory, "not-selected.md"), "Use TDD.\n");
		const result = run(["--json", target]);
		assert.equal(result.status, 0, result.stderr);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.files.length, 1);
		assert.equal(parsed.findings.length, 2);
		assert.deepEqual(parsed.findings[0].terms, ["Commit", "PR"]);
		assert.deepEqual(parsed.findings[1].terms, ["PR", "pull\trequest"]);
		assert.equal(parsed.findings[1].line, 3);
		assert.equal(parsed.findings[1].column, 1);
		assert.equal(parsed.findings[1].text, "&#80;R uses pull&Tab;request.");
		assert.equal(run([target]).status, 0);
		assert.notEqual(run([join(directory, "missing.md")]).status, 0);
		assert.notEqual(run(["--unknown"]).status, 0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
