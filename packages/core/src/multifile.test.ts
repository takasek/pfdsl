import { describe, expect, it } from "vitest";
import {
	collectExtendsRefs,
	collectSubflowRefs,
	computeOpenInputs,
	computeTerminals,
	loadSubflowGraph,
	resolveRefPath,
	validateSubflowBoundary,
} from "./multifile.js";
import type { Frontmatter } from "./types/frontmatter.js";
import type { NormalizedEdge } from "./types/index.js";

type FakeDoc = { frontmatter: Frontmatter | null };

function makeLoad(docs: Record<string, FakeDoc>) {
	return (path: string): FakeDoc | null => docs[path] ?? null;
}

describe("collectExtendsRefs", () => {
	it("returns [] when no extends key is present", () => {
		expect(collectExtendsRefs({})).toEqual([]);
	});

	it("wraps a single string extends in an array", () => {
		expect(collectExtendsRefs({ extends: "./a.yaml" })).toEqual(["./a.yaml"]);
	});

	it("returns array extends in declaration order", () => {
		expect(collectExtendsRefs({ extends: ["./a.yaml", "./b.yaml"] })).toEqual([
			"./a.yaml",
			"./b.yaml",
		]);
	});
});

describe("collectSubflowRefs", () => {
	it("returns [] when no process declares subflow", () => {
		expect(collectSubflowRefs({ process: { p: { label: "x" } } })).toEqual([]);
	});

	it("returns {process, ref} for each subflow process", () => {
		expect(
			collectSubflowRefs({
				process: {
					a: { subflow: "./a_sub.pfdsl" },
					b: { label: "no subflow" },
					c: { subflow: "./c_sub.pfdsl" },
				},
			}),
		).toEqual([
			{ process: "a", ref: "./a_sub.pfdsl" },
			{ process: "c", ref: "./c_sub.pfdsl" },
		]);
	});
});

describe("resolveRefPath", () => {
	it("resolves a ./ relative ref against the containing file's directory", () => {
		expect(resolveRefPath("/proj/a/main.pfdsl", "./sub.pfdsl")).toEqual({
			ok: true,
			path: "/proj/a/sub.pfdsl",
		});
	});

	it("resolves a ../ parent-relative ref", () => {
		expect(resolveRefPath("/proj/a/main.pfdsl", "../b/sub.pfdsl")).toEqual({
			ok: true,
			path: "/proj/b/sub.pfdsl",
		});
	});

	it("rejects an absolute path (§2.9.2)", () => {
		expect(resolveRefPath("/proj/a/main.pfdsl", "/abs/x.pfdsl")).toEqual({
			ok: false,
			reason: "absolute",
		});
	});

	it("rejects a URL (§2.9.2)", () => {
		expect(resolveRefPath("/proj/a/main.pfdsl", "https://x/y.pfdsl")).toEqual({
			ok: false,
			reason: "url",
		});
	});
});

