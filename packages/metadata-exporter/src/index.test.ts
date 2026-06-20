import { buildGraph, normalizeDocument, parse } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import { extractMetadata, toTsv } from "./index.js";

function buildFromSource(src: string) {
	const { document, frontmatter } = parse(src);
	const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
	const graph = buildGraph(edges, nodeKinds);
	return { graph, frontmatter };
}

describe("toTsv", () => {
	it("outputs header and one row per record", () => {
		const records = [
			{
				kind: "artifact" as const,
				id: "req",
				label: "要件",
				description: "ユーザー要件",
				status: "done" as const,
				tags: ["core", "backend"],
				owner: "alice",
			},
			{
				kind: "process" as const,
				id: "build",
				label: undefined,
				description: undefined,
				status: undefined,
				tags: undefined,
				owner: undefined,
			},
		];
		const tsv = toTsv(records);
		const lines = tsv.split("\n").filter(Boolean);
		expect(lines[0]).toBe("kind\tid\tlabel\tdescription\tstatus\ttags\towner");
		expect(lines[1]).toBe(
			"artifact\treq\t要件\tユーザー要件\tdone\tcore,backend\talice",
		);
		expect(lines[2]).toBe("process\tbuild\t\t\t\t\t");
	});

	it("escapes tabs and newlines in values", () => {
		const records = [
			{
				kind: "artifact" as const,
				id: "a",
				label: "line1\nline2",
				description: "col1\tcol2",
				status: undefined,
				tags: undefined,
				owner: undefined,
			},
		];
		const tsv = toTsv(records);
		const dataLine = tsv.split("\n")[1]!;
		const cols = dataLine.split("\t");
		expect(cols[2]).toBe("line1 line2");
		expect(cols[3]).toBe("col1 col2");
	});
});

describe("extractMetadata", () => {
	it("returns artifact and process records sorted by id", () => {
		const { graph, frontmatter } = buildFromSource("req >> build -> output\n");
		const records = extractMetadata(graph, frontmatter);
		expect(records.map((r) => r.id)).toEqual(["build", "output", "req"]);
		expect(records.find((r) => r.id === "req")?.kind).toBe("artifact");
		expect(records.find((r) => r.id === "build")?.kind).toBe("process");
	});

	it("fills artifact metadata from frontmatter", () => {
		const src = `---
artifact:
  req:
    label: 要件
    description: ユーザーの要件
    status: done
    tags: [core, backend]
    owner: alice
---
req >> build
`;
		const { graph, frontmatter } = buildFromSource(src);
		const rec = extractMetadata(graph, frontmatter).find(
			(r) => r.id === "req",
		)!;
		expect(rec.label).toBe("要件");
		expect(rec.description).toBe("ユーザーの要件");
		expect(rec.status).toBe("done");
		expect(rec.tags).toEqual(["core", "backend"]);
		expect(rec.owner).toBe("alice");
	});

	it("fills process metadata from frontmatter", () => {
		const src = `---
process:
  build:
    label: ビルド
    description: CIでビルド
    owner: bob
---
req >> build
`;
		const { graph, frontmatter } = buildFromSource(src);
		const rec = extractMetadata(graph, frontmatter).find(
			(r) => r.id === "build",
		)!;
		expect(rec.label).toBe("ビルド");
		expect(rec.description).toBe("CIでビルド");
		expect(rec.owner).toBe("bob");
		expect(rec.status).toBeUndefined();
		expect(rec.tags).toBeUndefined();
	});

	it("fills process tags from frontmatter (status stays undefined)", () => {
		const src = `---
process:
  build:
    label: ビルド
    tags: [reusable, audited]
---
req >> build
`;
		const { graph, frontmatter } = buildFromSource(src);
		const rec = extractMetadata(graph, frontmatter).find(
			(r) => r.id === "build",
		)!;
		expect(rec.tags).toEqual(["reusable", "audited"]);
		expect(rec.status).toBeUndefined();
	});

	it("returns undefined for missing frontmatter fields", () => {
		const { graph, frontmatter } = buildFromSource("req >> build\n");
		const records = extractMetadata(graph, frontmatter);
		for (const r of records) {
			expect(r.label).toBeUndefined();
			expect(r.description).toBeUndefined();
		}
	});

	it("handles null frontmatter", () => {
		const { graph } = buildFromSource("req >> build\n");
		const records = extractMetadata(graph, null);
		expect(records).toHaveLength(2);
	});
});
