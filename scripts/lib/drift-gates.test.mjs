import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

	it("checks tracked and untracked output for every regenerate-then-check gate", () => {
		const generated = gates({}).filter((gate) => gate.commands.length === 2);
		const identities = generated.filter((gate) =>
			gate.commands.some(([, args]) =>
				args.includes("scripts/check-generated-drift.mjs"),
			),
		);
		const expected = [
			"pfdsl-snapshots",
			"gen-install",
			"gen-plugin-skill-md",
			"gen-plugin-bulk",
			"readme-cli",
		];
		assert.deepEqual(ids(generated), expected);
		assert.deepEqual(ids(identities), expected);
	});

	it("keeps the generator gates in their load-bearing declaration order", () => {
		const built = ids(gates({}));
		assert.ok(
			built.indexOf("gen-install") < built.indexOf("gen-plugin-skill-md"),
			"gen-install rewrites the tree the gen-plugin gates mirror",
		);
	});

	it("reports a changed generated Codex file in a temporary fixture", () => {
		const root = mkdtempSync(join(tmpdir(), "drift-gates-codex-"));
		try {
			mkdirSync(join(root, ".codex"), { recursive: true });
			writeFileSync(join(root, ".codex", "hooks.json"), '{"hooks": []}\n');
			execFileSync("git", ["init", "--quiet"], { cwd: root });
			execFileSync("git", ["add", ".codex/hooks.json"], { cwd: root });
			writeFileSync(join(root, ".codex", "hooks.json"), '{"hooks": [1]}\n');

			const bulk = gates({}).find((gate) => gate.id === "gen-plugin-bulk");
			const [file, args] = bulk.commands.at(-1);
			assert.throws(
				() => execFileSync(file, args, { cwd: root, stdio: "ignore" }),
				(error) => error.status === 1,
			);
			assert.match(bulk.hint, /Claude and Codex outputs/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fires readme-cli for the npm-page README, which the generator also writes", () => {
		const gate = gates({ staged: [] }).find((g) => g.id === "readme-cli");
		assert.ok(gate.trigger.test("packages/cli/README.md"));
		assert.deepEqual(gate.commands.at(-1), [
			"node",
			[
				"scripts/check-generated-drift.mjs",
				"--",
				"README.md",
				"packages/cli/README.md",
			],
		]);
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

	it("derives one check-links gate per staged operational .pfdsl file", () => {
		const built = gates({
			staged: [".pfdsl/roadmap.pfdsl", ".pfdsl/workflow.pfdsl"],
		});
		const links = built.filter((g) => g.id.startsWith("pfdsl-links:"));
		assert.deepEqual(ids(links), [
			"pfdsl-links:.pfdsl/roadmap.pfdsl",
			"pfdsl-links:.pfdsl/workflow.pfdsl",
		]);
		assert.deepEqual(links[0].commands, [
			[
				"node",
				[
					"packages/cli/dist/cli.js",
					"meta",
					"check-links",
					".pfdsl/roadmap.pfdsl",
				],
			],
		]);
		// The hint has to name the file whose location: failed to resolve.
		assert.match(links[1].hint, /\.pfdsl\/workflow\.pfdsl/);
	});

	it("exempts .pfdsl files outside .pfdsl/ from the check-links gate", () => {
		// docs/ teaching material and test fixtures carry location: values that
		// are illustrative, so resolving them is not a property they have.
		const built = gates({ staged: ["docs/samples/16-basepath.pfdsl"] });
		assert.deepEqual(
			ids(built).filter((id) => id.startsWith("pfdsl-links:")),
			[],
		);
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
