import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { run } from "./index.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-prototype-groups-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it.each([
	"__proto__",
	"constructor",
	"regular",
])("renders inherited group %s through DOT and SVG", async (id) => {
	writeFileSync(
		join(dir, "preset.yaml"),
		`tag:\n  __proto__:\n    style: { fillcolor: red, style: filled }\ngroup:\n  ${id}: { label: Prototype group, color: blue }\n`,
	);
	const file = join(dir, "entry.pfdsl");
	writeFileSync(
		file,
		`---\nextends: preset.yaml\nartifact:\n  a: { group: ${id}, tags: [__proto__] }\nprocess:\n  p: { group: ${id} }\n---\na >> p -> b\n`,
	);
	expect((await run(["check", file])).exitCode).toBe(0);
	const dot = await run(["render", file, "--format", "dot"]);
	expect(dot.exitCode).toBe(0);
	expect(dot.stdout).toContain(`cluster_${id}`);
	expect(dot.stdout).toMatch(/"a" \[shape=box[^\n]*fillcolor="red"/);
	expect(dot.stdout).toContain("Prototype group");
	expect(dot.stdout).toContain('color="blue"');
	const svg = await run(["render", file, "--format", "svg"]);
	expect(svg.exitCode).toBe(0);
	expect(svg.stdout).toContain(`cluster_${id}`);
	expect(svg.stdout).toContain('fill="red"');
	expect(svg.stdout).toContain("Prototype group");
});

it("preserves prototype-sensitive tags without a group", async () => {
	const file = join(dir, "entry.pfdsl");
	writeFileSync(
		file,
		"---\ntag:\n  __proto__:\n    style: { fillcolor: red, style: filled }\nartifact:\n  a: { tags: [__proto__] }\n---\na\n",
	);
	expect((await run(["render", file, "--format", "dot"])).stdout).toMatch(
		/"a" \[shape=box[^\n]*fillcolor="red"/,
	);
});
