import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { parseArgs, run, runCheck, runDiff, shouldColorize } from "./index.js";

// Lets "meta get -" tests inject stdin content without touching the real fd 0
// (which would otherwise hang/behave unpredictably under the test runner).
// All other fs calls pass through to the real implementation unchanged.
let stdinOverride: string | null = null;
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		readFileSync: (path: unknown, opts?: unknown) => {
			if (path === 0 && stdinOverride !== null) return stdinOverride;
			return (actual.readFileSync as (...a: unknown[]) => unknown)(path, opts);
		},
	};
});

let dir: string;
const valid = "req >> design -> spec\nspec >> impl -> code\n";
const validWithStatus =
	"---\nartifact:\n  spec:\n    status: wip\n    criteria: spec criteria\n  code:\n    status: todo\n    criteria: code criteria\n---\nreq >> design -> spec\nspec >> impl -> code\n";
const invalid = "req >> design -> spec\nother -> spec\n"; // V001: dual generators (always error)
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
		expect(parseArgs(["render", "a.pfdsl", "--format", "svg"])).toEqual({
			command: "render",
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
	it("--write rewrites the file", async () => {
		const f = join(dir, "fmt-write.pfdsl");
		writeFileSync(f, "   req>>design->spec\n");
		const r = await run(["fmt", f, "--write"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("req >> design");
	});

	it("--check exits 1 and prints 'not formatted' when the file is not formatted, without writing", async () => {
		const f = join(dir, "fmt-check-unformatted.pfdsl");
		const src = "   req>>design->spec\n";
		writeFileSync(f, src);
		const r = await run(["fmt", f, "--check"]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toBe("not formatted\n");
		expect(readFileSync(f, "utf-8")).toBe(src);
	});

	it("--check exits 0 and prints nothing when the file is already formatted", async () => {
		const f = join(dir, "fmt-check-clean.pfdsl");
		writeFileSync(f, valid);
		const r = await run(["fmt", f, "--check"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("");
	});

	it("--check is allowed with stdin (-)", async () => {
		stdinOverride = "   req>>design->spec\n";
		try {
			const r = await run(["fmt", "-", "--check"]);
			expect(r.exitCode).toBe(1);
			expect(r.stdout).toBe("not formatted\n");
		} finally {
			stdinOverride = null;
		}
	});

	it("--check combined with --write is rejected (exit 2)", async () => {
		const f = join(dir, "fmt-check-conflict.pfdsl");
		writeFileSync(f, valid);
		const r = await run(["fmt", f, "--check", "--write"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toBe("--check cannot be combined with --write\n");
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
		const r = await run(["meta", "reindex", f, "--renumber"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("index: 1");
		// file is untouched in preview mode
		expect(readFileSync(f, "utf-8")).toBe(declared);
	});

	it("--write rewrites the file and prints the change report to stdout", async () => {
		const f = join(dir, "reindex-write.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["meta", "reindex", f, "--write", "--renumber"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("+ D req 1");
		expect(r.stdout).toContain("+ P design 1");
		expect(readFileSync(f, "utf-8")).toContain("index:");
	});

	it("--check exits 1 when reindexing would change anything", async () => {
		const f = join(dir, "reindex-check.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["meta", "reindex", f, "--check", "--renumber"]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("design");
	});

	it("--check exits 0 when already indexed", async () => {
		const f = join(dir, "reindex-check-clean.pfdsl");
		writeFileSync(f, declared);
		await run(["meta", "reindex", f, "--write", "--renumber"]);
		const r = await run(["meta", "reindex", f, "--check", "--renumber"]);
		expect(r.exitCode).toBe(0);
	});

	it("--json emits a machine-readable change report", async () => {
		const f = join(dir, "reindex-json.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["meta", "reindex", f, "--json", "--renumber"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(Array.isArray(parsed.changes)).toBe(true);
		expect(parsed.changes.length).toBe(3);
	});

	it("--write with stdin is rejected (exit 2)", async () => {
		const r = await run(["meta", "reindex", "-", "--write"]);
		expect(r.exitCode).toBe(2);
	});

	it("--check combined with --write is rejected (exit 2)", async () => {
		const f = join(dir, "reindex-conflict.pfdsl");
		writeFileSync(f, declared);
		const r = await run(["meta", "reindex", f, "--check", "--write"]);
		expect(r.exitCode).toBe(2);
	});

	it("parse error surfaces diagnostics and exits 1", async () => {
		const f = join(dir, "reindex-bad.pfdsl");
		const src = "req >> design -> spec\nother -> spec\n"; // V001: dual generators (always error)
		writeFileSync(f, src);
		const r = await run(["meta", "reindex", f, "--write"]);
		expect(r.exitCode).toBe(1);
		expect(readFileSync(f, "utf-8")).toBe(src);
	});
});

describe("meta sort", () => {
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
		const r = await run(["meta", "sort", f, "--by", "id"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/^\s*a:/m);
		// file is untouched in preview mode
		expect(readFileSync(f, "utf-8")).toBe(unsorted);
	});

	it("--write rewrites the file in place", async () => {
		const f = join(dir, "sort-write.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["meta", "sort", f, "--by", "id", "--write"]);
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
		const r = await run(["meta", "sort", f, "--by", "id", "--check"]);
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
		const r = await run(["meta", "sort", f, "--by", "id", "--check"]);
		expect(r.exitCode).toBe(0);
	});

	it("--by without value is rejected (exit 2)", async () => {
		const f = join(dir, "sort-noby.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["meta", "sort", f]);
		expect(r.exitCode).toBe(2);
	});

	it("--write with stdin is rejected (exit 2)", async () => {
		const r = await run(["meta", "sort", "-", "--by", "id", "--write"]);
		expect(r.exitCode).toBe(2);
	});

	it("--check combined with --write is rejected (exit 2)", async () => {
		const f = join(dir, "sort-conflict.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run([
			"meta",
			"sort",
			f,
			"--by",
			"id",
			"--check",
			"--write",
		]);
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
		const r = await run(["meta", "sort", f, "--by", "group,index"]);
		expect(r.exitCode).toBe(0);
		// a1 (alpha) before b1 (beta)
		expect(r.stdout.indexOf("  a1:")).toBeLessThan(r.stdout.indexOf("  b1:"));
	});

	it("invalid --by key is rejected (exit 2)", async () => {
		const f = join(dir, "sort-badkey.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["meta", "sort", f, "--by", "invalid"]);
		expect(r.exitCode).toBe(2);
	});

	it("partially invalid --by key is rejected (exit 2)", async () => {
		const f = join(dir, "sort-partialkey.pfdsl");
		writeFileSync(f, unsorted);
		const r = await run(["meta", "sort", f, "--by", "index,typo"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toMatch(/typo/);
	});
});

describe("graph edges", () => {
	it("prints canonical edges", async () => {
		const r = await run(["graph", "edges", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("req >> design");
		expect(r.stdout).toContain("design -> spec");
	});
});

describe("render", () => {
	it("format=dot (default and explicit produce identical output)", async () => {
		const implicit = await run(["render", join(dir, "valid.pfdsl")]);
		const explicit = await run([
			"render",
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
		const r = await run([
			"render",
			join(dir, "valid.pfdsl"),
			"--format",
			"svg",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("<svg");
	});
	it("rejects unknown format", async () => {
		const r = await run([
			"render",
			join(dir, "valid.pfdsl"),
			"--format",
			"xyz",
		]);
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
			const r = await run(["render", join(d, "main.pfdsl")]);
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
			const r = await run(["render", join(d, "main.pfdsl")]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toContain('fillcolor="#2196F3"');
			expect(r.stdout).not.toContain('fillcolor="#4CAF50"');
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});
});

describe("diff", () => {
	it("reports added and removed edges", async () => {
		const a = join(dir, "diff-a.pfdsl");
		const b = join(dir, "diff-b.pfdsl");
		writeFileSync(a, "req >> design -> spec\n");
		writeFileSync(b, "req >> design -> spec\nspec >> impl -> code\n");
		const r = await runDiff(a, b);
		expect(r.stdout).toContain("+ node code");
		expect(r.stdout).toContain("+ node impl");
		expect(r.stdout).toContain("+ edge spec -> impl");
		expect(r.stdout).toContain("+ edge impl -> code");
		expect(r.stdout).not.toContain("- edge");
	});

	it("fails with an error when a file cannot be read", async () => {
		const a = join(dir, "diff-a.pfdsl");
		writeFileSync(a, "req >> design -> spec\n");
		const r = await runDiff(a, join(dir, "does-not-exist.pfdsl"));
		expect(r.exitCode).not.toBe(0);
		expect(r.stderr).toBeTruthy();
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

describe("graph io", () => {
	it("shows external inputs and terminal artifacts for a valid file", async () => {
		// valid.pfdsl: req >> design -> spec\nspec >> impl -> code
		// external inputs: req; terminals: code
		const r = await run(["graph", "io", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/external inputs:.*req/);
		expect(r.stdout).toMatch(/terminal artifacts:.*code/);
	});

	it("exits 1 when the file has errors", async () => {
		const r = await run(["graph", "io", join(dir, "invalid.pfdsl")]);
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
		const r = await run(["graph", "io", f]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).not.toMatch(/terminal artifacts:.*report/);
		expect(r.stdout).toMatch(/external inputs:.*req/);
	});

	it("--json returns externalInputs and terminals arrays", async () => {
		const r = await run(["graph", "io", join(dir, "valid.pfdsl"), "--json"]);
		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({
			ok: true,
			externalInputs: ["req"],
			terminals: ["code"],
		});
	});
});

describe("graph summary", () => {
	it("shows counts of artifacts, processes, edges, external_inputs, terminals", async () => {
		// valid.pfdsl: req >> design -> spec\nspec >> impl -> code
		// artifacts: req, spec, code (3), processes: design, impl (2)
		// primary edges: req->design, design->spec, spec->impl, impl->code = 4
		// external_inputs: req (1), terminals: code (1)
		const r = await run(["graph", "summary", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/artifacts: 3/);
		expect(r.stdout).toMatch(/processes: 2/);
		expect(r.stdout).toMatch(/edges: 4/);
		expect(r.stdout).toMatch(/external_inputs: 1/);
		expect(r.stdout).toMatch(/terminals: 1/);
	});

	it("exits 1 when the file has errors", async () => {
		const r = await run(["graph", "summary", join(dir, "invalid.pfdsl")]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).not.toMatch(/artifacts:/);
	});

	it("--json returns counts", async () => {
		const r = await run([
			"graph",
			"summary",
			join(dir, "valid.pfdsl"),
			"--json",
		]);
		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({
			ok: true,
			artifacts: 3,
			processes: 2,
			edges: 4,
			externalInputs: 1,
			terminals: 1,
		});
	});
});

describe("check --hints", () => {
	// lib's consumers {use_a, use_b} are a strict subset of same-group cli's
	// {use_a, use_b, use_c} → hint that lib lacks use_c.
	const asymmetric = [
		"---",
		"group:",
		"  g:",
		"    label: G",
		"artifact:",
		"  lib:",
		"    group: g",
		"  cli:",
		"    group: g",
		"---",
		"lib >> use_a -> out_a",
		"lib >> use_b -> out_b",
		"cli >> use_a",
		"cli >> use_b",
		"cli >> use_c -> out_c",
	].join("\n");

	it("prints consumer asymmetry hints", async () => {
		const f = join(dir, "hints.pfdsl");
		writeFileSync(f, asymmetric);
		const r = await run(["check", f, "--hints"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/consumer asymmetry \(hint\): lib/);
	});

	it("without --hints prints no hint lines", async () => {
		const f = join(dir, "hints.pfdsl");
		writeFileSync(f, asymmetric);
		const r = await run(["check", f]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).not.toMatch(/consumer asymmetry/);
	});

	it("--json includes a hints array", async () => {
		const f = join(dir, "hints.pfdsl");
		writeFileSync(f, asymmetric);
		const r = await run(["check", f, "--hints", "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.hints).toEqual([
			{
				artifact: "lib",
				missingProcesses: ["use_c"],
				sibling: "cli",
			},
		]);
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
	it("graph edges --help prints usage", async () => {
		const r = await run(["graph", "edges", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl graph edges");
	});
	it("render --help prints usage", async () => {
		const r = await run(["render", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl render");
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

	it("--no-color is accepted by all subcommands (fmt, graph edges, render)", async () => {
		const fmt = await run(["fmt", join(dir, "valid.pfdsl"), "--no-color"]);
		expect(fmt.exitCode).toBe(0);

		const norm = await run([
			"graph",
			"edges",
			join(dir, "valid.pfdsl"),
			"--no-color",
		]);
		expect(norm.exitCode).toBe(0);

		const graph = await run(["render", join(dir, "valid.pfdsl"), "--no-color"]);
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

	it("graph edges --json returns structured edge objects", async () => {
		const r = await run(["graph", "edges", join(dir, "valid.pfdsl"), "--json"]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
		// valid.pfdsl: req >> design -> spec\nspec >> impl -> code
		expect(JSON.parse(r.stdout)).toEqual({
			ok: true,
			edges: [
				{ kind: "input", artifact: "req", process: "design" },
				{ kind: "output", artifact: "spec", process: "design" },
				{ kind: "input", artifact: "spec", process: "impl" },
				{ kind: "output", artifact: "code", process: "impl" },
			],
		});
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

describe("status ready", () => {
	// Fixtures written in beforeAll(dir):
	//   valid.pfdsl: "req >> design -> spec\nspec >> impl -> code\n"  (no status)
	//   invalid.pfdsl: dual generators (V001, always error)

	const withStatus = (content: string) => {
		const f = join(dir, "ready-status.pfdsl");
		writeFileSync(f, content);
		return f;
	};

	it("lists ready processes when all inputs are done", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["status", "ready", f]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("design");
		expect(r.stdout).not.toContain("impl");
	});

	it("excludes process whose input is not done", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: todo\n---\nreq >> design -> spec\n",
		);
		const r = await run(["status", "ready", f]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("No ready processes. Check artifact statuses.\n");
	});

	it("treats undefined status as done (no frontmatter)", async () => {
		// valid.pfdsl has no artifact status — both processes should be ready
		const r = await run(["status", "ready", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("design");
		expect(r.stdout).toContain("impl");
	});

	it("--json returns structured output", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["status", "ready", f, "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.ready).toBeInstanceOf(Array);
		expect(parsed.ready[0].id).toBe("design");
		expect(parsed.ready[0].inputs).toContain("req");
		expect(parsed.ready[0].outputs).toContain("spec");
		expect(parsed.best).toBeUndefined();
	});

	it("--json --best includes best field", async () => {
		const f = withStatus(
			"---\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["status", "ready", f, "--json", "--best"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.best).toBeDefined();
		expect(parsed.best.id).toBe("design");
		expect(parsed.best.outputs).toContain("spec");
	});

	it("--best marks recommended process with *", async () => {
		const r = await run([
			"status",
			"ready",
			join(dir, "valid.pfdsl"),
			"--best",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/\*/);
		expect(r.stdout).toContain("recommended next");
	});

	it("rejects file with type: workflow (exit 2)", async () => {
		const f = withStatus("---\ntype: workflow\n---\nA >> P -> B\n");
		const r = await run(["status", "ready", f]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("type: roadmap");
	});

	it("rejects file with type: runtime-pipeline (exit 2)", async () => {
		const f = withStatus("---\ntype: runtime-pipeline\n---\nA >> P -> B\n");
		const r = await run(["status", "ready", f]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("type: roadmap");
	});

	it("accepts file with type: roadmap", async () => {
		const f = withStatus(
			"---\ntype: roadmap\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["status", "ready", f]);
		expect(r.exitCode).toBe(0);
	});

	it("warns (W006) on stderr when type: is omitted, but still succeeds (#308)", async () => {
		const r = await run(["status", "ready", join(dir, "valid.pfdsl")]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain("W006");
	});

	it("no W006 warning when type: roadmap is explicit", async () => {
		const f = withStatus(
			"---\ntype: roadmap\nartifact:\n  req:\n    status: done\n---\nreq >> design -> spec\n",
		);
		const r = await run(["status", "ready", f]);
		expect(r.stderr).not.toContain("W006");
	});

	it("--json includes W006 in warnings when type: is omitted", async () => {
		const r = await run([
			"status",
			"ready",
			join(dir, "valid.pfdsl"),
			"--json",
		]);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.warnings?.[0]?.code).toBe("W006");
	});

	it("does not surface non-W006 warnings (e.g. W005) as ready warnings (#308)", async () => {
		const f = withStatus(
			"---\ntype: roadmap\nartifact:\n  req:\n    status: done\n  spec: {}\n---\nreq >> design -> spec\n",
		);
		const r = await run(["status", "ready", f, "--json"]);
		const parsed = JSON.parse(r.stdout);
		expect(r.stderr).not.toContain("W005");
		expect(parsed.warnings).toBeUndefined();
	});

	it("missing file returns exit 1", async () => {
		const r = await run(["status", "ready", join(dir, "nonexistent.pfdsl")]);
		expect(r.exitCode).toBe(1);
	});

	it("missing argument returns exit 2", async () => {
		const r = await run(["status", "ready"]);
		expect(r.exitCode).toBe(2);
	});

	it("--help returns help text", async () => {
		const r = await run(["status", "ready", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl status ready");
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
		const r = await run(["status", "ready", f, "--json", "--best"]);
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
		const r = await run(["status", "ready", f, "--json"]);
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
		const r = await run(["status", "ready", f, "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		const ids = parsed.ready.map((x: { id: string }) => x.id);
		expect(ids).not.toContain("design");
		expect(ids).toContain("impl");
	});
});

describe("meta set", () => {
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
		const r = await run(["meta", "set", f, "req", "status", "done"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("status: done");
		expect(after).not.toContain("status: todo");
	});

	it("exits 1 when artifact id not found", async () => {
		const f = join(dir, "status-set-notfound.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "set", f, "nonexistent", "status", "done"]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("nonexistent");
	});

	it("exits 2 for invalid status value", async () => {
		const f = join(dir, "status-set-badstatus.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "set", f, "req", "status", "invalid"]);
		expect(r.exitCode).toBe(2);
	});

	it("exits 2 when artifact-id or status argument is missing", async () => {
		const f = join(dir, "status-set-missing.pfdsl");
		writeFileSync(f, base);
		const r1 = await run(["meta", "set", f]);
		expect(r1.exitCode).toBe(2);
		const r2 = await run(["meta", "set", f, "req"]);
		expect(r2.exitCode).toBe(2);
	});

	it("--help returns help text", async () => {
		const r = await run(["meta", "set", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("meta set");
	});

	it("warns (W006) on stderr when type: is omitted (#308)", async () => {
		const f = join(dir, "status-set-no-type.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "set", f, "req", "status", "done"]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toContain("W006");
	});

	it("does not surface non-W006 warnings (e.g. W005) as meta set warnings (#308)", async () => {
		const f = join(dir, "status-set-w005.pfdsl");
		writeFileSync(
			f,
			"---\ntype: roadmap\nartifact:\n  req:\n    status: todo\n  spec: {}\n---\nreq >> design -> spec\n",
		);
		const r = await run(["meta", "set", f, "req", "status", "done", "--json"]);
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
		const r = await run(["meta", "set", f, "req", "status", "done"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("newly ready:");
		expect(r.stdout).toContain("design");
	});

	it("prints no newly-ready line when no process becomes unblocked", async () => {
		const f = join(dir, "status-set-no-newly-ready.pfdsl");
		writeFileSync(f, roadmapBase);
		// setting code to done doesn't unlock anything (impl already needs spec which is undefined=done, code just output)
		const r = await run(["meta", "set", f, "code", "status", "wip"]);
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
		const r = await run(["meta", "set", f, "req", "status", "done"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).not.toContain("newly ready:");
	});

	it("--json includes newlyReady array with newly unblocked ids", async () => {
		const f = join(dir, "status-set-json-newly-ready.pfdsl");
		writeFileSync(f, roadmapBase);
		const r = await run(["meta", "set", f, "req", "status", "done", "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.newlyReady).toBeInstanceOf(Array);
		expect(parsed.newlyReady).toContain("design");
	});

	it("--json with nothing unlocked gives empty newlyReady array", async () => {
		const f = join(dir, "status-set-json-empty-newly-ready.pfdsl");
		writeFileSync(f, roadmapBase);
		const r = await run(["meta", "set", f, "code", "status", "wip", "--json"]);
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
		const r = await run(["meta", "set", f, "req", "status", "done"]);
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
		const r = await run(["meta", "set", f, "req(v2)", "status", "done"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("req(v2):\n    status: done");
	});

	// flow-style YAML frontmatter (#415)
	it("rewrites status in flow-style artifact that already has status (#415)", async () => {
		const flowStyle = `---
type: roadmap
artifact:
  requirement: { label: Requirement, status: done }
  spec: { label: Spec, status: todo }
process:
  design: { label: Design }
---
requirement >> design -> spec
`;
		const f = join(dir, "status-set-flow-has-status.pfdsl");
		writeFileSync(f, flowStyle);
		const r = await run(["meta", "set", f, "spec", "status", "wip"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("status: wip");
		expect(after).not.toContain("status: todo");
	});

	it("inserts status into flow-style artifact with no status field (#415)", async () => {
		const flowStyle = `---
type: roadmap
artifact:
  requirement: { label: Requirement, status: done }
  spec: { label: Spec }
process:
  design: { label: Design }
---
requirement >> design -> spec
`;
		const f = join(dir, "status-set-flow-no-status.pfdsl");
		writeFileSync(f, flowStyle);
		const r = await run(["meta", "set", f, "spec", "status", "wip"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("status: wip");
	});

	it("gives a clear error message for flow-style when artifact is not found (#415)", async () => {
		const flowStyle = `---
type: roadmap
artifact:
  requirement: { label: Requirement, status: done }
  spec: { label: Spec, status: todo }
process:
  design: { label: Design }
---
requirement >> design -> spec
`;
		const f = join(dir, "status-set-flow-notfound.pfdsl");
		writeFileSync(f, flowStyle);
		const r = await run(["meta", "set", f, "nonexistent", "status", "done"]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("nonexistent");
	});

	// generalized fields (beyond status)
	const generic = `---
artifact:
  spec:
    label: Old Label
    status: done
process:
  design:
    label: Design
---
req >> design -> spec
`;

	it("replaces an existing non-status field (label)", async () => {
		const f = join(dir, "meta-set-label.pfdsl");
		writeFileSync(f, generic);
		const r = await run(["meta", "set", f, "spec", "label", "New Label"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("label: New Label");
		expect(after).not.toContain("Old Label");
	});

	it("inserts a field that is not yet present (owner)", async () => {
		const f = join(dir, "meta-set-insert.pfdsl");
		writeFileSync(f, generic);
		const r = await run(["meta", "set", f, "spec", "owner", "alice"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toMatch(/spec:\n {4}owner: alice\n/);
		// existing fields survive
		expect(after).toContain("label: Old Label");
	});

	it("sets a field on a process node (command)", async () => {
		const f = join(dir, "meta-set-process.pfdsl");
		writeFileSync(f, generic);
		const r = await run(["meta", "set", f, "design", "command", "make spec"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("command: make spec");
		// the written file still parses cleanly
		const check = await run(["check", f]);
		expect(check.exitCode).toBe(0);
	});

	it("quotes values that would break YAML (colon)", async () => {
		const f = join(dir, "meta-set-quote.pfdsl");
		writeFileSync(f, generic);
		const r = await run(["meta", "set", f, "spec", "label", "spec: v2"]);
		expect(r.exitCode).toBe(0);
		const check = await run(["check", f]);
		expect(check.exitCode).toBe(0);
		const get = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec",
			"--field",
			"label",
			"--json",
		]);
		expect(JSON.parse(get.stdout).values.spec.label).toBe("spec: v2");
	});

	it("accepts multiple comma-separated ids and reports newly-ready once", async () => {
		const multiRoadmap = `---
type: roadmap
artifact:
  a:
    status: todo
  b:
    status: todo
  c:
    status: todo
---
a >> p1
b >> p1 -> c
`;
		const f = join(dir, "meta-set-multi.pfdsl");
		writeFileSync(f, multiRoadmap);
		const r = await run(["meta", "set", f, "a,b", "status", "done"]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after.match(/status: done/g)).toHaveLength(2);
		// p1 becomes ready only after BOTH inputs are done → reported once
		expect(r.stdout).toContain("newly ready: p1");
	});

	it("exits 1 and writes nothing when any id is missing (atomic)", async () => {
		const f = join(dir, "meta-set-atomic.pfdsl");
		writeFileSync(f, generic);
		const r = await run(["meta", "set", f, "spec,ghost", "status", "wip"]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("ghost");
		expect(readFileSync(f, "utf-8")).toBe(generic);
	});

	it("rejects a field invalid for the node kind (exit 2)", async () => {
		const f = join(dir, "meta-set-badkind.pfdsl");
		writeFileSync(f, generic);
		// command is a process field, spec is an artifact
		const r = await run(["meta", "set", f, "spec", "command", "make"]);
		expect(r.exitCode).toBe(2);
		expect(readFileSync(f, "utf-8")).toBe(generic);
	});

	it("rejects non-scalar fields (tags) (exit 2)", async () => {
		const f = join(dir, "meta-set-nonscalar.pfdsl");
		writeFileSync(f, generic);
		const r = await run(["meta", "set", f, "spec", "tags", "x"]);
		expect(r.exitCode).toBe(2);
	});

	it("rejects derived fields (location.resolved) (exit 2)", async () => {
		const f = join(dir, "meta-set-derived.pfdsl");
		writeFileSync(f, generic);
		const r = await run([
			"meta",
			"set",
			f,
			"spec",
			"location.resolved",
			"/tmp/x",
		]);
		expect(r.exitCode).toBe(2);
	});

	it("rejects a non-integer index value (exit 2)", async () => {
		const f = join(dir, "meta-set-badindex.pfdsl");
		writeFileSync(f, generic);
		const r = await run(["meta", "set", f, "spec", "index", "abc"]);
		expect(r.exitCode).toBe(2);
	});

	it("rejects unquoted multi-word values (exit 2, quoting hint)", async () => {
		const f = join(dir, "meta-set-unquoted.pfdsl");
		writeFileSync(f, generic);
		const r = await run(["meta", "set", f, "spec", "label", "New", "Label"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("quote");
	});

	it("replaces a multi-line block-scalar value without leaving orphan lines", async () => {
		const blockScalar = `---
artifact:
  spec:
    description: |
      line one.
      line two.
    status: done
---
req >> design -> spec
`;
		const f = join(dir, "meta-set-block-scalar.pfdsl");
		writeFileSync(f, blockScalar);
		const r = await run(["meta", "set", f, "spec", "description", "short."]);
		expect(r.exitCode).toBe(0);
		const after = readFileSync(f, "utf-8");
		expect(after).toContain("description: short.");
		expect(after).not.toContain("line one.");
		expect(after).toContain("status: done");
		const check = await run(["check", f]);
		expect(check.exitCode).toBe(0);
	});
});

describe("status gaps", () => {
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
		const r = await run(["status", "gaps", rm, fl]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("tracked");
	});

	it("exits 1 and reports gap when todo flow artifact is not in the roadmap", async () => {
		const rm = roadmapWith("  other:\n    status: done\n");
		const fl = flowWith(
			"  missing_artifact:\n    status: todo\n    label: Missing\n",
		);
		const r = await run(["status", "gaps", rm, fl]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toContain("missing_artifact");
		expect(r.stdout).toContain("Missing");
	});

	it("ignores non-todo artifacts in flow files", async () => {
		const rm = roadmapWith("  other:\n    status: done\n");
		const fl = flowWith(
			"  done_art:\n    status: done\n  wip_art:\n    status: wip\n",
		);
		const r = await run(["status", "gaps", rm, fl]);
		expect(r.exitCode).toBe(0);
	});

	it("--json returns structured output with ok=true when no gaps", async () => {
		const rm = roadmapWith("  tracked:\n    status: todo\n");
		const fl = flowWith("  tracked:\n    status: todo\n");
		const r = await run(["status", "gaps", rm, fl, "--json"]);
		expect(r.exitCode).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.gaps).toHaveLength(0);
	});

	it("--json returns structured output with gaps when untracked", async () => {
		const rm = roadmapWith("  other:\n    status: done\n");
		const fl = flowWith("  gap_art:\n    status: todo\n    label: Gap\n");
		const r = await run(["status", "gaps", rm, fl, "--json"]);
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
		const r = await run(["status", "gaps", nonRoadmap, fl]);
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
		const r = await run(["status", "gaps", rm, anotherRoadmap]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("workflow");
	});

	it("missing argument returns exit 2", async () => {
		const r = await run(["status", "gaps"]);
		expect(r.exitCode).toBe(2);
	});

	it("only roadmap arg (no flow) returns exit 2", async () => {
		const rm = roadmapWith("  x:\n    status: done\n");
		const r = await run(["status", "gaps", rm]);
		expect(r.exitCode).toBe(2);
	});

	it("--help returns help text", async () => {
		const r = await run(["status", "gaps", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("status gaps");
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
		const r = await run(["status", "gaps", rm, fl1, fl2, "--json"]);
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
		const r = await run(["status", "gaps", rm, fl]);
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
		const r = await run(["status", "gaps", rm, fl, "--json"]);
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

describe("meta get", () => {
	const base = `---
basePath: ../
artifact:
  spec:
    status: done
    location: docs/spec.md
  code:
    status: todo
process:
  build:
    location: src/build.ts
    command: npm run build
---
req >> design -> spec
spec >> build -> code
`;

	it("returns a single id/field value as text", async () => {
		const f = join(dir, "get-single.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec",
			"--field",
			"status",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("spec.status: done\n");
	});

	it("returns location as the raw value, with location.resolved auto-added alongside it (#476)", async () => {
		const f = join(dir, "get-location.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec",
			"--field",
			"location",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe(
			`spec.location: docs/spec.md\nspec.location.resolved: ${resolve(dir, "..", "docs/spec.md")}\n`,
		);
	});

	it("resolves location for a process the same way as for an artifact", async () => {
		const f = join(dir, "get-process-location.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"build",
			"--field",
			"location",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe(
			`build.location: src/build.ts\nbuild.location.resolved: ${resolve(dir, "..", "src/build.ts")}\n`,
		);
	});

	it("passes URL location elements through unresolved while resolving path elements (§15.8)", async () => {
		const f = join(dir, "get-location-url-mix.pfdsl");
		writeFileSync(
			f,
			`---
basePath: ../
artifact:
  spec:
    location:
      - docs/spec.md
      - https://example.com/spec
---
req -> spec
`,
		);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec",
			"--field",
			"location.resolved",
			"--json",
		]);
		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({
			ok: true,
			values: {
				spec: {
					"location.resolved": [
						resolve(dir, "..", "docs/spec.md"),
						"https://example.com/spec",
					],
				},
			},
		});
	});

	it("adds command.cwd honoring basePath whenever command is in the output", async () => {
		const f = join(dir, "get-command-cwd.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"build",
			"--field",
			"command",
			"--json",
		]);
		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({
			ok: true,
			values: {
				build: {
					command: "npm run build",
					"command.cwd": resolve(dir, ".."),
				},
			},
		});
	});

	it("returns only the derived value when it is requested explicitly (base not auto-added)", async () => {
		const f = join(dir, "get-explicit-derived.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec",
			"--field",
			"location.resolved",
			"--json",
		]);
		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({
			ok: true,
			values: {
				spec: { "location.resolved": resolve(dir, "..", "docs/spec.md") },
			},
		});
	});

	it("returns all set fields plus applicable derived fields when --field is omitted", async () => {
		const f = join(dir, "get-all-fields.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "get", f, "--id", "build", "--json"]);
		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({
			ok: true,
			values: {
				build: {
					location: "src/build.ts",
					"location.resolved": resolve(dir, "..", "src/build.ts"),
					command: "npm run build",
					"command.cwd": resolve(dir, ".."),
				},
			},
		});
	});

	it("returns an empty row for a node that exists but has no frontmatter entry", async () => {
		const f = join(dir, "get-all-fields-empty.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "get", f, "--id", "req", "--json"]);
		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({ ok: true, values: { req: {} } });
	});

	it("accepts multiple ids and fields (comma-separated or repeated flags)", async () => {
		const f = join(dir, "get-multi.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec,code",
			"--field",
			"status",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("spec.status: done\ncode.status: todo\n");
	});

	it("returns an empty value for a field the node doesn't have", async () => {
		const f = join(dir, "get-empty-field.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"code",
			"--field",
			"location",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("code.location: \n");
	});

	it("emits JSON with raw location plus derived location.resolved when --json is passed", async () => {
		const f = join(dir, "get-json.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec",
			"--field",
			"location,status",
			"--json",
		]);
		expect(r.exitCode).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({
			ok: true,
			values: {
				spec: {
					location: "docs/spec.md",
					"location.resolved": resolve(dir, "..", "docs/spec.md"),
					status: "done",
				},
			},
		});
	});

	it("exits 1 when an id is not found in the file", async () => {
		const f = join(dir, "get-notfound.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"nonexistent",
			"--field",
			"status",
		]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("nonexistent");
	});

	it("still prints values for found ids when some ids are missing", async () => {
		const f = join(dir, "get-partial-notfound.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec,nonexistent",
			"--field",
			"status",
		]);
		expect(r.exitCode).toBe(1);
		expect(r.stdout).toBe("spec.status: done\n");
		expect(r.stderr).toContain("nonexistent");
	});

	it("--json reports found values and missing ids together on a partial miss", async () => {
		const f = join(dir, "get-partial-notfound-json.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec,nonexistent",
			"--field",
			"status",
			"--json",
		]);
		expect(r.exitCode).toBe(1);
		expect(JSON.parse(r.stdout)).toEqual({
			ok: false,
			values: { spec: { status: "done" } },
			missing: ["nonexistent"],
		});
	});

	it("warns on stderr for an unrecognized field name but still succeeds", async () => {
		const f = join(dir, "get-unknown-field.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "get", f, "--id", "spec", "--field", "lable"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe("spec.lable: \n");
		expect(r.stderr).toContain("warning");
		expect(r.stderr).toContain("lable");
	});

	it("collapses the unknown-field warning into one line for multiple ids of the same kind (#479 re-check)", async () => {
		const f = join(dir, "get-unknown-field-multi.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec,code",
			"--field",
			"lable",
		]);
		expect(r.exitCode).toBe(0);
		const warningLines = r.stderr
			.trim()
			.split("\n")
			.filter((l) => l.includes("lable"));
		expect(warningLines).toHaveLength(1);
		expect(warningLines[0]).toContain("spec");
		expect(warningLines[0]).toContain("code");
	});

	it("does not warn for a recognized field with no value set", async () => {
		const f = join(dir, "get-known-empty-field.pfdsl");
		writeFileSync(f, base);
		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"code",
			"--field",
			"location",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stderr).toBe("");
	});

	it("--field is optional: omitting it no longer errors", async () => {
		const f = join(dir, "get-missing-field.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "get", f, "--id", "spec"]);
		expect(r.exitCode).toBe(0);
	});

	it("exits 2 with a specific message when --id is missing", async () => {
		const f = join(dir, "get-missing-id.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "get", f, "--field", "status"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("--id is required");
	});

	it("exits 2 with --id is required when both --id and --field are omitted", async () => {
		const f = join(dir, "get-missing-both.pfdsl");
		writeFileSync(f, base);
		const r = await run(["meta", "get", f]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("--id is required");
	});

	it("returns null with a warning when an explicit derived field is requested from stdin", async () => {
		stdinOverride = `---
process:
  build:
    location: src/build.ts
    command: npm run build
---
req >> build -> out
`;
		try {
			const r = await run([
				"meta",
				"get",
				"-",
				"--id",
				"build",
				"--field",
				"location.resolved,command.cwd",
				"--json",
			]);
			expect(r.exitCode).toBe(0);
			expect(JSON.parse(r.stdout)).toEqual({
				ok: true,
				values: {
					build: { "location.resolved": null, "command.cwd": null },
				},
			});
			expect(r.stderr).toContain("stdin");
			expect(r.stderr).toContain("location.resolved");
			expect(r.stderr).toContain("command.cwd");
		} finally {
			stdinOverride = null;
		}
	});

	it("round-trips a relative location unchanged through meta set then meta get", async () => {
		const f = join(dir, "get-set-roundtrip.pfdsl");
		writeFileSync(
			f,
			`---
artifact:
  spec: {}
---
req -> spec
`,
		);
		const setResult = await run([
			"meta",
			"set",
			f,
			"spec",
			"location",
			"../docs/spec.md",
		]);
		expect(setResult.exitCode).toBe(0);

		const r = await run([
			"meta",
			"get",
			f,
			"--id",
			"spec",
			"--field",
			"location",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe(
			`spec.location: ../docs/spec.md\nspec.location.resolved: ${resolve(dir, "../docs/spec.md")}\n`,
		);
	});

	it("--help returns help text", async () => {
		const r = await run(["meta", "get", "--help"]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("pfdsl meta get");
	});
});

describe("graph analysis", () => {
	// req >> design -> spec >> build -> code
	//                spec >> review -> report
	const base = `req >> design -> spec
spec >> build -> code
spec >> review -> report
`;

	describe("neighbors", () => {
		it("prints predecessors and successors as text", async () => {
			const f = join(dir, "neighbors.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "neighbors", f, "spec"]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toBe(
				"predecessors: design\nsuccessors: build, review\n",
			);
		});

		it("emits JSON", async () => {
			const f = join(dir, "neighbors-json.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "neighbors", f, "spec", "--json"]);
			expect(r.exitCode).toBe(0);
			expect(JSON.parse(r.stdout)).toEqual({
				ok: true,
				predecessors: ["design"],
				successors: ["build", "review"],
			});
		});

		it("exits 1 with the shared id(s)-not-found message when the id is not found", async () => {
			const f = join(dir, "neighbors-notfound.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "neighbors", f, "nonexistent"]);
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toBe(`error: id(s) not found in ${f}: nonexistent\n`);
		});

		it("exits 2 when the id argument is missing", async () => {
			const f = join(dir, "neighbors-missing.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "neighbors", f]);
			expect(r.exitCode).toBe(2);
		});
	});

	describe("impact", () => {
		it("prints the downstream closure one id per line, for piping (#479 usability review)", async () => {
			const f = join(dir, "impact.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "impact", f, "spec"]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toBe("build\ncode\nreport\nreview\n");
		});

		it("prints (none) for a terminal node", async () => {
			const f = join(dir, "impact-terminal.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "impact", f, "code"]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toBe("(none)\n");
		});

		it("emits JSON", async () => {
			const f = join(dir, "impact-json.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "impact", f, "spec", "--json"]);
			expect(r.exitCode).toBe(0);
			const parsed = JSON.parse(r.stdout);
			expect(parsed.ok).toBe(true);
			expect(parsed.impact.sort()).toEqual(
				["build", "code", "report", "review"].sort(),
			);
		});

		it("exits 1 with the shared id(s)-not-found message when the id is not found", async () => {
			const f = join(dir, "impact-notfound.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "impact", f, "nonexistent"]);
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toBe(`error: id(s) not found in ${f}: nonexistent\n`);
		});
	});

	describe("depends-on", () => {
		it("prints the upstream closure one id per line, for piping (#479 usability review)", async () => {
			const f = join(dir, "depends-on.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "depends-on", f, "code"]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toBe("build\ndesign\nreq\nspec\n");
		});

		it("exits 1 with the shared id(s)-not-found message when the id is not found", async () => {
			const f = join(dir, "depends-on-notfound.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "depends-on", f, "nonexistent"]);
			expect(r.exitCode).toBe(1);
			expect(r.stderr).toBe(`error: id(s) not found in ${f}: nonexistent\n`);
		});
	});

	describe("path", () => {
		it("prints all simple paths as text", async () => {
			const f = join(dir, "path.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "path", f, "spec", "code"]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toBe("spec -> build -> code\n");
		});

		it("prints a message when no path exists", async () => {
			const f = join(dir, "path-none.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "path", f, "code", "report"]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).toBe("no path found\n");
		});

		it("emits JSON", async () => {
			const f = join(dir, "path-json.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "path", f, "spec", "code", "--json"]);
			expect(r.exitCode).toBe(0);
			expect(JSON.parse(r.stdout)).toEqual({
				ok: true,
				paths: [["spec", "build", "code"]],
			});
		});

		it("exits 1 when either id is not found", async () => {
			const f = join(dir, "path-notfound.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "path", f, "nonexistent", "code"]);
			expect(r.exitCode).toBe(1);
		});

		it("exits 2 when the to argument is missing", async () => {
			const f = join(dir, "path-missing.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "path", f, "spec"]);
			expect(r.exitCode).toBe(2);
		});
	});

	describe("stats", () => {
		it("ranks nodes by total degree as text", async () => {
			const f = join(dir, "stats.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "stats", f]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout.split("\n")[0]).toBe(
				"spec (artifact)   fan-in=1  fan-out=2  total=3",
			);
		});

		it("--limit caps the number of rows", async () => {
			const f = join(dir, "stats-limit.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "stats", f, "--limit", "1"]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout.trim().split("\n")).toHaveLength(1);
		});

		it("emits JSON", async () => {
			const f = join(dir, "stats-json.pfdsl");
			writeFileSync(f, base);
			const r = await run(["graph", "stats", f, "--json"]);
			expect(r.exitCode).toBe(0);
			const parsed = JSON.parse(r.stdout);
			expect(parsed.ok).toBe(true);
			expect(parsed.stats[0]).toEqual({
				id: "spec",
				kind: "artifact",
				fanIn: 1,
				fanOut: 2,
			});
		});

		it("hints at --limit on stderr (not stdout) when the file has many nodes and no --limit was given (#479 re-check)", async () => {
			const f = join(dir, "stats-many-nodes.pfdsl");
			const manyNodes = Array.from(
				{ length: 25 },
				(_, i) => `a${i} >> p${i} -> b${i}`,
			).join("\n");
			writeFileSync(f, `${manyNodes}\n`);
			const r = await run(["graph", "stats", f]);
			expect(r.exitCode).toBe(0);
			expect(r.stdout).not.toContain("nodes total");
			expect(r.stderr).toContain("nodes total");
			expect(r.stderr).toContain("--limit");
		});

		it("does not print a hint when --limit was explicitly given", async () => {
			const f = join(dir, "stats-many-nodes-limited.pfdsl");
			const manyNodes = Array.from(
				{ length: 25 },
				(_, i) => `a${i} >> p${i} -> b${i}`,
			).join("\n");
			writeFileSync(f, `${manyNodes}\n`);
			const r = await run(["graph", "stats", f, "--limit", "5"]);
			expect(r.exitCode).toBe(0);
			expect(r.stderr).toBe("");
		});

		it("does not print a hint when --json is passed", async () => {
			const f = join(dir, "stats-many-nodes-json.pfdsl");
			const manyNodes = Array.from(
				{ length: 25 },
				(_, i) => `a${i} >> p${i} -> b${i}`,
			).join("\n");
			writeFileSync(f, `${manyNodes}\n`);
			const r = await run(["graph", "stats", f, "--json"]);
			expect(r.exitCode).toBe(0);
			expect(r.stderr).toBe("");
			expect(() => JSON.parse(r.stdout)).not.toThrow();
		});
	});
});
