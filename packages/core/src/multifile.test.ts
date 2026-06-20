import { describe, expect, it } from "vitest";
import {
	collectExtendsRefs,
	collectSubflowRefs,
	loadSubflowGraph,
	resolveRefPath,
} from "./multifile.js";
import type { Frontmatter } from "./types/frontmatter.js";

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
