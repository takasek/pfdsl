import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import { FRONTMATTER_JSON_SCHEMA } from "./json-schema.js";

const validate = new Ajv2020({ strict: false }).compile(
	FRONTMATTER_JSON_SCHEMA,
);
describe("portable frontmatter JSON Schema", () => {
	it("matches the generated source artifact", () => {
		expect(
			JSON.parse(
				readFileSync(
					new URL("../schema/frontmatter.schema.json", import.meta.url),
					"utf8",
				),
			),
		).toEqual(FRONTMATTER_JSON_SCHEMA);
	});
	it.each([
		{
			version: 1,
			extends: ["base.yaml"],
			artifact: { a: null },
			process: { p: null },
			group: { g: null },
			tag: { t: null },
			custom: { nested: [true, 42] },
		},
		{
			artifact: {
				a: { status: "done", index: 1, location: "a.md", custom: 42 },
			},
			layout: { direction: "LR" },
		},
		{
			statusStyles: { done: { penwidth: "3" } },
			tag: { t: { style: { color: "red" } } },
		},
	])("accepts valid authored data: %j", (value) =>
		expect(validate(value), JSON.stringify(validate.errors)).toBe(true));
	it.each([
		{ artifact: { a: { owner: ["alice"] } } },
		{ artifact: { a: { parts: 42 } } },
		{ artifact: { a: { status: "finished" } } },
		{ type: "unknown" },
		{ artifact: { a: { index: 0 } } },
		{ process: { p: { index: 1.5 } } },
		{ statusStyles: { unknown: { color: "red" } } },
		{ tag: { t: { style: { unknown: "red" } } } },
		{ process: { p: { boundary: { a: 42 } } } },
		{ layout: { direction: "sideways" } },
		{ extends: ["base.yaml", 42] },
		{ tags: "hello" },
	])("rejects invalid authored data: %j", (value) =>
		expect(validate(value)).toBe(false));
});

describe("JSON Schema artifact writer", () => {
	const writerModule = "../scripts/write-schema.mjs";
	it.each([
		{ args: [], destination: "/dist/frontmatter.schema.json" },
		{ args: ["--source"], destination: "/schema/frontmatter.schema.json" },
	])("writes the generated document to $destination", async ({
		args,
		destination,
	}) => {
		const writeFile = vi.fn();
		vi.doMock("node:fs/promises", () => ({ writeFile }));
		const originalArgv = process.argv;
		try {
			process.argv = ["node", "write-schema.mjs", ...args];
			vi.resetModules();
			await import(writerModule);
			expect(writeFile).toHaveBeenCalledTimes(1);
			const [target, contents] = writeFile.mock.calls[0];
			expect(target.pathname.endsWith(destination)).toBe(true);
			expect(JSON.parse(contents)).toEqual(FRONTMATTER_JSON_SCHEMA);
		} finally {
			process.argv = originalArgv;
			vi.doUnmock("node:fs/promises");
		}
	});
	it.each([
		["--unknown"],
		["--source", "extra"],
	])("rejects invalid arguments %j", async (...args) => {
		const writeFile = vi.fn();
		vi.doMock("node:fs/promises", () => ({ writeFile }));
		const originalArgv = process.argv;
		try {
			process.argv = ["node", "write-schema.mjs", ...args];
			vi.resetModules();
			await expect(import(writerModule)).rejects.toThrow("Usage:");
			expect(writeFile).not.toHaveBeenCalled();
		} finally {
			process.argv = originalArgv;
			vi.doUnmock("node:fs/promises");
		}
	});
});