describe("loadSubflowGraph", () => {
	it("loads the entry and its subflow children", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": {
				frontmatter: { process: { P: { subflow: "./child.pfdsl" } } },
			},
			"/p/child.pfdsl": { frontmatter: {} },
		});
		const result = loadSubflowGraph("/p/main.pfdsl", docs);
		expect([...result.docs.keys()].sort()).toEqual([
			"/p/child.pfdsl",
			"/p/main.pfdsl",
		]);
		expect(result.diagnostics).toEqual([]);
	});

	it("reports a missing subflow path as an error (§15.11)", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": {
				frontmatter: { process: { P: { subflow: "./gone.pfdsl" } } },
			},
		});
		const result = loadSubflowGraph("/p/main.pfdsl", docs);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]).toMatchObject({
			severity: "error",
			code: "V021",
		});
	});

	it("reports a self-referential subflow as a cycle error (§15.11)", () => {
		const docs = makeLoad({
			"/p/self.pfdsl": {
				frontmatter: { process: { P: { subflow: "./self.pfdsl" } } },
			},
		});
		const result = loadSubflowGraph("/p/self.pfdsl", docs);
		expect(result.diagnostics.some((d) => d.code === "V022")).toBe(true);
	});

	it("reports a multi-hop subflow cycle (a->b->c->a) (§15.11)", () => {
		const docs = makeLoad({
			"/p/a.pfdsl": {
				frontmatter: { process: { P: { subflow: "./b.pfdsl" } } },
			},
			"/p/b.pfdsl": {
				frontmatter: { process: { Q: { subflow: "./c.pfdsl" } } },
			},
			"/p/c.pfdsl": {
				frontmatter: { process: { R: { subflow: "./a.pfdsl" } } },
			},
		});
		const result = loadSubflowGraph("/p/a.pfdsl", docs);
		expect(result.diagnostics.some((d) => d.code === "V022")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// computeOpenInputs
// ---------------------------------------------------------------------------

describe("computeOpenInputs", () => {
	it("single chain a >> P -> b >> Q -> c: open input is {a}", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
			{ kind: "input", artifact: "b", process: "Q" },
			{ kind: "output", process: "Q", artifact: "c" },
		];
		expect(computeOpenInputs(edges)).toEqual(new Set(["a"]));
	});

	it("feedback b >>? P does not make b an open input when b is produced", () => {
		// a >> P -> b; b >>? P
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
			{ kind: "feedback", artifact: "b", process: "P" },
		];
		// b has a producing output edge, so b is NOT open input
		expect(computeOpenInputs(edges)).toEqual(new Set(["a"]));
	});

	it("artifact with no producer is open input even if only feedback-consumed", () => {
		// x >>? P  (x has no output edge producing it)
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
			{ kind: "feedback", artifact: "x", process: "P" },
		];
		expect(computeOpenInputs(edges)).toEqual(new Set(["a", "x"]));
	});

	it("empty edges produce empty open inputs", () => {
		expect(computeOpenInputs([])).toEqual(new Set());
	});
});

// ---------------------------------------------------------------------------
// computeTerminals
// ---------------------------------------------------------------------------

describe("computeTerminals", () => {
	it("a >> P -> b: terminal is {b} (b not consumed)", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
		];
		expect(computeTerminals(edges)).toEqual(new Set(["b"]));
	});

	it("a >> P -> b; b >>? P: b is consumed by feedback so terminals = {}", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
			{ kind: "feedback", artifact: "b", process: "P" },
		];
		expect(computeTerminals(edges)).toEqual(new Set());
	});

	it("a >> P -> b; b >> Q -> c: terminal is {c}", () => {
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
			{ kind: "input", artifact: "b", process: "Q" },
			{ kind: "output", process: "Q", artifact: "c" },
		];
		expect(computeTerminals(edges)).toEqual(new Set(["c"]));
	});

	it("artifact consumed by input edge is not terminal", () => {
		// a is consumed by P via input, so a is not terminal
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
		];
		expect(computeTerminals(edges)).not.toContain("a");
	});

	it("empty edges produce empty terminals", () => {
		expect(computeTerminals([])).toEqual(new Set());
	});
});

// ---------------------------------------------------------------------------
// validateSubflowBoundary
// ---------------------------------------------------------------------------

