import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@pfdsl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./index.js";

let dir: string;
let file: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-meta-extensions-"));
	file = join(dir, "test.pfdsl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("meta set extension fields", () => {
	it.each([
		"true",
		"false",
		"12",
		"0",
	])("updates an existing typed extension key %s without adding a string key", async (key) => {
		writeFileSync(
			file,
			`---\nprocess:\n  p: { ${key}: old }\n---\na >> p -> b\n`,
		);
		const result = await run(["meta", "set", file, "p", key, "new", "--json"]);
		expect(result.exitCode).toBe(0);
		const output = readFileSync(file, "utf8");
		expect(output).toContain(`${key}: new`);
		expect(output).not.toContain(`"${key}":`);
		expect(analyze(output).frontmatter?.process?.p?.[key]).toBe("new");
	});

	it("updates an extension with an aliased scalar key", async () => {
		writeFileSync(
			file,
			"---\ncustom_key: &key true\nprocess:\n  p: { *key : old }\n---\na >> p -> b\n",
		);
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"true",
			"new",
			"--json",
		]);
		expect(result.exitCode).toBe(0);
		const output = readFileSync(file, "utf8");
		expect(output).toContain("*key");
		expect(output).not.toContain('"true":');
		expect(analyze(output).frontmatter?.process?.p?.true).toBe("new");
	});

	it("refuses ambiguous typed and string field keys without partially updating a batch", async () => {
		const source =
			'---\nprocess:\n  p: { true: old }\n  q: { true: old, "true": other }\n---\na >> p -> b >> q -> c\n';
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"set",
			file,
			"p,q",
			"true",
			"new",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
		expect(JSON.parse(result.stdout).error).toContain("field keys");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("refuses a collection field key instead of inserting a new string key", async () => {
		const source = "---\nprocess:\n  p: { [a, b]: old }\n---\na >> p -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"[ a, b ]",
			"new",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("field keys");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it.each([
		'[a, b]: old, "[ a, b ]": other',
		'"[ a, b ]": other, [a, b]: old',
	])("refuses collection/scalar key collisions in either order: %s", async (fields) => {
		const source = `---\nprocess:\n  p: { ${fields} }\n---\na >> p -> b\n`;
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"[ a, b ]",
			"new",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("field keys");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("still edits an unambiguous scalar beside an unrelated collection key", async () => {
		writeFileSync(
			file,
			"---\nprocess:\n  p: { [a, b]: old, custom: original }\n---\na >> p -> b\n",
		);
		const result = await run(["meta", "set", file, "p", "custom", "new"]);
		expect(result.exitCode).toBe(0);
		expect(
			analyze(readFileSync(file, "utf8")).frontmatter?.process?.p,
		).toMatchObject({
			"[ a, b ]": "old",
			custom: "new",
		});
	});

	it("updates an existing extension named like another kind's field", async () => {
		writeFileSync(file, "---\ngroup:\n  g: { description: old }\n---\n");
		expect(
			(await run(["meta", "set", file, "g", "description", "new"])).exitCode,
		).toBe(0);
		expect(
			analyze(readFileSync(file, "utf8")).frontmatter?.group?.g,
		).toMatchObject({ description: "new" });
	});

	it("preserves known location collection-to-string updates", async () => {
		writeFileSync(
			file,
			"---\nprocess:\n  p: { location: [old.ts, other.ts] }\n---\na >> p -> b\n",
		);
		expect(
			(await run(["meta", "set", file, "p", "location", "new.ts"])).exitCode,
		).toBe(0);
		expect(
			analyze(readFileSync(file, "utf8")).frontmatter?.process?.p?.location,
		).toBe("new.ts");
	});

	it("preserves updates through the original anchored definition", async () => {
		writeFileSync(
			file,
			"---\nprocess:\n  p: &p { custom: old }\n  q: *p\n---\na >> p -> b >> q -> c\n",
		);
		expect(
			(await run(["meta", "set", file, "p", "custom", "new"])).exitCode,
		).toBe(0);
		const fm = analyze(readFileSync(file, "utf8")).frontmatter;
		expect(fm?.process?.p?.custom).toBe("new");
		expect(fm?.process?.q?.custom).toBe("new");
	});
	it.each([
		"null",
		"",
	])("updates an empty definition written as %s", async (empty) => {
		writeFileSync(
			file,
			`---\nprocess:\n  p: ${empty} # keep note\n---\na >> p -> b\n`,
		);
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"custom",
			"value",
			"--allow-unknown",
		]);
		expect(result.exitCode).toBe(0);
		const output = readFileSync(file, "utf8");
		expect(output).toContain("keep note");
		expect(analyze(output).frontmatter?.process?.p).toMatchObject({
			custom: "value",
		});
	});

	it("refuses aliased definitions instead of changing shared data or throwing", async () => {
		const source =
			"---\nprocess:\n  p: &p { custom: old }\n  q: *p\n---\na >> p -> b >> q -> c\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"set",
			file,
			"q",
			"custom",
			"new",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("aliased definition");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it.each([
		"artifact",
		"process",
		"group",
	] as const)("updates an existing unknown scalar on %s without a flag", async (kind) => {
		writeFileSync(file, `---\n${kind}:\n  x: { updated_at: old }\n---\n`);
		const result = await run(["meta", "set", file, "x", "updated_at", "new"]);
		expect(result.exitCode).toBe(0);
		expect(
			analyze(readFileSync(file, "utf8")).frontmatter?.[kind]?.x,
		).toMatchObject({ updated_at: "new" });
	});

	it("requires an explicit flag for a new unknown field and preserves the file on refusal", async () => {
		const source = "---\nprocess:\n  p: { label: P }\n---\na >> p -> b\n";
		writeFileSync(file, source);
		const denied = await run(["meta", "set", file, "p", "updated_at", "new"]);
		expect(denied.exitCode).toBe(2);
		expect(denied.stderr).toContain("--allow-unknown");
		expect(readFileSync(file, "utf8")).toBe(source);
		const allowed = await run([
			"meta",
			"set",
			file,
			"p",
			"updated_at",
			"new",
			"--allow-unknown",
		]);
		expect(allowed.exitCode).toBe(0);
		expect(
			analyze(readFileSync(file, "utf8")).frontmatter?.process?.p,
		).toMatchObject({ updated_at: "new" });
	});

	it.each([
		"null",
		"true",
		"12",
		'"old"',
	])("updates an existing scalar %s", async (value) => {
		writeFileSync(
			file,
			`---\nprocess:\n  p: { custom: ${value} }\n---\na >> p -> b\n`,
		);
		expect(
			(await run(["meta", "set", file, "p", "custom", "new"])).exitCode,
		).toBe(0);
	});

	it.each([
		"[a, b]",
		"{ nested: value }",
	])("refuses to overwrite a collection %s even with the flag", async (value) => {
		const source = `---\nprocess:\n  p: { custom: ${value} }\n---\na >> p -> b\n`;
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"custom",
			"new",
			"--allow-unknown",
		]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("not a scalar field");
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("does not treat inherited object properties as existing extension fields", async () => {
		const source = "---\nprocess:\n  p: { label: P }\n---\na >> p -> b\n";
		writeFileSync(file, source);
		expect(
			(await run(["meta", "set", file, "p", "toString", "new"])).exitCode,
		).toBe(2);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("rejects the whole batch when only one entry contains the unknown field", async () => {
		const source =
			"---\nprocess:\n  p: { custom: old }\n  q: { label: Q }\n---\na >> p -> b >> q -> c\n";
		writeFileSync(file, source);
		expect(
			(await run(["meta", "set", file, "p,q", "custom", "new"])).exitCode,
		).toBe(2);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("reports missing IDs and absent definitions together without partial writes", async () => {
		const source = "---\nprocess:\n  p: { label: P }\n---\na >> p -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"set",
			file,
			"p,a,ghost",
			"label",
			"New",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout)).toEqual({
			ok: false,
			missing: ["ghost"],
			undefinedIds: [{ id: "a", kind: "artifact" }],
			error: expect.stringContaining("frontmatter definition"),
		});
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it.each([
		"a >> p -> b\n",
		"p -> b\np\n",
	])("does not create definitions with --allow-unknown for %s", async (body) => {
		writeFileSync(file, body);
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"custom",
			"value",
			"--allow-unknown",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).undefinedIds).toEqual([
			{ id: "p", kind: "process" },
		]);
		expect(readFileSync(file, "utf8")).toBe(body);
	});

	it("keeps post-mutation error validation for extension fields", async () => {
		const source =
			"---\nprocess:\n  p: { custom: old }\n  q: { label: Q }\n---\na >> p -> b\nc >> q -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"custom",
			"new",
			"--json",
		]);
		expect(result.exitCode).toBe(1);
		expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "V001" }),
		);
		expect(readFileSync(file, "utf8")).toBe(source);
	});

	it("the unknown-field flag cannot introduce another kind's known field", async () => {
		const source = "---\nprocess:\n  p: { label: P }\n---\na >> p -> b\n";
		writeFileSync(file, source);
		const result = await run([
			"meta",
			"set",
			file,
			"p",
			"status",
			"done",
			"--allow-unknown",
		]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("not a valid process field");
		expect(readFileSync(file, "utf8")).toBe(source);
	});
});
