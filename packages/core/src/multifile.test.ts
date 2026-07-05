import { describe, expect, it } from "vitest";
import {
	buildPresentationChain,
	collectExtendsRefs,
	collectSubflowRefs,
	computeOpenInputs,
	computeTerminals,
	loadExtendsChain,
	loadSubflowGraph,
	resolvePresentation,
	resolveRefPath,
	validatePresetKeys,
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

	it("artifact with no producer consumed ONLY by feedback is NOT an open input (§2.9.3 symmetric feedback exclusion)", () => {
		// x >>? P  (x has no producer and only a feedback consumer)
		// x is a cross-cutting loop element, not part of the boundary contract
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
			{ kind: "feedback", artifact: "x", process: "P" },
		];
		expect(computeOpenInputs(edges)).toEqual(new Set(["a"]));
	});

	it("artifact with no producer consumed by both >> and >>? IS an open input", () => {
		// a >> P; a >>? Q  (a has a normal consumer, so it stays in the boundary)
		const edges: NormalizedEdge[] = [
			{ kind: "input", artifact: "a", process: "P" },
			{ kind: "output", process: "P", artifact: "b" },
			{ kind: "feedback", artifact: "a", process: "Q" },
			{ kind: "input", artifact: "b", process: "Q" },
			{ kind: "output", process: "Q", artifact: "c" },
		];
		expect(computeOpenInputs(edges)).toEqual(new Set(["a"]));
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

	it("G2 — name mismatch without boundary map → V034 error", () => {
		const diags = validateSubflowBoundary({
			processId: "fulfill",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: {},
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set(["outgoing_parcel"]),
		});
		expect(diags.some((d) => d.code === "V034")).toBe(true);
	});

	it("V034 input-side message shows only the diff, not full sets", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: {},
			childOpenInputs: new Set(["issues", "order"]),
			childTerminals: new Set(["shipment"]),
		});
		const d = diags.find((d) => d.code === "V034");
		expect(d?.message).toBe(
			"subflow boundary mismatch on process 'P': missing in parent inputs: [\"issues\"]",
		);
	});

	it("V034 output-side message shows only the diff, not full sets", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment", "invoice"]),
			boundaryMap: {},
			childOpenInputs: new Set(["order"]),
			childTerminals: new Set(["shipment"]),
		});
		const d = diags.find((d) => d.code === "V034");
		expect(d?.message).toBe(
			"subflow boundary mismatch on process 'P': extra in parent outputs: [\"invoice\"]",
		);
	});

	it("V034 message shows both missing and extra when both sides differ", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order", "invoice"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: {},
			childOpenInputs: new Set(["order", "issues"]),
			childTerminals: new Set(["shipment"]),
		});
		const d = diags.find((d) => d.code === "V034");
		expect(d?.message).toBe(
			'subflow boundary mismatch on process \'P\': missing in parent inputs: ["issues"]; extra in parent inputs: ["invoice"]',
		);
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

	it("M4 — non-injective boundary map (two parent IDs map to same child ID) → V032", () => {
		// parent inputs {a, b}, parent outputs {}: both a->b and b->b (identity) collide on child 'b'
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["a", "b"]),
			parentOutputs: new Set([]),
			boundaryMap: { a: "b" }, // a maps to 'b'; identity maps b to 'b' too → collision
			childOpenInputs: new Set(["b", "c"]),
			childTerminals: new Set([]),
		});
		expect(diags.some((d) => d.code === "V032")).toBe(true);
	});

	it("M5 — dangling key in boundary map → V030", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set([]),
			boundaryMap: { nonexistent: "order" },
			childOpenInputs: new Set(["order"]),
			childTerminals: new Set([]),
		});
		expect(diags.some((d) => d.code === "V030")).toBe(true);
	});

	it("M5 — dangling value in boundary map → V030", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set([]),
			boundaryMap: { order: "no_such_child_artifact" },
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set([]),
		});
		expect(diags.some((d) => d.code === "V030")).toBe(true);
	});

	it("X1 — side crossing: input mapped to terminal → V033", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set(["shipment"]),
			boundaryMap: { order: "outgoing_parcel", shipment: "incoming_order" },
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set(["outgoing_parcel"]),
		});
		expect(diags.some((d) => d.code === "V033")).toBe(true);
	});

	it("X4 — swap map (input→child terminal side, output→child open input side) → no errors", () => {
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

	it("feedback-aware: parent has output but child has no terminals → V034", () => {
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
		expect(diags.some((d) => d.code === "V034")).toBe(true);
	});

	it("all subflow boundary diagnostics have severity error", () => {
		const diags = validateSubflowBoundary({
			processId: "P",
			parentNormalInputs: new Set(["order"]),
			parentOutputs: new Set([]),
			boundaryMap: {},
			childOpenInputs: new Set(["incoming_order"]),
			childTerminals: new Set([]),
		});
		expect(diags.length).toBeGreaterThan(0);
		for (const d of diags) {
			expect(d.severity).toBe("error");
		}
	});
});

