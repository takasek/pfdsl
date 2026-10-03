import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@pfdsl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./index.js";

let dir: string;
let file: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-delete-groups-"));
	file = join(dir, "test.pfdsl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("delete groups with presets", () => {
	it("promotes a child's explicit local parent override even when the preset has the same value", async () => {
		writeFileSync(
			join(dir, "preset.yaml"),
			"group:\n  root: {}\n  child: { parent: g }\n",
		);
		writeFileSync(
			file,
			"---\nextends: preset.yaml\ngroup:\n  g: { parent: root }\n  child: { parent: g }\n---\n",
		);
		expect((await run(["delete", file, "g", "--write"])).exitCode).toBe(0);
		expect(
			analyze(readFileSync(file, "utf8")).frontmatter?.group?.child?.parent,
		).toBe("root");
	});

	it.each([
		"g",
		"root",
	])("refuses clearing a local parent that would reappear from the preset: %s", async (inheritedParent) => {
		writeFileSync(
			join(dir, "preset.yaml"),
			`group:\n  root: {}\n  child: { parent: ${inheritedParent} }\n`,
		);
		const source =
			"---\nextends: preset.yaml\ngroup:\n  g: {}\n  child: { parent: g }\n---\n";
		writeFileSync(file, source);
		const result = await run(["delete", file, "g", "--write", "--json"]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("preset");
		expect(readFileSync(file, "utf8")).toBe(source);
	});
	it("checks preset relationships only for deleted group IDs in a mixed batch", async () => {
		writeFileSync(join(dir, "preset.yaml"), "group:\n  child: { parent: a }\n");
		writeFileSync(
			file,
			"---\nextends: preset.yaml\ngroup:\n  g: {}\nartifact:\n  a: {}\n---\n",
		);
		expect((await run(["delete", file, "g,a", "--write"])).exitCode).toBe(0);
	});
	it("refuses a preset with malformed groups before writing", async () => {
		writeFileSync(join(dir, "preset.yaml"), "group: [bad]\n");
		const source =
			"---\nextends: preset.yaml\ngroup:\n  g: { parent: root }\nartifact:\n  a: { group: g }\n---\n";
		writeFileSync(file, source);
		const result = await run(["delete", file, "g", "--write", "--json"]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "FM004" }),
		);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it.each([
		"  child: { label: Local }\n",
		"",
	])("refuses a child relationship inherited from the preset: %s", async (localChild) => {
		const preset = "group:\n  root: {}\n  child: { parent: g }\n";
		writeFileSync(join(dir, "preset.yaml"), preset);
		const source = `---\nextends: preset.yaml\ngroup:\n  g: { parent: root }\n${localChild}artifact:\n  a: { group: g }\n---\n`;
		writeFileSync(file, source);
		const result = await run(["delete", file, "g", "--write", "--json"]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("child");
		expect(JSON.parse(result.stdout).error).toContain("preset");
		expect(readFileSync(file, "utf8")).toBe(source);
		expect(readFileSync(join(dir, "preset.yaml"), "utf8")).toBe(preset);
	});

	it("allows deleting a group when a local child parent overrides the preset relationship", async () => {
		writeFileSync(
			join(dir, "preset.yaml"),
			"group:\n  root: {}\n  child: { parent: g }\n",
		);
		writeFileSync(
			file,
			"---\nextends: preset.yaml\ngroup:\n  g: { parent: root }\n  child: { parent: root }\n---\n",
		);
		expect((await run(["delete", file, "g", "--write"])).exitCode).toBe(0);
	});
	it("promotes local members and children to an inherited ancestor", async () => {
		const preset = "---\ngroup:\n  root: {}\n---\n";
		writeFileSync(join(dir, "preset.pfdsl"), preset);
		writeFileSync(
			file,
			"---\nextends: preset.pfdsl\ngroup:\n  g: { parent: root }\n  child: { parent: g }\nartifact:\n  a: { group: g }\n---\n",
		);
		const result = await run(["delete", file, "g", "--write", "--json"]);
		expect(result.exitCode).toBe(0);
		const fm = analyze(readFileSync(file, "utf8")).frontmatter;
		expect(fm?.artifact?.a?.group).toBe("root");
		expect(fm?.group?.child?.parent).toBe("root");
		expect(readFileSync(join(dir, "preset.pfdsl"), "utf8")).toBe(preset);
	});

	it("refuses deleting a local override that would leave the inherited group", async () => {
		writeFileSync(join(dir, "preset.pfdsl"), "---\ngroup:\n  g: {}\n---\n");
		const source =
			"---\nextends: preset.pfdsl\ngroup:\n  g: { label: Local }\n---\n";
		writeFileSync(file, source);
		const result = await run(["delete", file, "g", "--write", "--json"]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("preset");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("refuses unresolved extends before changing a group", async () => {
		const source = "---\nextends: missing.pfdsl\ngroup:\n  g: {}\n---\n";
		writeFileSync(file, source);
		const result = await run(["delete", file, "g", "--write", "--json"]);
		expect(result.exitCode).toBe(1);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("reports unsupported YAML as a refusal in JSON and text", async () => {
		const source =
			"---\ngroup:\n  g: {}\nartifact:\n  a: &a { group: g }\n  b: *a\n---\n";
		writeFileSync(file, source);
		for (const flags of [["--json"], []]) {
			const result = await run(["delete", file, "g", "--write", ...flags]);
			expect(result.exitCode).toBe(1);
			expect(
				flags.length ? JSON.parse(result.stdout).error : result.stderr,
			).toContain("YAML anchors");
			expect(readFileSync(file, "utf8")).toBe(source);
		}
	});
});
