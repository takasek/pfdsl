import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDriftGates } from "./pre-commit-drift.mjs";

/** A gate whose commands always succeed unless `fails` names one of them. */
function gate(id, { trigger = /^src\//, requireDist = [], commands } = {}) {
	return {
		id,
		trigger,
		requireDist,
		commands: commands ?? [["node", [`${id}.mjs`]]],
		hint: `${id} is stale. Regenerate it.`,
	};
}

/**
 * @param {{staged?: string[], stale?: string[], failing?: string[]}} opts
 */
function deps({ staged = ["src/a.js"], stale = [], failing = [] } = {}) {
	const ran = [];
	return {
		ran,
		opts: {
			stagedFiles: staged,
			isDistFresh: (path) => !stale.includes(path),
			runCommand: (file, args) => {
				ran.push([file, ...args].join(" "));
				return !failing.includes(args[0]);
			},
		},
	};
}

describe("runDriftGates", () => {
	it("skips a gate whose trigger matches no staged file", () => {
		const { ran, opts } = deps({ staged: ["docs/x.md"] });
		const result = runDriftGates([gate("alpha")], opts);
		assert.deepEqual(result.failures, []);
		assert.deepEqual(ran, []);
	});

	it("evaluates every later gate after one fails", () => {
		// The reason this module exists: a `exit 1` on the first stale gate hides
		// the rest, so clearing them costs one commit attempt each.
		const { ran, opts } = deps({ failing: ["alpha.mjs"] });
		const result = runDriftGates([gate("alpha"), gate("beta")], opts);
		assert.deepEqual(
			result.failures.map((f) => f.id),
			["alpha"],
		);
		assert.deepEqual(ran, ["node alpha.mjs", "node beta.mjs"]);
	});

	it("collects the hint of every failing gate, in declaration order", () => {
		const { opts } = deps({ failing: ["alpha.mjs", "beta.mjs"] });
		const result = runDriftGates(
			[gate("alpha"), gate("beta"), gate("gamma")],
			opts,
		);
		assert.deepEqual(
			result.failures.map((f) => f.hint),
			["alpha is stale. Regenerate it.", "beta is stale. Regenerate it."],
		);
	});

	it("skips a gate whose required dist is stale, and says so", () => {
		const { ran, opts } = deps({ stale: ["dist/cli.js"] });
		const result = runDriftGates(
			[gate("alpha", { requireDist: ["dist/cli.js"] }), gate("beta")],
			opts,
		);
		assert.deepEqual(result.failures, []);
		assert.deepEqual(ran, ["node beta.mjs"]);
		assert.equal(result.notes.length, 1);
		assert.match(result.notes[0], /dist\/cli\.js/);
	});

	it("stops a gate's own commands at the first failure", () => {
		// The commands of one gate were a shell `&&` chain: regenerate, then diff.
		// Running the diff after a failed regeneration would report the wrong file.
		const { ran, opts } = deps({ failing: ["gen.mjs"] });
		const result = runDriftGates(
			[
				gate("alpha", {
					commands: [
						["node", ["gen.mjs"]],
						["git", ["diff", "--quiet"]],
					],
				}),
			],
			opts,
		);
		assert.deepEqual(
			result.failures.map((f) => f.id),
			["alpha"],
		);
		assert.deepEqual(ran, ["node gen.mjs"]);
	});

	it("matches a trigger against any staged file, not just the first", () => {
		const { ran, opts } = deps({ staged: ["docs/x.md", "src/a.js"] });
		runDriftGates([gate("alpha")], opts);
		assert.deepEqual(ran, ["node alpha.mjs"]);
	});
});
