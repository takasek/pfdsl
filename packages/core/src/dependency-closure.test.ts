import { expect, it } from "vitest";
import {
	loadDependencyClosure,
	loadDependencyClosureAsync,
} from "./dependency-closure.js";
import { analyze } from "./index.js";

function fixture() {
	const docs = new Map([
		[
			"/p/entry.pfdsl",
			analyze(
				"---\nprocess:\n  left: {subflow: left.pfdsl}\n  right: {subflow: right.pfdsl}\n---\n",
			),
		],
		["/p/left.pfdsl", analyze("---\nextends: a.yaml\n---\n")],
		["/p/right.pfdsl", analyze("---\nextends: b.yaml\n---\n")],
		["/p/a.yaml", analyze("---\nextends: b.yaml\n---\n")],
		["/p/b.yaml", analyze("---\nextends: a.yaml\n---\n")],
	]);
	const calls = new Map<string, number>();
	const load = (path: string) => {
		calls.set(path, (calls.get(path) ?? 0) + 1);
		return docs.get(path) ?? null;
	};
	return { docs, calls, load };
}

it("reads each file once and reports an extends cycle once across child roots", () => {
	const { calls, load } = fixture();
	const result = loadDependencyClosure("/p/entry.pfdsl", load);
	expect(result.docs.size).toBe(5);
	expect([...calls.values()]).toEqual([1, 1, 1, 1, 1]);
	expect(result.diagnostics.filter((d) => d.code === "V027")).toHaveLength(1);
	expect(result.roles.get("/p/entry.pfdsl")).toEqual(new Set(["entry"]));
	expect(result.roles.get("/p/left.pfdsl")).toEqual(new Set(["subflow"]));
	expect(result.roles.get("/p/a.yaml")).toEqual(new Set(["preset"]));
});

it("shares traversal with the asynchronous adapter", async () => {
	const { calls, load } = fixture();
	const result = await loadDependencyClosureAsync(
		"/p/entry.pfdsl",
		async (path) => load(path),
	);
	expect(result.docs.size).toBe(5);
	expect([...calls.values()]).toEqual([1, 1, 1, 1, 1]);
	expect(result.diagnostics.filter((d) => d.code === "V027")).toHaveLength(1);
});

it("keeps entry/preset roles and does not mistake a mixed-edge loop for a cycle", () => {
	const docs = new Map([
		[
			"/p/entry.pfdsl",
			analyze("---\nprocess:\n  p: {subflow: child.pfdsl}\n---\na >> p -> b\n"),
		],
		[
			"/p/child.pfdsl",
			analyze("---\nextends: entry.pfdsl\n---\na >> q -> b\n"),
		],
	]);
	const result = loadDependencyClosure(
		"/p/entry.pfdsl",
		(path) => docs.get(path) ?? null,
	);
	expect(result.roles.get("/p/entry.pfdsl")).toEqual(
		new Set(["entry", "preset"]),
	);
	expect(
		result.diagnostics.filter((d) => ["V022", "V027"].includes(d.code)),
	).toEqual([]);
	expect(result.presetDiagnostics).toContainEqual(
		expect.objectContaining({ code: "V028" }),
	);
	expect(result.presetDiagnostics.every((d) => !Object.hasOwn(d, "file"))).toBe(
		true,
	);
});

it("caches missing files but reports each referencing file", () => {
	const { docs, calls, load } = fixture();
	docs.set("/p/a.yaml", analyze("---\nextends: missing.yaml\n---\n"));
	docs.set("/p/b.yaml", analyze("---\nextends: missing.yaml\n---\n"));
	const result = loadDependencyClosure("/p/entry.pfdsl", load);
	expect(calls.get("/p/missing.yaml")).toBe(1);
	expect(
		result.diagnostics
			.filter((d) => d.code === "V026")
			.map((d) => d.file)
			.sort(),
	).toEqual(["/p/a.yaml", "/p/b.yaml"]);
});

it("retains distinct cycles sharing a root", () => {
	const docs = new Map([
		["/p/a.yaml", analyze("---\nextends: [b.yaml, c.yaml]\n---\n")],
		["/p/b.yaml", analyze("---\nextends: a.yaml\n---\n")],
		["/p/c.yaml", analyze("---\nextends: a.yaml\n---\n")],
	]);
	expect(
		loadDependencyClosure(
			"/p/a.yaml",
			(p) => docs.get(p) ?? null,
		).diagnostics.filter((d) => d.code === "V027"),
	).toHaveLength(2);
});

it("can restrict traversal to the entry's presentation dependencies", () => {
	const { calls, load } = fixture();
	const result = loadDependencyClosure("/p/entry.pfdsl", load, {
		subflows: false,
	});
	expect(result.docs.size).toBe(1);
	expect(calls.size).toBe(1);
});
