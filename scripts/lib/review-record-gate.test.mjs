import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	diffBase,
	EMPTY_TREE,
	evaluateRecordGate,
} from "./review-record-gate.mjs";

describe("diffBase", () => {
	it("uses the recorded commit", () => {
		assert.equal(diffBase({ commit: "a".repeat(40) }), "a".repeat(40));
	});

	it("falls back to the empty tree when nothing has been recorded yet", () => {
		assert.equal(diffBase({ commit: null }), EMPTY_TREE);
		assert.equal(diffBase({}), EMPTY_TREE);
		assert.equal(diffBase(null), EMPTY_TREE);
	});
});

describe("evaluateRecordGate", () => {
	const inScope = (path) => path.endsWith(".md");

	const deps = ({ record, changed = [], reachable = true }) => ({
		readRecord: () => record,
		commitExists: () => reachable,
		changedSince: () => changed,
		inScope,
	});

	it("is ok when nothing in scope changed since the recorded commit", () => {
		const result = evaluateRecordGate(
			deps({
				record: { commit: "a".repeat(40) },
				changed: ["packages/cli/src/cli.ts"],
			}),
		);
		assert.equal(result.ok, true);
		assert.deepEqual(result.files, []);
	});

	it("defaults the threshold to 1, so a single in-scope change trips it", () => {
		const result = evaluateRecordGate(
			deps({
				record: { commit: "a".repeat(40) },
				changed: ["docs/one.md"],
			}),
		);
		assert.equal(result.ok, false);
		assert.deepEqual(result.files, ["docs/one.md"]);
	});

	it("is ok while the in-scope count stays under a caller-supplied threshold", () => {
		const result = evaluateRecordGate({
			...deps({
				record: { commit: "a".repeat(40) },
				changed: ["docs/one.md", "docs/two.md"],
			}),
			threshold: 3,
		});
		assert.equal(result.ok, true);
		assert.deepEqual(result.files, ["docs/one.md", "docs/two.md"]);
	});

	it("trips once the in-scope count reaches a caller-supplied threshold", () => {
		const result = evaluateRecordGate({
			...deps({
				record: { commit: "a".repeat(40) },
				changed: ["docs/one.md", "docs/two.md", "docs/three.md"],
			}),
			threshold: 3,
		});
		assert.equal(result.ok, false);
		assert.equal(result.files.length, 3);
	});

	it("falls back to the empty tree when the record is absent, rather than treating absence as approval", () => {
		const result = evaluateRecordGate(
			deps({ record: null, changed: ["docs/one.md"] }),
		);
		assert.equal(result.base, EMPTY_TREE);
		assert.equal(result.ok, false);
	});

	it("reports unreachable, fail-closed, when the recorded commit is not in this clone", () => {
		// A shallow clone or a squash-merged branch can leave the recorded
		// commit unreachable. Passing there would approve by accident.
		const result = evaluateRecordGate(
			deps({ record: { commit: "b".repeat(40) }, reachable: false }),
		);
		assert.equal(result.ok, false);
		assert.equal(result.unreachable, true);
		assert.equal(result.base, "b".repeat(40));
	});

	it("does not probe reachability of the empty tree", () => {
		let probed = false;
		const result = evaluateRecordGate({
			readRecord: () => ({ commit: null }),
			commitExists: () => {
				probed = true;
				return false;
			},
			changedSince: () => [],
			inScope,
		});
		assert.equal(probed, false);
		assert.equal(result.ok, true);
		assert.equal(result.unreachable, false);
	});

	it("filters changedSince's output through inScope before counting", () => {
		const result = evaluateRecordGate(
			deps({
				record: { commit: "a".repeat(40) },
				changed: ["docs/one.md", "packages/cli/src/cli.ts"],
			}),
		);
		assert.deepEqual(result.files, ["docs/one.md"]);
	});
});