// ---------------------------------------------------------------------------
// loadExtendsChain
// ---------------------------------------------------------------------------

describe("loadExtendsChain", () => {
	it("loads entry and a single preset", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": { frontmatter: { extends: "./p.yaml" } },
			"/p/p.yaml": { frontmatter: {} },
		});
		const result = loadExtendsChain("/p/main.pfdsl", docs);
		expect([...result.docs.keys()].sort()).toEqual([
			"/p/main.pfdsl",
			"/p/p.yaml",
		]);
		expect(result.diagnostics).toEqual([]);
	});

	it("reports missing preset as V026 error", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": { frontmatter: { extends: "./missing.yaml" } },
		});
		const result = loadExtendsChain("/p/main.pfdsl", docs);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]!.code).toBe("V026");
	});

	it("reports self-referential extends as V027 cycle error", () => {
		const docs = makeLoad({
			"/p/self.pfdsl": { frontmatter: { extends: "./self.pfdsl" } },
		});
		const result = loadExtendsChain("/p/self.pfdsl", docs);
		expect(result.diagnostics.some((d) => d.code === "V027")).toBe(true);
	});

	it("reports multi-hop extends cycle (a→b→c→a) as V027", () => {
		const docs = makeLoad({
			"/p/a.pfdsl": { frontmatter: { extends: "./b.pfdsl" } },
			"/p/b.pfdsl": { frontmatter: { extends: "./c.pfdsl" } },
			"/p/c.pfdsl": { frontmatter: { extends: "./a.pfdsl" } },
		});
		const result = loadExtendsChain("/p/a.pfdsl", docs);
		expect(result.diagnostics.some((d) => d.code === "V027")).toBe(true);
	});

	it("diamond: shared preset loaded once, no diagnostics", () => {
		const docs = makeLoad({
			"/p/a.pfdsl": { frontmatter: { extends: ["./b.pfdsl", "./c.pfdsl"] } },
			"/p/b.pfdsl": { frontmatter: { extends: "./d.pfdsl" } },
			"/p/c.pfdsl": { frontmatter: { extends: "./d.pfdsl" } },
			"/p/d.pfdsl": { frontmatter: {} },
		});
		const result = loadExtendsChain("/p/a.pfdsl", docs);
		expect(result.docs.size).toBe(4);
		expect(result.diagnostics).toEqual([]);
	});

	it("reports absolute path in extends as V026 (invalid extends path)", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": { frontmatter: { extends: "/abs/path.yaml" } },
		});
		const result = loadExtendsChain("/p/main.pfdsl", docs);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]!.code).toBe("V026");
		expect(result.diagnostics[0]!.message).toContain("absolute");
	});

	it("reports URL in extends as V026", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": { frontmatter: { extends: "https://x/y.yaml" } },
		});
		const result = loadExtendsChain("/p/main.pfdsl", docs);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]!.code).toBe("V026");
	});
});

// ---------------------------------------------------------------------------
// buildPresentationChain
// ---------------------------------------------------------------------------

