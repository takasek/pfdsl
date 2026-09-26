// `make gen-plugin` used to run gen-skill and gen-install as prerequisites and then gen-plugin.mjs, which runs both again inside its lock and snapshot (#1208 R1).
// The first pass wrote SKILL.md and install/ outside the lock, so it raced a concurrent generator and a failed run restored the half-regenerated state instead of the one before it.
// This test reads the recipe `make -n` would run.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} target */
function dryRun(target) {
	return execFileSync("make", ["-n", target], { cwd: root, encoding: "utf8" })
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

const runs = (script) => (line) => line.startsWith(`node scripts/${script}`);

describe("make gen-plugin", () => {
	const recipe = dryRun("gen-plugin");

	it("generates once, inside gen-plugin.mjs's lock and snapshot", () => {
		assert.equal(recipe.filter(runs("gen-plugin.mjs")).length, 1);
		assert.deepEqual(recipe.filter(runs("gen-skill.mjs")), []);
		assert.deepEqual(recipe.filter(runs("gen-install.mjs")), []);
	});

	it("still runs the check-docs suite first", () => {
		const docs = dryRun("check-docs");
		const generate = recipe.findIndex(runs("gen-plugin.mjs"));
		for (const line of docs.filter((l) => l.startsWith("node scripts/"))) {
			const at = recipe.indexOf(line);
			assert.ok(at >= 0 && at < generate, `${line} runs before generation`);
		}
	});

	it("keeps gen-skill and gen-install as standalone entry points", () => {
		assert.equal(dryRun("gen-skill").filter(runs("gen-skill.mjs")).length, 1);
		assert.equal(
			dryRun("gen-install").filter(runs("gen-install.mjs")).length,
			1,
		);
	});
});
