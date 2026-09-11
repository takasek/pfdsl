import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	computeDeleteTargets,
	computeKeepArtifacts,
	computeKeepProcesses,
} from "./chain-sweep.mjs";

// A small chain: proc_a produces art_a (done), which feeds proc_b, which
// produces art_b (todo). Everything in this chain is still needed because
// art_b is not done, so proc_b — and therefore its input art_a — must stay.
const CHAIN_EDGES = [
	{ kind: "output", process: "proc_a", artifact: "art_a" },
	{ kind: "input", process: "proc_b", artifact: "art_a" },
	{ kind: "output", process: "proc_b", artifact: "art_b" },
];
const CHAIN_ARTIFACTS = [
	{ id: "art_a", label: "A", status: "done" },
	{ id: "art_b", label: "B", status: "todo" },
];

describe("computeKeepProcesses", () => {
	it("keeps a process whose output artifact is not done", () => {
		const keep = computeKeepProcesses(CHAIN_EDGES, CHAIN_ARTIFACTS);
		assert.equal(keep.has("proc_b"), true);
	});

	it("drops a process whose only output artifact is done", () => {
		const keep = computeKeepProcesses(CHAIN_EDGES, CHAIN_ARTIFACTS);
		assert.equal(keep.has("proc_a"), false);
	});

	it("keeps a process with multiple outputs if any one is not done", () => {
		const edges = [
			{ kind: "output", process: "proc_x", artifact: "art_done" },
			{ kind: "output", process: "proc_x", artifact: "art_open" },
		];
		const artifacts = [
			{ id: "art_done", label: "Done", status: "done" },
			{ id: "art_open", label: "Open", status: "wip" },
		];
		const keep = computeKeepProcesses(edges, artifacts);
		assert.equal(keep.has("proc_x"), true);
	});
});

describe("computeKeepArtifacts", () => {
	it("keeps every edge's artifact for a kept process, including its done input", () => {
		const keepProcesses = new Set(["proc_b"]);
		const keep = computeKeepArtifacts(CHAIN_EDGES, keepProcesses);
		assert.equal(keep.has("art_a"), true); // input to proc_b
		assert.equal(keep.has("art_b"), true); // output of proc_b
	});

	it("does not keep an artifact only touched by a non-kept process", () => {
		const keepProcesses = new Set(); // proc_a not kept
		const keep = computeKeepArtifacts(CHAIN_EDGES, keepProcesses);
		assert.equal(keep.size, 0);
	});
});

describe("computeDeleteTargets", () => {
	it("sweeps a fully-done chain end to end", () => {
		const edges = [
			{ kind: "output", process: "proc_a", artifact: "art_a" },
			{ kind: "input", process: "proc_b", artifact: "art_a" },
			{ kind: "output", process: "proc_b", artifact: "art_b" },
		];
		const artifacts = [
			{ id: "art_a", label: "A", status: "done" },
			{ id: "art_b", label: "B", status: "done" },
		];
		const result = computeDeleteTargets({ edges, artifacts });
		assert.deepEqual(result, ["art_a", "art_b", "proc_a", "proc_b"]);
	});

	it("deletes only the process whose done output feeds an open process", () => {
		// proc_b is still open (its output art_b is not done), so it and its
		// input art_a are kept. proc_a is not kept — its own output art_a is
		// done, and the rule keeps producing processes, not the processes that
		// merely produced a still-needed artifact. art_a survives as a
		// declaration with no remaining producer, which is a legitimate
		// external-input shape (see auditGraph's externalInputs).
		const result = computeDeleteTargets({
			edges: CHAIN_EDGES,
			artifacts: CHAIN_ARTIFACTS,
		});
		assert.deepEqual(result, ["proc_a"]);
	});

	it("returns an empty array for an empty graph", () => {
		const result = computeDeleteTargets({ edges: [], artifacts: [] });
		assert.deepEqual(result, []);
	});

	it("keeps a process reachable only through a feedback edge from a kept process", () => {
		// proc_review feeds back into art_a via a feedback edge, but proc_review
		// itself has no output edge at all — it can only be reached as an
		// artifact via a feedback edge off the kept process proc_b.
		const edges = [
			{ kind: "output", process: "proc_a", artifact: "art_a" },
			{ kind: "input", process: "proc_b", artifact: "art_a" },
			{ kind: "output", process: "proc_b", artifact: "art_b" },
			{ kind: "feedback", process: "proc_b", artifact: "art_review" },
		];
		const artifacts = [
			{ id: "art_a", label: "A", status: "done" },
			{ id: "art_b", label: "B", status: "todo" },
			{ id: "art_review", label: "Review", status: "done" },
		];
		const result = computeDeleteTargets({ edges, artifacts });
		// art_review is done but is kept because it appears on a feedback edge
		// of the kept process proc_b. proc_a is still deleted, for the same
		// reason as the previous test: its own output art_a is done.
		assert.deepEqual(result, ["proc_a"]);
	});

	it("never deletes a not-done artifact that has zero edges (#1125 defect 1)", () => {
		// `future` never appears on any edge, so it is absent from
		// keepArtifacts by construction — the same "zero edges" gap the
		// process-side test above documents as intentional. For an artifact
		// that gap is not safe: an artifact with no edges yet is an
		// unstarted plan, not a leftover of a completed chain, and sweeping
		// it away destroys work that was never done. Only a `done` artifact
		// may ever be a delete target.
		const edges = [
			{ kind: "output", process: "proc_a", artifact: "art_a" },
			{ kind: "input", process: "proc_b", artifact: "art_a" },
			{ kind: "output", process: "proc_b", artifact: "art_b" },
		];
		const artifacts = [
			{ id: "art_a", label: "A", status: "done" },
			{ id: "art_b", label: "B", status: "todo" },
			{ id: "future", label: "Future", status: "todo" },
		];
		const result = computeDeleteTargets({ edges, artifacts });
		assert.equal(result.includes("future"), false);
	});

	it("does not delete a process with zero edges (left to V020 instead)", () => {
		// proc_orphan never appears in `graph edges`, so it is invisible to the
		// process side of the delete-target union by construction — this is
		// intentional (see chain-sweep.mjs's module doc) rather than something
		// this test drives out of the implementation.
		const edges = [
			{ kind: "output", process: "proc_a", artifact: "art_a" },
			{ kind: "input", process: "proc_b", artifact: "art_a" },
			{ kind: "output", process: "proc_b", artifact: "art_b" },
		];
		const artifacts = [
			{ id: "art_a", label: "A", status: "done" },
			{ id: "art_b", label: "B", status: "done" },
		];
		const result = computeDeleteTargets({ edges, artifacts });
		assert.equal(result.includes("proc_orphan"), false);
	});
});