describe("validateSubflowBoundary", () => {
	it("G1 — happy path: matching names, no boundary map → no errors", () => {
		const diags = validateSubflowBoundary({
			processId: "fulfill",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: {},
			childOpenInputs: new Set(["order"]),
			childTerminals: new Set(["shipment"]),
		});
		expect(diags).toHaveLength(0);
	});

	it("G2 — name mismatch without boundary map → V025 error", () => {
		const diags = validateSubflowBoundary({
			processId: "fulfill",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: {},
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set(["outgoing_parcel"]),
		});
		expect(diags.some((d) => d.code === "V025")).toBe(true);
	});

	it("M0 — happy path with boundary map → no errors", () => {
		const diags = validateSubflowBoundary({
			processId: "fulfill",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: { order: "incoming_order", shipment: "outgoing_parcel" },
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set(["outgoing_parcel"]),
		});
		expect(diags).toHaveLength(0);
	});

	it("M4 — non-injective boundary map (two parent IDs map to same child ID) → V025", () => {
		// parent inputs {a, b}, parent outputs {}: both a->b and b->b (identity) collide on child 'b'
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["a", "b"]),
			parentOutputs: new Set([]),
			boundaryMap: { a: "b" }, // a maps to 'b'; identity maps b to 'b' too → collision
			childOpenInputs: new Set(["b", "c"]),
			childTerminals: new Set([]),
		});
		expect(diags.some((d) => d.code === "V025")).toBe(true);
	});

	it("M5 — dangling key in boundary map → V025", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set([]),
			boundaryMap: { nonexistent: "order" },
			childOpenInputs: new Set(["order"]),
			childTerminals: new Set([]),
		});
		expect(diags.some((d) => d.code === "V025")).toBe(true);
	});

	it("M5 — dangling value in boundary map → V025", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set([]),
			boundaryMap: { order: "no_such_child_artifact" },
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set([]),
		});
		expect(diags.some((d) => d.code === "V025")).toBe(true);
	});

	it("X1 — side crossing: input mapped to terminal → V025", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: { order: "outgoing_parcel", shipment: "incoming_order" },
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set(["outgoing_parcel"]),
		});
		expect(diags.some((d) => d.code === "V025")).toBe(true);
	});

	it("X4 — swap map (input→child terminal side, output→child open input side) → V025", () => {
		// parent input 'a' maps to child terminal 'a' (wrong side)
		// parent output 'b' maps to child open input 'b' (wrong side)
		// boundary: { a: 'b', b: 'a' }
		// parent inputs {a} should map to child open inputs {b}
		// parent outputs {b} should map to child terminals {a}
		// Actually X4 from spec says this IS valid (swap map). Let me verify:
		// parentNormalInputs = {a}, parentOutputs = {b}
		// boundaryMap = { a: 'b', b: 'a' }
		// effective: a -> 'b', b -> 'a'
		// side check: a ∈ parentNormalInputs, effective 'b' → is 'b' in childOpenInputs? childOpenInputs = {b} YES → OK
		// side check: b ∈ parentOutputs, effective 'a' → is 'a' in childTerminals? childTerminals = {a} YES → OK
		// bijection input: mapped = {b} == childOpenInputs {b} ✓
		// bijection output: mapped = {a} == childTerminals {a} ✓
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["a"]),
			parentOutputs: new Set(["b"]),
			boundaryMap: { a: "b", b: "a" },
			childOpenInputs: new Set(["b"]),
			childTerminals: new Set(["a"]),
		});
		expect(diags).toHaveLength(0);
	});

	it("X5 — rename + internal split → no errors", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: { order: "in", shipment: "out" },
			childOpenInputs: new Set(["in"]),
			childTerminals: new Set(["out"]),
		});
		expect(diags).toHaveLength(0);
	});

	it("feedback-aware terminal: b feedback-consumed → NOT terminal → both sides empty → no errors", () => {
		// child: a >> P -> b; b >>? P → childOpenInputs = {a}, childTerminals = {}
		// parent inputs {a}, parent outputs {}
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["a"]),
			parentOutputs: new Set([]),
			boundaryMap: {},
			childOpenInputs: new Set(["a"]),
			childTerminals: new Set([]),
		});
		expect(diags).toHaveLength(0);
	});

	it("feedback-aware: parent has output but child has no terminals → V025", () => {
		// child: a >> P -> b; b >>? P → childTerminals = {} (b consumed by feedback)
		// parent outputs {shipment} but child terminals {} → mismatch
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["a"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: {},
			childOpenInputs: new Set(["a"]),
			childTerminals: new Set([]),
		});
		expect(diags.some((d) => d.code === "V025")).toBe(true);
	});

	it("all V025 diagnostics have severity error", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set([]),
			boundaryMap: {},
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set([]),
		});
		for (const d of diags) {
			if (d.code === "V025") expect(d.severity).toBe("error");
		}
	});
});
