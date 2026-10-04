import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	classifyTrackedPfdsl,
	pfdslCheckPlan,
} from "./pfdsl-check-inventory.mjs";

const scaffold =
	"scripts/harness-template/skills/pfd-ops/references/scaffold/roadmap.pfdsl";
const fixture = "packages/core/src/__fixtures__/pipeline-scale.pfdsl";
const paths = [
	".pfdsl/workflow.pfdsl",
	"docs/samples/a.pfdsl",
	scaffold,
	fixture,
];

describe("tracked PFD check inventory", () => {
	it("keeps graph, formatting, rendering and location axes separate", () => {
		const inventory = classifyTrackedPfdsl(paths);
		assert.deepEqual(inventory.errors, []);
		assert.deepEqual(pfdslCheckPlan(inventory, "operational"), [
			{ path: paths[0], args: ["check", paths[0]] },
		]);
		assert.deepEqual(pfdslCheckPlan(inventory, "scaffold"), [
			{ path: scaffold, args: ["check", scaffold, "--strict"] },
		]);
		assert.deepEqual(
			pfdslCheckPlan(inventory, "docs").map((item) => item.args[0]),
			["check", "render"],
		);
		assert.deepEqual(
			pfdslCheckPlan(inventory, "fmt").map((item) => item.path),
			[paths[0], scaffold],
		);
		assert.deepEqual(
			pfdslCheckPlan(inventory, "links").map((item) => item.path),
			[paths[0]],
		);
	});
	it("rejects an unclassified new package root", () => {
		assert.match(
			classifyTrackedPfdsl([
				...paths,
				"packages/new/examples/x.pfdsl",
			]).errors.join("\n"),
			/unclassified.*packages\/new/,
		);
	});
	it("does not let a source declaration removal erase a tracked generated file", () => {
		const mirror = ".agents/skills/pfd-ops/references/scaffold/roadmap.pfdsl";
		assert.match(
			classifyTrackedPfdsl([fixture, mirror]).errors.join("\n"),
			/missing.*source/,
		);
	});
	it("records generated delegation for all four targets without validating them twice", () => {
		for (const prefix of [
			".claude",
			".agents",
			"plugin/pfdsl",
			"plugin/pfdsl-codex",
		]) {
			const mirror = `${prefix}/skills/pfd-ops/references/scaffold/roadmap.pfdsl`;
			const inventory = classifyTrackedPfdsl([...paths, mirror]);
			assert.deepEqual(inventory.errors, []);
			assert.equal(
				inventory.entries.find((item) => item.path === mirror).source,
				scaffold,
			);
			assert.equal(pfdslCheckPlan(inventory, "scaffold").length, 1);
		}
	});
	it("records the fixture's package-level scope and rejects stale or overlapping assignments", () => {
		assert.match(
			classifyTrackedPfdsl(paths).entries.find((item) => item.path === fixture)
				.owner,
			/index\.test\.ts/,
		);
		assert.match(
			classifyTrackedPfdsl([]).errors.join("\n"),
			/stale.*core-fixture/,
		);
		const rule = { id: "duplicate", pattern: /\.pfdsl$/, checks: [] };
		assert.match(
			classifyTrackedPfdsl(paths, [rule, rule]).errors.join("\n"),
			/ambiguous/,
		);
	});
	it("rejects a requested check that would silently check nothing", () => {
		assert.throws(
			() => pfdslCheckPlan(classifyTrackedPfdsl([fixture]), "links"),
			/no classified/,
		);
		assert.throws(
			() => pfdslCheckPlan(classifyTrackedPfdsl(paths), "unknown"),
			/unknown scope/,
		);
	});
});
