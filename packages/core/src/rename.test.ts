import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { rename } from "./rename.js";

describe("rename kind resolution", () => {
	it("renames an artifact, reporting kind: artifact", () => {
		expect(rename("a >> p -> b\n", "b", "bx")).toEqual({
			ok: true,
			output: "a >> p -> bx\n",
			kind: "artifact",
		});
	});

	it("renames a process, reporting kind: process", () => {
		expect(rename("a >> p -> b\n", "p", "px")).toEqual({
			ok: true,
			output: "a >> px -> b\n",
			kind: "process",
		});
	});

	it("renames a locally declared group, reporting its members and child groups", () => {
		const src = `---
group:
  g: { label: G }
  sub: { label: Sub, parent: g }
artifact:
  a: { group: g }
---
a >> p -> b
`;
		const r = rename(src, "g", "gx");
		expect(r).toMatchObject({
			ok: true,
			kind: "group",
			members: ["a"],
			children: ["sub"],
		});
	});

	it("uses a precomputed analysis of the same source", () => {
		const src = "a >> p -> b\n";
		expect(rename(src, "b", "bx", { analysis: analyze(src) })).toEqual(
			rename(src, "b", "bx"),
		);
	});

	it("refuses an old id that is not this file's own id as notFound", () => {
		expect(rename("a >> p -> b\n", "ghost", "gx")).toEqual({
			ok: false,
			reason: "notFound",
		});
	});

	// A group id and an artifact/process id share one namespace; the same id
	// in both is invalid and there is no selector to pick one side.
	it.each([
		[
			"a process declaration",
			"process:\n  g: { label: P }\n",
			"a >> p -> b",
			"process",
		],
		[
			"an artifact declaration",
			"artifact:\n  g: { label: A }\n",
			"g >> p",
			"artifact",
		],
		["a body process", "", "a >> g -> b", "process"],
		["a body artifact", "", "g >> p", "artifact"],
		["an isolated body node", "", "g\na >> p -> b", "artifact"],
	])("refuses a group id also used as %s as ambiguous", (_name, extra, body, clashingKind) => {
		const src = `---\ngroup:\n  g: { label: G }\n${extra}---\n${body}\n`;
		expect(rename(src, "g", "h")).toEqual({
			ok: false,
			reason: "ambiguous",
			clashingKind,
		});
	});

	const taken = `---
group:
  g: { label: G }
---
a >> p -> b
`;
	it.each([
		["b", "a", "artifact", "artifact"],
		["b", "p", "artifact", "process"],
		["b", "g", "artifact", "group"],
		["g", "a", "group", "artifact"],
	])("refuses renaming %s onto the existing %s as newExists", (oldId, newId, kind, existingKind) => {
		expect(rename(taken, oldId, newId)).toEqual({
			ok: false,
			reason: "newExists",
			kind,
			existingKind,
		});
	});

	it("refuses an unreadable source (FM004) with its errors", () => {
		const src = "---\nartifact:\n  42: { label: N }\n---\na >> p -> b\n";
		const r = rename(src, "a", "ax");
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.reason).toBe("unreadable");
		if (r.reason !== "unreadable") return;
		expect(r.diagnostics.map((d) => d.code)).toEqual(["FM004"]);
	});

	// Only an unreadable document (FM / L / P) blocks the rewrite. A
	// validation (V) or normalizer (N) error is left to the caller, which
	// judges the result.
	it.each([
		["a validation (V) error", "artifact:\n  a: { status: bogus }\n"],
		[
			"a normalizer (N) error",
			"artifact:\n  x: { label: X }\nprocess:\n  x: { label: X }\n",
		],
	])("still renames when the source carries %s", (_name, frontmatter) => {
		const src = `---\n${frontmatter}---\na >> p -> b\n`;
		const r = rename(src, "b", "bb");
		expect(r).toMatchObject({ ok: true, kind: "artifact" });
		expect(r.ok && r.output).toBe(`---\n${frontmatter}---\na >> p -> bb\n`);
	});
});
