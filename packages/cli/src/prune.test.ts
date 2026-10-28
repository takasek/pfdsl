import {
	linkSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze, format } from "@pfdsl/core";
import { afterEach, beforeEach, expect, it } from "vitest";
import { run } from "./index.js";
import { comparableReady, pruneTargets } from "./prune.js";

let dir: string;
let file: string;
const source = format(
	`---
type: roadmap
artifact:
  a: {status: done}
  b: {status: done}
  c: {status: todo}
process:
  p: {}
  q: {}
---
a >> p -> b >> q -> c
`,
	{ style: "flows" },
).output;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "prune-test-"));
	file = join(dir, "roadmap.pfdsl");
	writeFileSync(file, source);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("previews a completed chain while retaining the shared input", async () => {
	const result = await run(["prune", file]);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(result.stdout).not.toContain("a:");
	expect(result.stdout).toContain("b:");
	expect(result.stdout).toContain("q -> c");
	expect(readFileSync(file, "utf8")).toBe(source);
});
it.each([
	{ flags: [] },
	{ flags: ["--check"] },
	{ flags: ["--write"] },
])("reports exact deleted IDs $flags", async ({ flags }) => {
	const result = await run(["prune", file, ...flags, "--json"]);
	expect(result.exitCode, result.stderr).toBe(
		flags.includes("--check") ? 1 : 0,
	);
	expect(JSON.parse(result.stdout)).toEqual({ ok: true, deleted: ["a", "p"] });
	expect(readFileSync(file, "utf8") === source).toBe(
		!flags.includes("--write"),
	);
});
it("is idempotent and returns the unchanged source on a no-op", async () => {
	expect((await run(["prune", file, "--write"])).exitCode).toBe(0);
	const kept = readFileSync(file, "utf8");
	expect((await run(["prune", file])).stdout).toBe(kept);
	expect((await run(["prune", file, "--check"])).exitCode).toBe(0);
});
it("preserves feedback inputs to unfinished processes", async () => {
	writeFileSync(
		file,
		format(`${source}\na >>? q\n`, { style: "flows" }).output,
	);
	const result = await run(["prune", file, "--json"]);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(JSON.parse(result.stdout).deleted).toEqual(["p"]);
});
it("refuses a sweep that changes blocked processes without writing", async () => {
	const blocked = format(
		`${source.replace("status: done", "status: todo")}\na >>? q\n`,
		{ style: "flows" },
	).output;
	writeFileSync(file, blocked);
	const result = await run(["prune", file, "--write"]);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("blocked");
	expect(readFileSync(file, "utf8")).toBe(blocked);
});
it("rejects invalid option combinations", async () => {
	expect((await run(["prune", file, "--write", "--check"])).exitCode).toBe(2);
	expect((await run(["prune", "-", "--write"])).exitCode).toBe(2);
	expect((await run(["prune", file, "extra"])).exitCode).toBe(2);
});
it("validates relative dependencies at the original path", async () => {
	writeFileSync(join(dir, "preset.yaml"), "group: {}\n");
	writeFileSync(
		file,
		source.replace("type: roadmap", "type: roadmap\nextends: preset.yaml"),
	);
	const result = await run(["prune", file, "--write"]);
	expect(result.exitCode, result.stderr).toBe(0);
	const checked = await run(["check", file]);
	expect(checked.exitCode, checked.stderr).toBe(0);
});

it.each([
	"todo",
	"wip",
	"waiting",
	"suspended",
])("retains mixed outputs with %s work", async (status) => {
	const input = format(
		`---
type: roadmap
artifact:
  a: {status: done}
  b: {status: done}
  c: {status: ${status}}
process:
  p: {}
---
a >> p -> [b, c]
`,
		{ style: "flows" },
	).output;
	writeFileSync(file, input);
	const result = await run(["prune", file, "--json"]);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(JSON.parse(result.stdout).deleted).toEqual([]);
});