describe("buildPresentationChain", () => {
	it("single file, no extends → chain of just the entry", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": { frontmatter: { statusStyles: {} } },
		});
		const { docs: loaded } = loadExtendsChain("/p/main.pfdsl", docs);
		const chain = buildPresentationChain("/p/main.pfdsl", loaded);
		expect(chain.map((c) => c.path)).toEqual(["/p/main.pfdsl"]);
	});

	it("single preset → preset before entry (lowest priority first)", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": { frontmatter: { extends: "./p.yaml" } },
			"/p/p.yaml": { frontmatter: { statusStyles: {} } },
		});
		const { docs: loaded } = loadExtendsChain("/p/main.pfdsl", docs);
		const chain = buildPresentationChain("/p/main.pfdsl", loaded);
		expect(chain.map((c) => c.path)).toEqual(["/p/p.yaml", "/p/main.pfdsl"]);
	});

	it("multi-hop: grandparent preset resolves before parent, before entry", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": { frontmatter: { extends: "./mid.yaml" } },
			"/p/mid.yaml": { frontmatter: { extends: "./base.yaml" } },
			"/p/base.yaml": { frontmatter: { statusStyles: {} } },
		});
		const { docs: loaded } = loadExtendsChain("/p/main.pfdsl", docs);
		const chain = buildPresentationChain("/p/main.pfdsl", loaded);
		expect(chain.map((c) => c.path)).toEqual([
			"/p/base.yaml",
			"/p/mid.yaml",
			"/p/main.pfdsl",
		]);
	});

	it("multiple extends: earlier array entries resolve before later ones", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": {
				frontmatter: { extends: ["./base.yaml", "./team.yaml"] },
			},
			"/p/base.yaml": { frontmatter: { statusStyles: {} } },
			"/p/team.yaml": { frontmatter: { statusStyles: {} } },
		});
		const { docs: loaded } = loadExtendsChain("/p/main.pfdsl", docs);
		const chain = buildPresentationChain("/p/main.pfdsl", loaded);
		expect(chain.map((c) => c.path)).toEqual([
			"/p/base.yaml",
			"/p/team.yaml",
			"/p/main.pfdsl",
		]);
	});

	it("feeding chain into resolvePresentation applies inherited statusStyles", () => {
		const docs = makeLoad({
			"/p/main.pfdsl": { frontmatter: { extends: "./p.yaml" } },
			"/p/p.yaml": {
				frontmatter: { statusStyles: { done: { fillcolor: "green" } } },
			},
		});
		const { docs: loaded } = loadExtendsChain("/p/main.pfdsl", docs);
		const chain = buildPresentationChain("/p/main.pfdsl", loaded);
		const result = resolvePresentation(chain);
		expect(result.statusStyles?.done?.fillcolor).toBe("green");
	});

	it("cycle: does not infinite-loop, still yields a chain", () => {
		const docs = makeLoad({
			"/p/self.pfdsl": { frontmatter: { extends: "./self.pfdsl" } },
		});
		const { docs: loaded } = loadExtendsChain("/p/self.pfdsl", docs);
		const chain = buildPresentationChain("/p/self.pfdsl", loaded);
		expect(chain.map((c) => c.path)).toEqual(["/p/self.pfdsl"]);
	});
});

// ---------------------------------------------------------------------------
// validatePresetKeys
// ---------------------------------------------------------------------------

