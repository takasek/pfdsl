import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGates } from "./drift-gates.mjs";

/**
 * `staged` names the paths a commit touches; `stagedPresent` narrows that to
 * the ones that still exist, which defaults to all of them.
 * @param {{staged?: string[], stagedPresent?: string[]}} input
 */
function gates({ staged = [], stagedPresent = staged }) {
	return buildGates({ stagedPresent });
}

/** @param {{id: string}[]} built */
function ids(built) {
	return built.map((g) => g.id);
}

describe("buildGates", () => {
	it("always offers the generator gates, whose own triggers decide relevance", () => {
		const built = ids(gates({}));
		assert.deepEqual(built, [
			"pfdsl-snapshots",
			"gen-install",
			"gen-plugin-skill-md",
			"gen-plugin-bulk",
			"samples-dot",
			"samples-svg",
			"readme-cli",
		]);
	});

	it("keeps the generator gates in their load-bearing declaration order", () => {
		const built = ids(gates({}));
		assert.ok(
			built.indexOf("gen-install") < built.indexOf("gen-plugin-skill-md"),
			"gen-install rewrites the tree the gen-plugin gates mirror",
		);
	});

	it("derives one fmt gate per staged operational .pfdsl file", () => {
		const built = gates({
			staged: [".pfdsl/roadmap.pfdsl", ".pfdsl/workflow.pfdsl"],
		});
		const fmt = built.filter((g) => g.id.startsWith("pfdsl-fmt:"));
		assert.deepEqual(ids(fmt), [
			"pfdsl-fmt:.pfdsl/roadmap.pfdsl",
			"pfdsl-fmt:.pfdsl/workflow.pfdsl",
		]);
		assert.deepEqual(fmt[0].commands, [
			[
				"node",
				["packages/cli/dist/cli.js", "fmt", ".pfdsl/roadmap.pfdsl", "--check"],
			],
		]);
		// One gate per file is what keeps the failing file's name in the hint.
		assert.match(fmt[1].hint, /\.pfdsl\/workflow\.pfdsl/);
	});

	it("exempts .pfdsl files outside .pfdsl/ from the fmt gate", () => {
		const built = gates({ staged: ["docs/samples/feature/x.pfdsl"] });
		assert.deepEqual(
			ids(built).filter((id) => id.startsWith("pfdsl-fmt:")),
			[],
		);
	});

	it("derives one md gate carrying every staged .md path as an argument", () => {
		const built = gates({ staged: ["README.md", "docs/spec/spec.md"] });
		const md = built.find((g) => g.id === "md-linebreaks");
		assert.deepEqual(md.commands, [
			[
				"node",
				["scripts/check-md-linebreaks.mjs", "README.md", "docs/spec/spec.md"],
			],
		]);
		// The runner discards command output, so the hint has to be runnable.
		assert.match(md.hint, /README\.md docs\/spec\/spec\.md/);
	});

	it("omits the md gate when no .md file is staged", () => {
		const built = gates({ staged: ["scripts/pre-commit"] });
		assert.equal(
			built.find((g) => g.id === "md-linebreaks"),
			undefined,
		);
	});

	it("omits gates for staged deletions, which have no file to check", () => {
		// check-md-linebreaks.mjs falls back to every tracked .md when given no
		// paths, so a gate built from an empty list would silently widen its scope.
		const built = gates({
			staged: ["README.md", ".pfdsl/roadmap.pfdsl"],
			stagedPresent: [],
		});
		assert.equal(
			built.find((g) => g.id === "md-linebreaks"),
			undefined,
		);
		assert.deepEqual(
			ids(built).filter((id) => id.startsWith("pfdsl-fmt:")),
			[],
		);
	});

	it("still runs the snapshot gate when a .pfdsl file is staged for deletion", () => {
		const built = gates({
			staged: [".pfdsl/roadmap.pfdsl"],
			stagedPresent: [],
		});
		const snapshots = built.find((g) => g.id === "pfdsl-snapshots");
		assert.ok(snapshots.trigger.test(".pfdsl/roadmap.pfdsl"));
	});

	it("makes the fmt gate wait on the CLI dist it reads", () => {
		const built = gates({ staged: [".pfdsl/roadmap.pfdsl"] });
		const fmt = built.find((g) => g.id.startsWith("pfdsl-fmt:"));
		assert.deepEqual(fmt.requireDist, ["packages/cli/dist/cli.js"]);
	});
});