it("removes an entirely completed graph including quoted IDs and references", async () => {
	const input = format(
		`---
type: roadmap
artifact:
  "a,b": {status: done}
  b: {status: done, revises: "a,b"}
process:
  p: {}
---
"a,b" >> p -> b
`,
		{ style: "flows" },
	).output;
	writeFileSync(file, input);
	const result = await run(["prune", file, "--write", "--json"]);
	expect(result.exitCode, result.stdout + result.stderr).toBe(0);
	expect(JSON.parse(result.stdout).deleted).toEqual(["a,b", "b", "p"]);
	expect(analyze(readFileSync(file, "utf8")).graph.nodes.size).toBe(0);
});

it("rejects broken input and leaves its bytes unchanged", async () => {
	const input = source.replace("status: todo", "status: invalid");
	writeFileSync(file, input);
	const result = await run(["prune", file, "--write", "--json"]);
	expect(result.exitCode).toBe(1);
	expect(JSON.parse(result.stdout).ok).toBe(false);
	expect(readFileSync(file, "utf8")).toBe(input);
});

it("refuses noncanonical candidate output instead of silently formatting it", async () => {
	const input = source.replace("q -> c", 'q -> "c"');
	writeFileSync(file, input);
	const result = await run(["prune", file, "--write"]);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("not canonically formatted");
	expect(readFileSync(file, "utf8")).toBe(input);
});

it("never removes unfinished isolated artifacts and refuses remaining orphans", async () => {
	const input = format(
		source.replace("artifact:", "artifact:\n  future: {status: todo}"),
		{ style: "flows" },
	).output;
	expect(pruneTargets(analyze(input))).toEqual(["a", "p"]);
	writeFileSync(file, input);
	const result = await run(["prune", file, "--write"]);
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("orphans");
	expect(readFileSync(file, "utf8")).toBe(input);
});

it("preserves the old no-target behavior for an unfinished isolated artifact", async () => {
	const input =
		"---\ntype: roadmap\nartifact:\n  future: {status: todo}\n---\n";
	writeFileSync(file, input);
	const result = await run(["prune", file]);
	expect(result.exitCode, result.stderr).toBe(0);
	expect(result.stdout).toBe(input);
});

it.each([
	"symlink",
	"hardlink",
	"self",
])("refuses circular dependencies without modifying aliases: %s", async (kind) => {
	const target = kind === "self" ? "roadmap.pfdsl" : "alias.pfdsl";
	const input = format(
		source.replace("q: {}", `q: {subflow: ${target}, boundary: {b: a, c: c}}`),
		{ style: "flows" },
	).output;
	writeFileSync(file, input);
	if (kind === "symlink") symlinkSync(file, join(dir, target));
	if (kind === "hardlink") linkSync(file, join(dir, target));
	const checked = await run(["check", file]);
	expect(checked.exitCode).toBe(1);
	expect(checked.stderr).toContain("V022");
	const result = await run(["prune", file, "--write"]);
	expect(result.exitCode).toBe(1);
	expect(readFileSync(file, "utf8")).toBe(input);
	expect(readdirSync(dir).sort()).toEqual(
		kind === "self" ? ["roadmap.pfdsl"] : ["alias.pfdsl", "roadmap.pfdsl"],
	);
});

it("keeps every ready payload field except empty.complete in the comparison", () => {
	const empty = {
		ok: true,
		ready: [],
		empty: { inProgress: ["p"], parked: [], complete: 1, blocked: 0 },
	};
	expect(comparableReady(JSON.stringify(empty))).toBe(
		comparableReady(
			JSON.stringify({ ...empty, empty: { ...empty.empty, complete: 0 } }),
		),
	);
	expect(comparableReady(JSON.stringify(empty))).not.toBe(
		comparableReady(
			JSON.stringify({ ...empty, empty: { ...empty.empty, blocked: 1 } }),
		),
	);
	const before = {
		ok: true,
		ready: [
			{ id: "p", inputs: ["a", "b"], outputs: ["c"], newlyReadyCount: 1 },
		],
	};
	for (const change of [
		{ inputs: ["a"] },
		{ outputs: ["d"] },
		{ newlyReadyCount: 0 },
	]) {
		expect(comparableReady(JSON.stringify(before))).not.toBe(
			comparableReady(
				JSON.stringify({
					...before,
					ready: [{ ...before.ready[0], ...change }],
				}),
			),
		);
	}
});
