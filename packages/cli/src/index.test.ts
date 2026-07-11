import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	diffGraphs,
	parseArgs,
	run,
	runCheck,
	shouldColorize,
} from "./index.js";

let dir: string;
const valid = "req >> design -> spec\nspec >> impl -> code\n";
const validWithStatus =
	"---\nartifact:\n  spec:\n    status: wip\n    criteria: spec criteria\n  code:\n    status: todo\n    criteria: code criteria\n---\nreq >> design -> spec\nspec >> impl -> code\n";
const invalid = "req >> design\n"; // process design has no output
const conflict = "req >> design -> spec\nother -> spec\n"; // dual generators
const warningOnly =
	"---\nartifact:\n  bundle:\n    parts: [orphan]\n---\nreq >> design -> bundle\n"; // W001: orphan has no edges

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-cli-"));
	writeFileSync(join(dir, "valid.pfdsl"), valid);
	writeFileSync(join(dir, "valid-with-status.pfdsl"), validWithStatus);
	writeFileSync(join(dir, "invalid.pfdsl"), invalid);
	writeFileSync(join(dir, "conflict.pfdsl"), conflict);
	writeFileSync(join(dir, "warning-only.pfdsl"), warningOnly);
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
	it("returns 1 with readable message for missing file, no stack trace", async () => {
		const r = await run(["check", join(dir, "nonexistent.pfdsl")]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toMatch(/nonexistent\.pfdsl/);
		expect(r.stderr).not.toMatch(/Error:/);
		expect(r.stderr).not.toMatch(/at /);
	});
	it("returns 1 with readable message for directory input", async () => {
		const r = await run(["check", dir]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).not.toMatch(/Error:/);
		expect(r.stderr).not.toMatch(/at /);
	});
});

