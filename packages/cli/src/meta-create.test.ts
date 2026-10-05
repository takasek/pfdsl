import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@pfdsl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./index.js";

let dir: string;
let file: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-meta-create-"));
	file = join(dir, "test.pfdsl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("meta create", () => {
	it("previews a process definition inferred from the body without writing", async () => {
		const source = "a >> p -> b\n";
		writeFileSync(file, source);
		const result = await run(["meta", "create", file, "p"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe(
			"---\nprocess:\n  p:\n    label: p\n---\na >> p -> b\n",
		);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("creates an artifact with explicit status and returns its definition position", async () => {
		writeFileSync(
			file,
			"---\ntype: roadmap\nartifact:\n  a: { status: done }\n---\na >> p -> b\n",
		);
		const result = await run([
			"meta",
			"create",
			file,
			"b",
			"status=todo",
			"index=4",
			"--write",
			"--json",
		]);
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: true,
			id: "b",
			kind: "artifact",
			created: true,
			written: true,
			line: 5,
		});
		expect(
			analyze(readFileSync(file, "utf8")).frontmatter?.artifact?.b,
		).toMatchObject({ label: "b", status: "todo", index: 4 });
	});

	it("retains commas and equals in positional field values and requires explicit unknown-field permission", async () => {
		writeFileSync(file, "a >> p -> b\n");
		const result = await run([
			"meta",
			"create",
			file,
			"p",
			"label=Build: release",
			"location=src/a,b=c.ts",
			"updated_at=2026-10-05T10:00:00Z",
			"--allow-unknown",
			"--write",
		]);
		expect(result.exitCode).toBe(0);
		expect(
			analyze(readFileSync(file, "utf8")).frontmatter?.process?.p,
		).toMatchObject({
			label: "Build: release",
			location: "src/a,b=c.ts",
			updated_at: "2026-10-05T10:00:00Z",
		});
		expect(result.stdout).toContain("p");
		expect(result.stdout).toContain("3");
	});

	it("returns the complete preview source in JSON without writing", async () => {
		const source = "a >> p -> b\n";
		writeFileSync(file, source);
		const result = await run(["meta", "create", file, "p", "--json"]);
		expect(result.exitCode).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			kind: "process",
			id: "p",
			created: true,
			written: false,
			line: 3,
		});
		expect(payload.output).toContain("label: p");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("preserves existing comments, quoted fields, folded scalars, CRLF and the body", async () => {
		const source =
			"---\r\n# Keep title\r\nartifact:\r\n  a:\r\n    label: 'Input' # quote\r\n    description: >\r\n      First\r\n      second.\r\n---\r\n# body comment\r\na >> p -> b\r\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"create",
			file,
			"p",
			"location=src/build.ts",
			"--write",
		]);
		expect(result.exitCode).toBe(0);
		const output = readFileSync(file, "utf8");
		expect(output).toContain("# Keep title\r\n");
		expect(output).toContain("label: 'Input' # quote\r\n");
		expect(output).toContain(
			"description: >\r\n      First\r\n      second.\r\n",
		);
		expect(output.endsWith("# body comment\r\na >> p -> b\r\n")).toBe(true);
		expect(output.replace(/\r\n/g, "")).not.toContain("\n");
	});

	it("inserts into a flow-style section using the same CST writer", async () => {
		writeFileSync(
			file,
			"---\nprocess: { q: { label: 'Keep' } }\n---\na >> p -> b >> q -> c\n",
		);
		const result = await run([
			"meta",
			"create",
			file,
			"p",
			"location=src/a.ts",
			"--write",
		]);
		expect(result.exitCode).toBe(0);
		expect(readFileSync(file, "utf8")).toContain(
			"process: { q: { label: 'Keep' }, p: { label: p, location: src/a.ts } }",
		);
	});

	it.each([
		[
			"existing",
			"---\nprocess:\n  p: { label: P }\n---\na >> p -> b\n",
			"p",
			"already has a frontmatter definition",
		],
		["missing", "a >> p -> b\n", "ghost", "not found"],
		["ambiguous", "a >> p -> b\np >> q -> c\n", "p", "ambiguous"],
		["unparseable", "---\nprocess: [\n---\na >> p -> b\n", "p", "frontmatter"],
		["unclosed", "---\nprocess:\n  p: {}\na >> p -> b\n", "p", "frontmatter"],
		["broken body", "a >>> p\n", "p", "structural"],
	])("refuses %s without changing any bytes", async (_name, source, id, error) => {
		writeFileSync(file, source);
		const result = await run(["meta", "create", file, id, "--write", "--json"]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			error: expect.stringContaining(error),
		});
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("does not allow process status through --allow-unknown", async () => {
		const source = "a >> p -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"create",
			file,
			"p",
			"status=done",
			"--allow-unknown",
			"--write",
			"--json",
		]);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout).error).toContain(
			"not a valid process field",
		);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it.each([
		["updated_at=today", "--allow-unknown"],
		["tags=a,b", "not a scalar"],
		["location.resolved=x", "derived read-only"],
		["index=-1", "non-negative integer"],
		["status=ready", "invalid status"],
		["label", "field=value"],
		["=value", "field=value"],
	])("refuses invalid initial field %s atomically", async (field, error) => {
		const source = "a >> p -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"create",
			file,
			"p",
			"location=ok.ts",
			field,
			"--write",
			"--json",
		]);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout).error).toContain(error);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("rejects duplicate fields instead of applying a partial or last-value write", async () => {
		const source = "a >> p -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"create",
			file,
			"p",
			"label=first",
			"label=last",
			"--write",
			"--json",
		]);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout).error).toContain(
			"duplicate field 'label'",
		);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("checks the completed source and allows an initial status to repair V035", async () => {
		const source =
			"---\ntype: roadmap\nartifact:\n  a: { status: done }\n---\na >> p -> b\n";
		writeFileSync(file, source);
		const denied = await run([
			"meta",
			"create",
			file,
			"b",
			"--write",
			"--json",
		]);
		expect(denied.exitCode).toBe(1);
		expect(JSON.parse(denied.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "V035" }),
		);
		expect(readFileSync(file, "utf8")).toBe(source);
		const allowed = await run([
			"meta",
			"create",
			file,
			"b",
			"status=todo",
			"--write",
		]);
		expect(allowed.exitCode).toBe(0);
	});

	it("refuses a result that retains a validation error", async () => {
		const source = "a >> p -> b\nc >> q -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"create",
			file,
			"p",
			"--write",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "V001" }),
		);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("refuses status on a non-roadmap file", async () => {
		const source = "---\ntype: workflow\n---\na >> p -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"create",
			file,
			"b",
			"status=todo",
			"--write",
			"--json",
		]);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout).error).toContain("roadmap");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("refuses an aliased target section without rewriting shared values", async () => {
		const source =
			"---\nshared: &section {}\nprocess: *section\n---\na >> p -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"create",
			file,
			"p",
			"--write",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("could not create");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("reports unreadable files in JSON", async () => {
		const result = await run([
			"meta",
			"create",
			join(dir, "absent.pfdsl"),
			"p",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("No such file");
	});

	it("guides body-only meta set to the explicit creation command", async () => {
		writeFileSync(file, "a >> p -> b\n");
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"label",
			"Build",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain(
			`pfdsl meta create ${file} p`,
		);
		expect(readFileSync(file, "utf8")).toBe("a >> p -> b\n");
	});

	it("documents creation, positional fields, previews and definition position", async () => {
		const result = await run(["meta", "create", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("[field=value ...]");
		expect(result.stdout).toContain("--write");
		expect(result.stdout).toContain("--allow-unknown");
		expect(result.stdout).toContain("location=src/build.ts");
		expect(result.stdout).toContain("status=todo");
	});

	it("rejects stdin and missing arguments", async () => {
		expect((await run(["meta", "create", "-", "p"])).exitCode).toBe(2);
		expect((await run(["meta", "create", file])).exitCode).toBe(2);
	});
});
