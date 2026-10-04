import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const script = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"check-pfdsl-inventory.mjs",
);
it("fails the actual inventory command for a newly tracked unclassified file", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pfdsl-inventory-cli-"));
	try {
		execFileSync("git", ["init", "-q", cwd]);
		for (const path of [
			"packages/core/src/__fixtures__/pipeline-scale.pfdsl",
			"packages/new/examples/x.pfdsl",
		]) {
			mkdirSync(dirname(join(cwd, path)), { recursive: true });
			writeFileSync(join(cwd, path), "a >> p -> b\n");
		}
		execFileSync("git", ["add", "."], { cwd });
		const result = spawnSync(process.execPath, [script], {
			cwd,
			encoding: "utf-8",
		});
		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/unclassified.*packages\/new\/examples\/x\.pfdsl/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