describe("validatePresetKeys", () => {
	it("returns [] when fm is null", () => {
		expect(validatePresetKeys("/p/p.yaml", null)).toEqual([]);
	});

	it("returns [] when only allowed keys present", () => {
		const fm: Frontmatter = {
			extends: "./base.yaml",
			statusStyles: {},
			tag: {},
			group: {},
		};
		expect(validatePresetKeys("/p/p.yaml", fm)).toEqual([]);
	});

	it("reports forbidden key 'artifact' as V028", () => {
		const fm: Frontmatter = { artifact: {} };
		const diags = validatePresetKeys("/p/p.yaml", fm);
		expect(diags).toHaveLength(1);
		expect(diags[0]!.code).toBe("V028");
		expect(diags[0]!.message).toContain("artifact");
	});

	it("reports forbidden key 'process' as V028", () => {
		const fm: Frontmatter = { process: {} };
		const diags = validatePresetKeys("/p/p.yaml", fm);
		expect(diags).toHaveLength(1);
		expect(diags[0]!.code).toBe("V028");
	});

	it("reports forbidden key 'title' as V028", () => {
		const fm: Frontmatter = { title: "My Flow" };
		const diags = validatePresetKeys("/p/p.yaml", fm);
		expect(diags).toHaveLength(1);
		expect(diags[0]!.code).toBe("V028");
	});

	it("reports multiple forbidden keys as multiple V028 errors", () => {
		const fm: Frontmatter = { title: "x", artifact: {}, process: {} };
		const diags = validatePresetKeys("/p/p.yaml", fm);
		expect(diags.length).toBeGreaterThanOrEqual(3);
		expect(diags.every((d) => d.code === "V028")).toBe(true);
	});

	it("'extends' itself is allowed — no error", () => {
		const fm: Frontmatter = { extends: "./base.yaml" };
		expect(validatePresetKeys("/p/p.yaml", fm)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// resolvePresentation
// ---------------------------------------------------------------------------

describe("resolvePresentation", () => {
	it("empty chain → all fields undefined", () => {
		const result = resolvePresentation([]);
		expect(result).toEqual({
			statusStyles: undefined,
			tag: undefined,
			group: undefined,
		});
	});

	it("single preset with statusStyles.done.fillcolor sets value", () => {
		const result = resolvePresentation([
			{
				path: "/p/p.yaml",
				fm: { statusStyles: { done: { fillcolor: "green" } } },
			},
		]);
		expect(result.statusStyles?.done?.fillcolor).toBe("green");
	});

	it("local overrides preset: last writer wins on fillcolor", () => {
		const result = resolvePresentation([
			{
				path: "/p/p.yaml",
				fm: { statusStyles: { done: { fillcolor: "green" } } },
			},
			{
				path: "/p/main.pfdsl",
				fm: { statusStyles: { done: { fillcolor: "blue" } } },
			},
		]);
		expect(result.statusStyles?.done?.fillcolor).toBe("blue");
	});

	it("deep merge: sibling attribute preserved when only one attr overridden (E1)", () => {
		const result = resolvePresentation([
			{
				path: "/p/p.yaml",
				fm: {
					statusStyles: { done: { fillcolor: "green", fontcolor: "white" } },
				},
			},
			{
				path: "/p/main.pfdsl",
				fm: { statusStyles: { done: { fillcolor: "blue" } } },
			},
		]);
		expect(result.statusStyles?.done?.fillcolor).toBe("blue");
		expect(result.statusStyles?.done?.fontcolor).toBe("white");
	});

	it("multi-preset: last element wins", () => {
		const result = resolvePresentation([
			{
				path: "/p/base.yaml",
				fm: { statusStyles: { done: { fillcolor: "green" } } },
			},
			{
				path: "/p/mid.yaml",
				fm: { statusStyles: { done: { fillcolor: "yellow" } } },
			},
			{
				path: "/p/main.pfdsl",
				fm: { statusStyles: { done: { fillcolor: "blue" } } },
			},
		]);
		expect(result.statusStyles?.done?.fillcolor).toBe("blue");
	});

	it("wip preserved when only done overridden", () => {
		const result = resolvePresentation([
			{
				path: "/p/p.yaml",
				fm: {
					statusStyles: {
						done: { fillcolor: "green" },
						wip: { fillcolor: "yellow" },
					},
				},
			},
			{
				path: "/p/main.pfdsl",
				fm: { statusStyles: { done: { fillcolor: "blue" } } },
			},
		]);
		expect(result.statusStyles?.done?.fillcolor).toBe("blue");
		expect(result.statusStyles?.wip?.fillcolor).toBe("yellow");
	});

	it("tag deep merge: style attribute preserved, label overridden", () => {
		const result = resolvePresentation([
			{
				path: "/p/p.yaml",
				fm: { tag: { urgent: { label: "!", style: { color: "red" } } } },
			},
			{ path: "/p/main.pfdsl", fm: { tag: { urgent: { label: "URGENT" } } } },
		]);
		expect(result.tag?.urgent?.style?.color).toBe("red");
		expect(result.tag?.urgent?.label).toBe("URGENT");
	});

	it("group merge: fields from both preset and local combined", () => {
		const result = resolvePresentation([
			{ path: "/p/p.yaml", fm: { group: { team: { label: "Team A" } } } },
			{ path: "/p/main.pfdsl", fm: { group: { team: { color: "blue" } } } },
		]);
		expect(result.group?.team?.label).toBe("Team A");
		expect(result.group?.team?.color).toBe("blue");
	});
});
