import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
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

describe("packaged JSON Schema", () => {
	it("exposes the current schema to a consumer outside the workspace", () => {
		const temporary = mkdtempSync(join(tmpdir(), "pfdsl-schema-package-"));
		try {
			const core = fileURLToPath(new URL("..", import.meta.url));
			const manifest = JSON.parse(
				readFileSync(join(core, "package.json"), "utf8"),
			);
			execFileSync("pnpm", ["pack", "--pack-destination", temporary], {
				cwd: core,
				stdio: "pipe",
			});
			const installed = join(temporary, "node_modules", "@pfdsl", "core");
			mkdirSync(installed, { recursive: true });
			execFileSync("tar", [
				"-xzf",
				join(temporary, `pfdsl-core-${manifest.version}.tgz`),
				"--strip-components=1",
				"-C",
				installed,
			]);
			const require = createRequire(join(temporary, "consumer.cjs"));
			const schema = require("@pfdsl/core/frontmatter.schema.json");
			expect(schema).toEqual(FRONTMATTER_JSON_SCHEMA);
			const check = new Ajv2020({ allowUnionTypes: true }).compile(schema);
			expect(check({ artifact: { a: null } })).toBe(true);
			expect(check({ artifact: { a: { label: 42 } } })).toBe(false);
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
	}, 30_000);
});
