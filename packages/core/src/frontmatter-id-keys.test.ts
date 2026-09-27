import { describe, expect, it } from "vitest";
import { deleteNodes } from "./delete-nodes.js";
import { loadFrontmatter } from "./frontmatter.js";
import { setFrontmatterField } from "./frontmatter-cst.js";
import { insertDefinition } from "./insert-definition.js";
import { reindex } from "./reindex.js";

const source = (section: string, key: string) =>
	`---\n${section}:\n  ${key}: {}\n---\n`;
describe("authored ID key types", () => {
	it("rejects invalid IDs behind an aliased section key in every writer", () => {
		const input =
			"---\nkey: &key artifact\n*key : {10: {}}\nprocess: {p: {}}\n---\n";
		expect(loadFrontmatter(input).frontmatter).toBeNull();
		expect(setFrontmatterField(input, "process", "p", "label", "P")).toBeNull();
		expect(insertDefinition(input, "process", "q").inserted).toBe(false);
		expect(deleteNodes(input, ["p"])).toMatchObject({
			output: input,
			deleted: [],
		});
		expect(reindex(input)).toMatchObject({ output: input, changes: [] });
	});

	it.each([
		"artifact",
		"process",
		"group",
		"tag",
	])("rejects non-string %s IDs before coercion", (section) => {
		for (const key of ["10", "1.5", "true", "null", "[a, b]"]) {
			const result = loadFrontmatter(source(section, key));
			expect(result.frontmatter).toBeNull();
			expect(result.diagnostics).toContainEqual(
				expect.objectContaining({
					code: "FM004",
					range: expect.objectContaining({
						start: expect.objectContaining({ line: 3, column: 3 }),
					}),
				}),
			);
		}
	});
	it.each([
		'"10"',
		'"true"',
		"plain",
		"constructor",
		"__proto__",
	])("accepts string ID %s", (key) => {
		expect(loadFrontmatter(source("artifact", key)).diagnostics).toEqual([]);
	});
	it("does not silently merge typed and string IDs", () => {
		expect(
			loadFrontmatter('---\nartifact:\n  10: {}\n  "10": {}\n---\n')
				.frontmatter,
		).toBeNull();
	});
	it("checks aliased section maps and aliased keys", () => {
		for (const yaml of [
			"defs: &defs {10: {}}\nartifact: *defs",
			"key: &key 10\nartifact: {*key : {}}",
		]) {
			expect(
				loadFrontmatter(`---\n${yaml}\n---\n`).diagnostics.some(
					(d) => d.code === "FM004",
				),
			).toBe(true);
		}
	});
	it("leaves extension mapping keys unrestricted", () => {
		expect(
			loadFrontmatter(
				"---\ncustom: {10: true}\nartifact: {a: {custom: {10: true}}}\n---\n",
			).diagnostics,
		).toEqual([]);
	});
	it("refuses writers on typed IDs without partial edits", () => {
		const input = source("artifact", "10");
		expect(
			setFrontmatterField(input, "artifact", "10", "status", "done"),
		).toBeNull();
		expect(insertDefinition(input, "artifact", "10").inserted).toBe(false);
		expect(deleteNodes(input, ["10"])).toMatchObject({
			output: input,
			deleted: [],
		});
		expect(reindex(input)).toMatchObject({ output: input, changes: [] });
	});
	it("keeps quoted numeric IDs writable", () => {
		const input = source("artifact", '"10"');
		expect(
			setFrontmatterField(input, "artifact", "10", "label", "Ten"),
		).toContain("Ten");
		expect(insertDefinition(input, "artifact", "10").inserted).toBe(false);
		expect(deleteNodes(input, ["10"]).deleted).toEqual(["10"]);
		expect(reindex(input).changes).toContainEqual({
			kind: "artifact",
			id: "10",
			from: null,
			to: 1,
		});
	});
});