describe("fmt", () => {
	it("prints flows formatted output to stdout (default)", async () => {
		const r = await run(["fmt", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("req >> design -> spec\nspec >> impl -> code\n");
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

describe("reindex", () => {
	const declared = `---
artifact:
  req:
    label: Req
  spec:
    label: Spec
process:
  design:
    label: Design
---
req >> design -> spec
`;

	it("default prints the rewritten body to stdout (preview), no write", async () => {
		const f = join(dir, "reindex-preview.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["reindex", f, "--renumber"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("index: 1");
		// file is untouched in preview mode
		expect(readFileSync(f, "utf-8")).toBe(declared);
	});

	it("--write rewrites the file and prints the change report to stdout", async () => {
		const f = join(dir, "reindex-write.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["reindex", f, "--write", "--renumber"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("+ D req 1");
		expect(r.stdout).toContain("+ P design 1");
		expect(readFileSync(f, "utf-8")).toContain("index:");
	});

	it("--check exits 1 when reindexing would change anything", async () => {
		const f = join(dir, "reindex-check.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["reindex", f, "--check", "--renumber"]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("design");
	});

	it("--check exits 0 when already indexed", async () => {
		const f = join(dir, "reindex-check-clean.pfdsl");
		writeFileSync(f, declared);
		await run(["reindex", f, "--write", "--renumber"]);
		const r = await run(["reindex", f, "--check", "--renumber"]);
		expect(r.exitCode).toBe(0);
	});

	it("--json emits a machine-readable change report", async () => {
		const f = join(dir, "reindex-json.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["reindex", f, "--json", "--renumber"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(Array.isArray(parsed.changes)).toBe(true);
		expect(parsed.changes.length).toBe(3);
	});

	it("--write with stdin is rejected (exit 2)", async () => {
		const r = await run(["reindex", "-", "--write"]);
		expect(r.exitCode).toBe(2);
	});

	it("--check combined with --write is rejected (exit 2)", async () => {
		const f = join(dir, "reindex-conflict.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["reindex", f, "--check", "--write"]);
		expect(r.exitCode).toBe(2);
	});

	it("parse error surfaces diagnostics and exits 1", async () => {
		const f = join(dir, "reindex-bad.pfdsl");
		writeFileSync(f, "req >> design\n"); // V003: no output
		const r = await run(["reindex", f, "--write"]);
		expect(r.exitCode).toBe(1);
		expect(readFileSync(f, "utf-8")).toBe("req >> design\n");
	});
});

describe("sort-meta", () => {
	const unsorted = `---
artifact:
  z:
    label: Z
  a:
    label: A
---
z >> p -> a
`;

	it("default prints sorted body to stdout (preview), no write", async () => {
		const f = join(dir, "sort-preview.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["sort-meta", f, "--by", "id"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/^\s*a:/m);
		// file is untouched in preview mode
		expect(readFileSync(f, "utf-8")).toBe(unsorted);
	});

	it("--write rewrites the file in place", async () => {
		const f = join(dir, "sort-write.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["sort-meta", f, "--by", "id", "--write"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		// a should appear before z after sorting by id
		const aIdx = after.indexOf("  a:");
		const zIdx = after.indexOf("  z:");
		expect(aIdx).toBeLessThan(zIdx);
	});

	it("--check exits 1 when not sorted", async () => {
		const f = join(dir, "sort-check-unsorted.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["sort-meta", f, "--by", "id", "--check"]);
		expect(r.exitCode).toBe(1);
	});

	it("--check exits 0 when already sorted", async () => {
		const sorted = `---
artifact:
  a:
    label: A
  z:
    label: Z
---
z >> p -> a
`;
		const f = join(dir, "sort-check-sorted.pfdsl");
		writeFileSync(f, sorted);
		const r = await run(["sort-meta", f, "--by", "id", "--check"]);
		expect(r.exitCode).toBe(0);
	});

	it("--by without value is rejected (exit 2)", async () => {
		const f = join(dir, "sort-noby.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["sort-meta", f]);
		expect(r.exitCode).toBe(2);
	});

	it("--write with stdin is rejected (exit 2)", async () => {
		const r = await run(["sort-meta", "-", "--by", "id", "--write"]);
		expect(r.exitCode).toBe(2);
	});

	it("--check combined with --write is rejected (exit 2)", async () => {
		const f = join(dir, "sort-conflict.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["sort-meta", f, "--by", "id", "--check", "--write"]);
		expect(r.exitCode).toBe(2);
	});

	it("accepts multi-key --by group,index", async () => {
		const src = `---
artifact:
  b1: { label: B1, group: beta, index: 1 }
  a1: { label: A1, group: alpha, index: 1 }
---
a1 >> p -> b1
`;
		const f = join(dir, "sort-multikey.pfdsl");
		writeFileSync(f, src);
		const r = await run(["sort-meta", f, "--by", "group,index"]);
		expect(r.exitCode).toBe(0);
		// a1 (alpha) before b1 (beta)
		expect(r.stdout.indexOf("  a1:")).toBeLessThan(r.stdout.indexOf("  b1:"));
	});

	it("invalid --by key is rejected (exit 2)", async () => {
		const f = join(dir, "sort-badkey.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["sort-meta", f, "--by", "invalid"]);
		expect(r.exitCode).toBe(2);
	});

	it("partially invalid --by key is rejected (exit 2)", async () => {
		const f = join(dir, "sort-partialkey.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["sort-meta", f, "--by", "index,typo"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toMatch(/typo/);
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
		const r = await run(["graph", join(dir, "valid.pfdsl"), "--format", "xyz"]);
		expect(r.exitCode).toBe(2);
	});

	it("applies extends-inherited statusStyles (#330)", async () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-graph-extends-"));
		try {
			const preset = [
				"statusStyles:",
				"  done:",
				'    fillcolor: "#4CAF50"',
			].join("\n");
			const main = [
				"---",
				"extends: ./preset.yaml",
				"artifact:",
				"  spec:",
				"    status: done",
				"---",
				"req >> design -> spec",
			].join("\n");
			writeFileSync(join(d, "preset.yaml"), preset);
			writeFileSync(join(d, "main.pfdsl"), main);
			const r = await run(["graph", join(d, "main.pfdsl")]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toContain('fillcolor="#4CAF50"');
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("local statusStyles override the inherited preset value (#330)", async () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-graph-extends-"));
		try {
			const preset = [
				"statusStyles:",
				"  done:",
				'    fillcolor: "#4CAF50"',
			].join("\n");
			const main = [
				"---",
				"extends: ./preset.yaml",
				"statusStyles:",
				"  done:",
				'    fillcolor: "#2196F3"',
				"artifact:",
				"  spec:",
				"    status: done",
				"---",
				"req >> design -> spec",
			].join("\n");
			writeFileSync(join(d, "preset.yaml"), preset);
			writeFileSync(join(d, "main.pfdsl"), main);
			const r = await run(["graph", join(d, "main.pfdsl")]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toContain('fillcolor="#2196F3"');
			expect(r.stdout).not.toContain('fillcolor="#4CAF50"');
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
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

	it("--format dot renders visual diff as DOT", async () => {
		const a = join(dir, "diff-dot-a.pfdsl");
		const b = join(dir, "diff-dot-b.pfdsl");
		writeFileSync(a, "req >> design -> spec\n");
		writeFileSync(b, "req >> design -> spec\nspec >> impl -> code\n");
		const r = await run(["diff", a, b, "--format", "dot"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.startsWith("digraph PFDSL {")).toBe(true);
		expect(r.stdout).toMatch(/#28a745|#c3e6cb/);
	});

	it("--format svg renders visual diff as SVG", async () => {
		const a = join(dir, "diff-svg-a.pfdsl");
		const b = join(dir, "diff-svg-b.pfdsl");
		writeFileSync(a, "req >> design -> spec\n");
		writeFileSync(b, "req >> design -> spec\nspec >> impl -> code\n");
		const r = await run(["diff", a, b, "--format", "svg"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("<svg");
	});

	it("text format shows ~ node for changed frontmatter status", async () => {
		const a = join(dir, "diff-changed-a.pfdsl");
		const b = join(dir, "diff-changed-b.pfdsl");
		writeFileSync(
			a,
			[
				"---",
				"artifact:",
				"  spec:",
				"    status: todo",
				"---",
				"req >> design -> spec\n",
			].join("\n"),
		);
		writeFileSync(
			b,
			[
				"---",
				"artifact:",
				"  spec:",
				"    status: done",
				"---",
				"req >> design -> spec\n",
			].join("\n"),
		);
		const r = await run(["diff", a, b]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("~ node spec");
	});

	it("--format bogus returns exit code 2", async () => {
		const a = join(dir, "valid.pfdsl");
		const r = await run(["diff", a, a, "--format", "bogus"]);
		expect(r.exitCode).toBe(2);
	});

	it("identical files with default text format still returns no structural differences", async () => {
		const a = join(dir, "valid.pfdsl");
		const r = await run(["diff", a, a, "--format", "text"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("no structural differences");
	});
});

describe("check --audit", () => {
	it("shows terminal artifacts and external inputs for a valid file", async () => {
		// valid.pfdsl: req >> design -> spec\nspec >> impl -> code
		// external inputs: req; terminals: code
		const r = await run(["check", join(dir, "valid.pfdsl"), "--audit"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/terminal artifacts:.*code/);
		expect(r.stdout).toMatch(/external inputs:.*req/);
	});

	it("does not show audit output when file has errors", async () => {
		const r = await run(["check", join(dir, "invalid.pfdsl"), "--audit"]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).not.toMatch(/terminal artifacts/);
	});

	it("artifact with externalStakeholders is excluded from terminal artifacts", async () => {
		const src = [
			"---",
			"artifact:",
			"  report:",
			"    externalStakeholders: [規制当局]",
			"---",
			"req >> analyze -> report",
		].join("\n");
		const f = join(dir, "ext-stakeholders.pfdsl");
		writeFileSync(f, src);
		const r = await run(["check", f, "--audit"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).not.toMatch(/terminal artifacts:.*report/);
		expect(r.stdout).toMatch(/external inputs:.*req/);
	});
});

describe("check --summary", () => {
	it("shows counts of artifacts, processes, edges, external_inputs, terminals", async () => {
		// valid.pfdsl: 4 artifacts (req, spec, impl, code... wait: req,spec,code=artifacts, design,impl=processes)
		// Actually: req >> design -> spec\nspec >> impl -> code
		// artifacts: req, spec, code (3), processes: design, impl (2)
		// primary edges: req->design, design->spec, spec->impl, impl->code = 4
		// external_inputs: req (1), terminals: code (1)
		const r = await run(["check", join(dir, "valid.pfdsl"), "--summary"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/artifacts: 3/);
		expect(r.stdout).toMatch(/processes: 2/);
		expect(r.stdout).toMatch(/edges: 4/);
		expect(r.stdout).toMatch(/external_inputs: 1/);
		expect(r.stdout).toMatch(/terminals: 1/);
	});

	it("does not show summary output when file has errors", async () => {
		const r = await run(["check", join(dir, "invalid.pfdsl"), "--summary"]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).not.toMatch(/artifacts:/);
	});
});

describe("version", () => {
	it("--version prints a semver string", async () => {
		const r = await run(["--version"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});
	it("-V prints a semver string", async () => {
		const r = await run(["-V"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});
	it("version (bare subcommand) is unknown command", async () => {
		const r = await run(["version"]);
		expect(r.exitCode).toBe(2);
	});
});

describe("subcommand --help", () => {
	it("check --help prints usage", async () => {
		const r = await run(["check", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl check");
	});
	it("fmt --help prints usage", async () => {
		const r = await run(["fmt", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl fmt");
	});
	it("normalize --help prints usage", async () => {
		const r = await run(["normalize", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl normalize");
	});
	it("graph --help prints usage", async () => {
		const r = await run(["graph", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl graph");
	});
	it("diff --help prints usage", async () => {
		const r = await run(["diff", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl diff");
	});
});

describe("stdin (-)", () => {
	it("fmt --write with - returns error", async () => {
		const r = await run(["fmt", "-", "--write"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("--write");
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

describe("--no-color / NO_COLOR (#180)", () => {
	afterEach(() => {
		delete process.env.NO_COLOR;
	});

	it("check output without no-color contains OK (no ANSI codes present in plain output)", async () => {
		const r = await run(["check", join(dir, "valid-with-status.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("OK");
	});

	it("--no-color flag is accepted and does not break check", async () => {
		const r = await run(["check", join(dir, "valid.pfdsl"), "--no-color"]);
		expect(r.exitCode).toBe(0);
		// No ANSI escape sequences in output
		expect(r.stdout).not.toContain("\x1b[");
		expect(r.stderr).not.toContain("\x1b[");
	});

	it("NO_COLOR env var suppresses ANSI codes", async () => {
		process.env.NO_COLOR = "1";
		const r = await run(["check", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).not.toContain("\x1b[");
		expect(r.stderr).not.toContain("\x1b[");
	});

	it("--no-color is accepted by all subcommands (fmt, normalize, graph)", async () => {
		const fmt = await run(["fmt", join(dir, "valid.pfdsl"), "--no-color"]);
		expect(fmt.exitCode).toBe(0);

		const norm = await run([
			"normalize",
			join(dir, "valid.pfdsl"),
			"--no-color",
		]);
		expect(norm.exitCode).toBe(0);

		const graph = await run(["graph", join(dir, "valid.pfdsl"), "--no-color"]);
		expect(graph.exitCode).toBe(0);
	});
});

describe("ANSI color for check diagnostics (#435)", () => {
	it("runCheck with color:true wraps 'error' severity in red ANSI codes", () => {
		const r = runCheck(join(dir, "invalid.pfdsl"), { color: true });
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("\x1b[31merror\x1b[0m");
	});

	it("runCheck with color:true wraps 'warning' severity in yellow ANSI codes", () => {
		const r = runCheck(join(dir, "warning-only.pfdsl"), { color: true });
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("\x1b[33mwarning\x1b[0m");
	});

	it("runCheck without color option emits no ANSI codes", () => {
		const r = runCheck(join(dir, "invalid.pfdsl"));
		expect(r.stderr).not.toContain("\x1b[");
	});
});

describe("run() wires color into the check command (#435)", () => {
	const originalIsTTY = process.stdout.isTTY;

	afterEach(() => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: originalIsTTY,
			configurable: true,
		});
		delete process.env.NO_COLOR;
	});

	it("emits ANSI codes on a TTY with no NO_COLOR and no --no-color flag", async () => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			configurable: true,
		});
		const r = await run(["check", join(dir, "invalid.pfdsl")]);
		expect(r.stderr).toContain("\x1b[31merror\x1b[0m");
	});

	it("suppresses ANSI codes on a TTY when --no-color is passed", async () => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			configurable: true,
		});
		const r = await run(["check", join(dir, "invalid.pfdsl"), "--no-color"]);
		expect(r.stderr).not.toContain("\x1b[");
	});

	it("suppresses ANSI codes on a TTY when NO_COLOR env is set", async () => {
		Object.defineProperty(process.stdout, "isTTY", {
			value: true,
			configurable: true,
		});
		process.env.NO_COLOR = "1";
		const r = await run(["check", join(dir, "invalid.pfdsl")]);
		expect(r.stderr).not.toContain("\x1b[");
	});
});

describe("shouldColorize (#435)", () => {
	it("is false when --no-color flag is set, even on a TTY with no NO_COLOR", () => {
		expect(
			shouldColorize({ noColorFlag: true, stream: { isTTY: true }, env: {} }),
		).toBe(false);
	});

	it("is false when NO_COLOR env is set, even on a TTY without --no-color", () => {
		expect(
			shouldColorize({
				noColorFlag: false,
				stream: { isTTY: true },
				env: { NO_COLOR: "1" },
			}),
		).toBe(false);
	});

	it("is false when stdout is not a TTY", () => {
		expect(
			shouldColorize({
				noColorFlag: false,
				stream: { isTTY: false },
				env: {},
			}),
		).toBe(false);
	});

	it("is true on a TTY with no NO_COLOR and no --no-color flag", () => {
		expect(
			shouldColorize({
				noColorFlag: false,
				stream: { isTTY: true },
				env: {},
			}),
		).toBe(true);
	});
});

describe("--json output (#181)", () => {
	it("check --json returns { ok: true, diagnostics: [] } for valid file", async () => {
		const r = await run([
			"check",
			join(dir, "valid-with-status.pfdsl"),
			"--json",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.diagnostics).toEqual([]);
	});

	it("check --json returns { ok: false, diagnostics: [...] } for invalid file", async () => {
		const r = await run(["check", join(dir, "invalid.pfdsl"), "--json"]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toBe("");
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(false);
		expect(Array.isArray(parsed.diagnostics)).toBe(true);
		expect(parsed.diagnostics.length).toBeGreaterThan(0);
		const diag = parsed.diagnostics[0];
		expect(diag).toHaveProperty("code");
		expect(diag).toHaveProperty("severity");
		expect(diag).toHaveProperty("message");
	});

	it("check --json exit code is same as without --json (0 for valid, 1 for invalid)", async () => {
		const valid = await run(["check", join(dir, "valid.pfdsl"), "--json"]);
		expect(valid.exitCode).toBe(0);
		const invalid = await run(["check", join(dir, "invalid.pfdsl"), "--json"]);
		expect(invalid.exitCode).toBe(1);
	});

	it("normalize --json returns edge list as JSON array", async () => {
		const r = await run(["normalize", join(dir, "valid.pfdsl"), "--json"]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
		const parsed = JSON.parse(r.stdout);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.length).toBeGreaterThan(0);
		// each entry is an edge string
		expect(typeof parsed[0]).toBe("string");
	});
});

describe("multifile check — subflow", () => {
	const parentValid = [
		"---",
		"process:",
		"  P:",
		"    subflow: ./child.pfdsl",
		"---",
		"order >> P -> shipment",
	].join("\n");
	// child: open inputs = {order}, terminals = {shipment} → matches parent
	const childValid = "order >> pack -> shipment\n";
	// child: open inputs = {incoming_order}, terminals = {outgoing_parcel} → mismatch
	const childMismatch = "incoming_order >> pack -> outgoing_parcel\n";
	const parentMissing = [
		"---",
		"process:",
		"  P:",
		"    subflow: ./nonexistent.pfdsl",
		"---",
		"order >> P -> shipment",
	].join("\n");

	it("valid subflow boundary → exit 0", async () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-mf-subflow-"));
		try {
			writeFileSync(join(d, "parent.pfdsl"), parentValid);
			writeFileSync(join(d, "child.pfdsl"), childValid);
			const r = await run(["check", join(d, "parent.pfdsl")]);
			expect(r.exitCode).toBe(0);
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("boundary mismatch → exit 1 with V034", async () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-mf-subflow-"));
		try {
			writeFileSync(join(d, "parent.pfdsl"), parentValid);
			writeFileSync(join(d, "child.pfdsl"), childMismatch);
			const r = await run(["check", join(d, "parent.pfdsl")]);
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toMatch(/V034/);
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("missing subflow file → exit 1 with V021", async () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-mf-subflow-"));
		try {
			writeFileSync(join(d, "parent.pfdsl"), parentMissing);
			const r = await run(["check", join(d, "parent.pfdsl")]);
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toMatch(/V021/);
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});
});

describe("multifile check — extends", () => {
	const presetValid = [
		"statusStyles:",
		"  done:",
		'    fillcolor: "#4CAF50"',
	].join("\n");
	const presetContaminated = [
		'title: "should not be here"',
		"statusStyles:",
		"  done:",
		'    fillcolor: "#4CAF50"',
	].join("\n");
	const mainFile = ["---", "extends: ./preset.yaml", "---", "a >> P -> b"].join(
		"\n",
	);
	const mainMissingPreset = [
		"---",
		"extends: ./nonexistent.yaml",
		"---",
		"a >> P -> b",
	].join("\n");

	it("valid preset → exit 0", async () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-mf-extends-"));
		try {
			writeFileSync(join(d, "main.pfdsl"), mainFile);
			writeFileSync(join(d, "preset.yaml"), presetValid);
			const r = await run(["check", join(d, "main.pfdsl")]);
			expect(r.exitCode).toBe(0);
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("preset with forbidden key → exit 1 with V028", async () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-mf-extends-"));
		try {
			writeFileSync(join(d, "main.pfdsl"), mainFile);
			writeFileSync(join(d, "preset.yaml"), presetContaminated);
			const r = await run(["check", join(d, "main.pfdsl")]);
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toMatch(/V028/);
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("missing preset file → exit 1 with V026", async () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-mf-extends-"));
		try {
			writeFileSync(join(d, "main.pfdsl"), mainMissingPreset);
			const r = await run(["check", join(d, "main.pfdsl")]);
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toMatch(/V026/);
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});
});

describe("ready", () => {
	// Fixtures written in beforeAll(dir):
	//   valid.pfdsl: "req >> design -> spec\nspec >> impl -> code\n"  (no status)
	//   invalid.pfdsl: process with no output (parse error path)

	const withStatus = (content: string) => {
		const f = join(dir, "ready-status.pfdsl");
		writeFileSync(f, content);
		return f;
	};

	it("lists ready processes when all inputs are done", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["ready", f]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("design");
		expect(r.stdout).not.toContain("impl");
	});

	it("excludes process whose input is not done", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: todo\n---\nreq >> design -> spec\n",
		);
		const r = await run(["ready", f]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("No ready processes. Check artifact statuses.\n");
	});

	it("treats undefined status as done (no frontmatter)", async () => {
		// valid.pfdsl has no artifact status — both processes should be ready
		const r = await run(["ready", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("design");
		expect(r.stdout).toContain("impl");
	});

	it("--json returns structured output", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["ready", f, "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.ready).toBeInstanceOf(Array);
		expect(parsed.ready[0].id).toBe("design");
		expect(parsed.ready[0].inputs).toContain("req");
		expect(parsed.best).toBeUndefined();
	});

	it("--json --best includes best field", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["ready", f, "--json", "--best"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.best).toBeDefined();
		expect(parsed.best.id).toBe("design");
	});

	it("--best marks recommended process with *", async () => {
		const r = await run(["ready", join(dir, "valid.pfdsl"), "--best"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/\*/);
		expect(r.stdout).toContain("recommended next");
	});

	it("rejects file with type: workflow (exit 2)", async () => {
		const f = withStatus("---\ntype: workflow\n---\nA >> P -> B\n");
		const r = await run(["ready", f]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("type: roadmap");
	});

	it("rejects file with type: runtime-pipeline (exit 2)", async () => {
		const f = withStatus("---\ntype: runtime-pipeline\n---\nA >> P -> B\n");
		const r = await run(["ready", f]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("type: roadmap");
	});

	it("accepts file with type: roadmap", async () => {
		const f = withStatus(
			"---\ntype: roadmap\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["ready", f]);
		expect(r.exitCode).toBe(0);
	});

	it("warns (W006) on stderr when type: is omitted, but still succeeds (#308)", async () => {
		const r = await run(["ready", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain("W006");
	});

	it("no W006 warning when type: roadmap is explicit", async () => {
		const f = withStatus(
			"---\ntype: roadmap\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["ready", f]);
		expect(r.stderr).not.toContain("W006");
	});

	it("--json includes W006 in warnings when type: is omitted", async () => {
		const r = await run(["ready", join(dir, "valid.pfdsl"), "--json"]);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.warnings?.[0]?.code).toBe("W006");
	});

	it("does not surface non-W006 warnings (e.g. W005) as ready warnings (#308)", async () => {
		const f = withStatus(
			"---\ntype: roadmap\nartifact:\n  req:\n    status: done\n  spec: {}\n---\nreq >> design -> spec\n",
		);
		const r = await run(["ready", f, "--json"]);
		const parsed = JSON.parse(r.stdout);
		expect(r.stderr).not.toContain("W005");
		expect(parsed.warnings).toBeUndefined();
	});

	it("missing file returns exit 1", async () => {
		const r = await run(["ready", join(dir, "nonexistent.pfdsl")]);
		expect(r.exitCode).toBe(1);
	});

	it("missing argument returns exit 2", async () => {
		const r = await run(["ready"]);
		expect(r.exitCode).toBe(2);
	});

	it("--help returns help text", async () => {
		const r = await run(["ready", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl ready");
	});

	it("--best prefers process that removes last blocker, not just any consumer", async () => {
		// A -> x; B -> y; [x(done?), y] >> C; [x] >> D
		// After A completes: C still needs y (todo), D immediately ready.
		// --best should prefer A (unblocks D) over B (doesn't unblock anyone yet).
		// But here we test the opposite: B is NOT preferred because completing A
		// truly unblocks D while completing B only satisfies one of C's two inputs.
		const src = [
			"---",
			"artifact:",
			"  req_a:",
			"    status: done",
			"  req_b:",
			"    status: done",
			"  y:",
			"    status: todo",
			"---",
			"req_a >> make_x -> x",
			"req_b >> make_y -> y",
			"[x, y] >> merge -> result",
			"x >> side -> side_out",
		].join("\n");
		const f = join(dir, "ready-heuristic.pfdsl");
		writeFileSync(f, src);
		const r = await run(["ready", f, "--json", "--best"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		// make_x unblocks `side` (last missing input) — 1 newly-ready process
		// make_y unblocks nothing (merge still needs x which is todo)
		// make_x should be chosen as best
		expect(parsed.best.id).toBe("make_x");
	});

	it("--best not passed: no computation overhead, best absent from JSON", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["ready", f, "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.best).toBeUndefined();
	});

	it("excludes process whose output artifacts are all done", async () => {
		// design is ready-to-start (inputs done) but its output spec is already done
		// → design should NOT appear in the ready list
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: done\n  spec:\n    status: done\n---\nreq >> design -> spec\nspec >> impl -> code\n",
		);
		const r = await run(["ready", f, "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		const ids = parsed.ready.map((x: { id: string }) => x.id);
		expect(ids).not.toContain("design");
		expect(ids).toContain("impl");
	});
});

describe("status-set", () => {
	const base = `---
artifact:
  req:
    status: todo
  spec:
    status: done
---
req >> design -> spec
`;

	it("rewrites artifact status in place and exits 0", async () => {
		const f = join(dir, "status-set-write.pfdsl");
		writeFileSync(f, base);
		const r = await run(["status-set", f, "req", "done"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("status: done");
		expect(after).not.toContain("status: todo");
	});

	it("exits 1 when artifact id not found", async () => {
		const f = join(dir, "status-set-notfound.pfdsl");
		writeFileSync(f, base);
		const r = await run(["status-set", f, "nonexistent", "done"]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("nonexistent");
	});

	it("exits 2 for invalid status value", async () => {
		const f = join(dir, "status-set-badstatus.pfdsl");
		writeFileSync(f, base);
		const r = await run(["status-set", f, "req", "invalid"]);
		expect(r.exitCode).toBe(2);
	});

	it("exits 2 when artifact-id or status argument is missing", async () => {
		const f = join(dir, "status-set-missing.pfdsl");
		writeFileSync(f, base);
		const r1 = await run(["status-set", f]);
		expect(r1.exitCode).toBe(2);
		const r2 = await run(["status-set", f, "req"]);
		expect(r2.exitCode).toBe(2);
	});

	it("--help returns help text", async () => {
		const r = await run(["status-set", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("status-set");
	});

	it("warns (W006) on stderr when type: is omitted (#308)", async () => {
		const f = join(dir, "status-set-no-type.pfdsl");
		writeFileSync(f, base);
		const r = await run(["status-set", f, "req", "done"]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain("W006");
	});

	it("does not surface non-W006 warnings (e.g. W005) as status-set warnings (#308)", async () => {
		const f = join(dir, "status-set-w005.pfdsl");
		writeFileSync(
			f,
			"---\ntype: roadmap\nartifact:\n  req:\n    status: todo\n  spec: {}\n---\nreq >> design -> spec\n",
		);
		const r = await run(["status-set", f, "req", "done", "--json"]);
		const parsed = JSON.parse(r.stdout);
		expect(r.stderr).not.toContain("W005");
		expect(parsed.warnings).toBeUndefined();
	});

	// newly-ready reporting (roadmap files only)
	const roadmapBase = `---
type: roadmap
artifact:
  req:
    status: todo
  spec:
    status: todo
  code:
    status: todo
---
req >> design -> spec
spec >> impl -> code
`;

	it("prints newly-ready line when a done-transition unlocks at least one process", async () => {
		const f = join(dir, "status-set-newly-ready.pfdsl");
		writeFileSync(f, roadmapBase);
		const r = await run(["status-set", f, "req", "done"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("newly ready:");
		expect(r.stdout).toContain("design");
	});

	it("prints no newly-ready line when no process becomes unblocked", async () => {
		const f = join(dir, "status-set-no-newly-ready.pfdsl");
		writeFileSync(f, roadmapBase);
		// setting code to done doesn't unlock anything (impl already needs spec which is undefined=done, code just output)
		const r = await run(["status-set", f, "code", "wip"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).not.toContain("newly ready:");
	});

	it("non-roadmap file (type: workflow): no newly-ready line in output", async () => {
		const nonRoadmap = `---
type: workflow
artifact:
  req:
    status: todo
---
req >> design -> spec
`;
		const f = join(dir, "status-set-non-roadmap.pfdsl");
		writeFileSync(f, nonRoadmap);
		const r = await run(["status-set", f, "req", "done"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).not.toContain("newly ready:");
	});

	it("--json includes newlyReady array with newly unblocked ids", async () => {
		const f = join(dir, "status-set-json-newly-ready.pfdsl");
		writeFileSync(f, roadmapBase);
		const r = await run(["status-set", f, "req", "done", "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.newlyReady).toBeInstanceOf(Array);
		expect(parsed.newlyReady).toContain("design");
	});

	it("--json with nothing unlocked gives empty newlyReady array", async () => {
		const f = join(dir, "status-set-json-empty-newly-ready.pfdsl");
		writeFileSync(f, roadmapBase);
		const r = await run(["status-set", f, "code", "wip", "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.newlyReady).toBeInstanceOf(Array);
		expect(parsed.newlyReady).toHaveLength(0);
	});

	it("rewrites status in place on 4-space-indented frontmatter (#430)", async () => {
		const fourSpace = `---
artifact:
    req:
        status: todo
    spec:
        status: done
---
req >> design -> spec
`;
		const f = join(dir, "status-set-4space.pfdsl");
		writeFileSync(f, fourSpace);
		const r = await run(["status-set", f, "req", "done"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("status: done");
		expect(after).not.toContain("status: todo");
	});

	it("handles artifact ids containing regex metacharacters (#430)", async () => {
		const withMetaId = `---
artifact:
  req(v2):
    status: todo
  spec:
    status: done
---
other >> design -> spec
`;
		const f = join(dir, "status-set-regex-meta-id.pfdsl");
		writeFileSync(f, withMetaId);
		const r = await run(["status-set", f, "req(v2)", "done"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("req(v2):\n    status: done");
	});
});

describe("audit-sync", () => {
	const roadmapWith = (artifacts: string) => {
		const f = join(dir, "as-roadmap.pfdsl");
		writeFileSync(
			f,
			`---\ntype: roadmap\nartifact:\n${artifacts}---\nreq >> build -> output\n`,
		);
		return f;
	};
	const flowWith = (artifacts: string) => {
		const f = join(dir, "as-flow.pfdsl");
		writeFileSync(f, `---\ntype: workflow\nartifact:\n${artifacts}---\n`);
		return f;
	};

	it("exits 0 when all todo flow artifacts are in the roadmap", async () => {
		const rm = roadmapWith("  output:\n    status: todo\n");
		const fl = flowWith("  output:\n    status: todo\n");
		const r = await run(["audit-sync", rm, fl]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("tracked");
	});

	it("exits 1 and reports gap when todo flow artifact is not in the roadmap", async () => {
		const rm = roadmapWith("  other:\n    status: done\n");
		const fl = flowWith(
			"  missing_artifact:\n    status: todo\n    label: Missing\n",
		);
		const r = await run(["audit-sync", rm, fl]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("missing_artifact");
		expect(r.stdout).toContain("Missing");
	});

	it("ignores non-todo artifacts in flow files", async () => {
		const rm = roadmapWith("  other:\n    status: done\n");
		const fl = flowWith(
			"  done_art:\n    status: done\n  wip_art:\n    status: wip\n",
		);
		const r = await run(["audit-sync", rm, fl]);
		expect(r.exitCode).toBe(0);
	});

	it("--json returns structured output with ok=true when no gaps", async () => {
		const rm = roadmapWith("  tracked:\n    status: todo\n");
		const fl = flowWith("  tracked:\n    status: todo\n");
		const r = await run(["audit-sync", rm, fl, "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.gaps).toHaveLength(0);
	});

	it("--json returns structured output with gaps when untracked", async () => {
		const rm = roadmapWith("  other:\n    status: done\n");
		const fl = flowWith("  gap_art:\n    status: todo\n    label: Gap\n");
		const r = await run(["audit-sync", rm, fl, "--json"]);
		expect(r.exitCode).toBe(1);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(false);
		expect(parsed.gaps).toHaveLength(1);
		expect(parsed.gaps[0].artifactId).toBe("gap_art");
		expect(parsed.gaps[0].label).toBe("Gap");
		expect(parsed.gaps[0].status).toBe("todo");
	});

	it("rejects when roadmap file is not type: roadmap", async () => {
		const nonRoadmap = join(dir, "as-non-roadmap.pfdsl");
		writeFileSync(
			nonRoadmap,
			"---\ntype: workflow\nartifact:\n  x:\n    status: done\n---\n",
		);
		const fl = flowWith("  y:\n    status: todo\n");
		const r = await run(["audit-sync", nonRoadmap, fl]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("roadmap");
	});

	it("rejects when flow file is type: roadmap", async () => {
		const rm = roadmapWith("  x:\n    status: done\n");
		const anotherRoadmap = join(dir, "as-roadmap2.pfdsl");
		writeFileSync(
			anotherRoadmap,
			"---\ntype: roadmap\nartifact:\n  y:\n    status: todo\n---\nreq >> build -> y\n",
		);
		const r = await run(["audit-sync", rm, anotherRoadmap]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("workflow");
	});

	it("missing argument returns exit 2", async () => {
		const r = await run(["audit-sync"]);
		expect(r.exitCode).toBe(2);
	});

	it("only roadmap arg (no flow) returns exit 2", async () => {
		const rm = roadmapWith("  x:\n    status: done\n");
		const r = await run(["audit-sync", rm]);
		expect(r.exitCode).toBe(2);
	});

	it("--help returns help text", async () => {
		const r = await run(["audit-sync", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("audit-sync");
	});

	it("accepts multiple flow files", async () => {
		const rm = roadmapWith("  tracked:\n    status: todo\n");
		const fl1 = join(dir, "as-flow1.pfdsl");
		const fl2 = join(dir, "as-flow2.pfdsl");
		writeFileSync(
			fl1,
			"---\ntype: workflow\nartifact:\n  tracked:\n    status: todo\n---\n",
		);
		writeFileSync(
			fl2,
			"---\ntype: runtime-pipeline\nartifact:\n  gap_only:\n    status: todo\n---\n",
		);
		const r = await run(["audit-sync", rm, fl1, fl2, "--json"]);
		expect(r.exitCode).toBe(1);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.gaps).toHaveLength(1);
		expect(parsed.gaps[0].artifactId).toBe("gap_only");
	});

	it("warns (W006) on stderr when roadmap type: is omitted, but still succeeds (#317)", async () => {
		const rm = join(dir, "as-roadmap-no-type.pfdsl");
		writeFileSync(
			rm,
			"---\nartifact:\n  output:\n    status: todo\n---\nreq >> build -> output\n",
		);
		const fl = flowWith("  output:\n    status: todo\n");
		const r = await run(["audit-sync", rm, fl]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain("W006");
	});

	it("--json includes W006 in warnings when roadmap type: is omitted (#317)", async () => {
		const rm = join(dir, "as-roadmap-no-type-json.pfdsl");
		writeFileSync(
			rm,
			"---\nartifact:\n  output:\n    status: todo\n---\nreq >> build -> output\n",
		);
		const fl = flowWith("  output:\n    status: todo\n");
		const r = await run(["audit-sync", rm, fl, "--json"]);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.warnings?.[0]?.code).toBe("W006");
	});
});

describe("explain", () => {
	it("prints the code, severity, summary, and spec section for a plain-severity error code", async () => {
		const r = await run(["explain", "V021"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("V021 (error):");
		expect(r.stdout.toLowerCase()).toContain("subflow");
		expect(r.stdout).toContain("§15.11");
	});

	it("prints a strict-mode severity label for a two-severity code", async () => {
		const r = await run(["explain", "W002"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("W002 (warning");
		expect(r.stdout).toContain("--strict");
		expect(r.stdout).toContain("§15.7");
	});

	it("works for a P-family (parser) code", async () => {
		const r = await run(["explain", "P004"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("P004 (error):");
		expect(r.stdout).toContain("§9");
	});

	it("works for an FM-family (front matter) code", async () => {
		const r = await run(["explain", "FM001"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("FM001 (error):");
	});

	it("points to the spec.md full text as a fallback", async () => {
		const r = await run(["explain", "V021"]);
		expect(r.stdout).toContain("docs/spec/spec.md");
	});

	it("exits 2 and lists known codes for an unknown code", async () => {
		const r = await run(["explain", "X999"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("X999");
		expect(r.stderr).toContain("V021");
		expect(r.stderr).toContain("FM001");
	});

	it("exits 2 with usage help when no code is given", async () => {
		const r = await run(["explain"]);
		expect(r.exitCode).toBe(2);
	});
});
