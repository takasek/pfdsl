import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";

const entry = new URL("./report-executor-vocabulary.mjs", import.meta.url);
const run = (args) =>
	spawnSync(process.execPath, [entry.pathname, ...args], { encoding: "utf8" });

it("reports only selected files, stays successful on findings, and rejects missing inputs", () => {
	const directory = mkdtempSync(join(tmpdir(), "pfdsl-vocabulary-"));
	try {
		const target = join(directory, "selected.md");
		writeFileSync(
			target,
			"Commit in this PR.\n\n&#80;R uses pull&Tab;request.\n",
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
