import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diffGraphs, parseArgs, run } from "./index.js";

let dir: string;
const valid = "req >> design -> spec\nspec >> impl -> code\n";
const invalid = "req >> design\n"; // process design has no output
const conflict = "req >> design -> spec\nother -> spec\n"; // dual generators

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-cli-"));
	writeFileSync(join(dir, "valid.pfdsl"), valid);
	writeFileSync(join(dir, "invalid.pfdsl"), invalid);
	writeFileSync(join(dir, "conflict.pfdsl"), conflict);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("parseArgs", () => {
	it("parses positional and flags", () => {
		expect(parseArgs(["fmt", "a.pfdsl", "--write"])).toEqual({
			command: "fmt",
			positional: ["a.pfdsl"],
			flags: { write: true },
		});
	});
	it("parses --format with value", () => {
		expect(parseArgs(["graph", "a.pfdsl", "--format", "svg"])).toEqual({
			command: "graph",
			positional: ["a.pfdsl"],
			flags: { format: "svg" },
		});
	});
});

describe("check", () => {
	it("returns 0 for valid file", async () => {
		const r = await run(["check", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
	});
	it("returns 1 for completeness violation", async () => {
		const r = await run(["check", join(dir, "invalid.pfdsl")]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toMatch(/error/);
	});
	it("returns 1 for dual-generator", async () => {
		const r = await run(["check", join(dir, "conflict.pfdsl")]);
		expect(r.exitCode).toBe(1);
	});
});

describe("fmt", () => {
	it("prints flat formatted output to stdout (default)", async () => {
		const r = await run(["fmt", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe(
			"req >> design\ndesign -> spec\nspec >> impl\nimpl -> code\n",
		);
	});
	it("--mode flows groups each process with its inputs and outputs", async () => {
		const r = await run(["fmt", join(dir, "valid.pfdsl"), "--mode", "flows"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("req >> design -> spec\nspec >> impl -> code\n");
	});
	it("--mode flat is explicit flat (same as default)", async () => {
		const r = await run(["fmt", join(dir, "valid.pfdsl"), "--mode", "flat"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe(
			"req >> design\ndesign -> spec\nspec >> impl\nimpl -> code\n",
		);
	});
	it("--mode unknown rejects", async () => {
		const r = await run(["fmt", join(dir, "valid.pfdsl"), "--mode", "pretty"]);
		expect(r.exitCode).toBe(2);
	});
	it("--write rewrites the file", async () => {
		const f = join(dir, "fmt-write.pfdsl");
		writeFileSync(f, "   req>>design->spec\n");
		const r = await run(["fmt", f, "--write"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("req >> design");
	});
});

describe("normalize", () => {
	it("prints canonical edges", async () => {
		const r = await run(["normalize", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("req >> design");
		expect(r.stdout).toContain("design -> spec");
	});
});

describe("graph", () => {
	it("format=dot (default and explicit produce identical output)", async () => {
		const implicit = await run(["graph", join(dir, "valid.pfdsl")]);
		const explicit = await run([
			"graph",
			join(dir, "valid.pfdsl"),
			"--format",
			"dot",
		]);
		expect(implicit.exitCode).toBe(0);
		expect(explicit.exitCode).toBe(0);
		expect(implicit.stdout.startsWith("digraph PFDSL")).toBe(true);
		expect(implicit.stdout).toBe(explicit.stdout);
	});
	it("format=svg renders SVG", async () => {
		const r = await run(["graph", join(dir, "valid.pfdsl"), "--format", "svg"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("<svg");
	});
	it("rejects unknown format", async () => {
		const r = await run(["graph", join(dir, "valid.pfdsl"), "--format", "png"]);
		expect(r.exitCode).toBe(2);
	});
});

describe("diff", () => {
	it("reports added and removed edges", () => {
		const a = join(dir, "diff-a.pfdsl");
		const b = join(dir, "diff-b.pfdsl");
		writeFileSync(a, "req >> design -> spec\n");
		writeFileSync(b, "req >> design -> spec\nspec >> impl -> code\n");
		const report = diffGraphs(a, b);
		expect(report.addedNodes).toEqual(["code", "impl"]);
		expect(report.addedEdges).toContain("spec -> impl");
		expect(report.addedEdges).toContain("impl -> code");
		expect(report.removedEdges).toEqual([]);
	});

	it("CLI diff output for identical files", async () => {
		const a = join(dir, "same.pfdsl");
		writeFileSync(a, valid);
		const r = await run(["diff", a, a]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("no structural differences");
	});
});

describe("help / unknown", () => {
	it("help prints usage", async () => {
		const r = await run(["help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl");
	});
	it("unknown command returns 2", async () => {
		const r = await run(["nonsense"]);
		expect(r.exitCode).toBe(2);
	});
});
