import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
	extractSectionText,
	extractTypedFields,
	findMissingFields,
} from "./skill-field-drift.mjs";

const TS_FIXTURE = `
type Status = "done";
type PfdType = "roadmap";
export interface ArtifactMeta {
	label?: string;
	description?: string;
	/** Optional positive-integer node index. */
	index?: number;
	status?: Status;
	[key: string]: unknown;
}

export interface ProcessMeta {
	label?: string;
	subflow?: string;
	boundary?: Record<string, string>;
	[key: string]: unknown;
}

export interface GroupMeta {
	label?: string;
	parent?: string;
	[key: string]: unknown;
}

export interface TagMeta {
	label?: string;
}

export interface Frontmatter {
	title?: string;
	layout?: {
		direction?: "LR" | "RL" | "TB" | "BT";
		maxWidth?: number;
		[key: string]: unknown;
	};
	artifact?: Record<string, ArtifactMeta>;
	basePath?: string;
	type?: PfdType;
	[key: string]: unknown;
}
`;

const TEMPLATE_FIXTURE = `
# Some skill

## Frontmatter structure

\`\`\`yaml
title: ...
type: roadmap
basePath: ../
artifact:
  <id>:
    label: ...
    description: ...
    status: done
    index: 1
process:
  <id>:
    label: ...
    subflow: child.pfdsl
    boundary: { parent_id: child_id }
group:
  <id>:
    label: ...
    parent: <group-id>
layout:
  direction: LR
\`\`\`

その他のフィールドは spec 参照。

## CLI

boundary という語がセクション外に出てもカウントされないことを確認する。
`;

describe("extractTypedFields", () => {
	it("resolves all five schema-derived aliases in the actual source", () => {
		const source = readFileSync(
			"packages/core/src/types/frontmatter.ts",
			"utf8",
		);
		const fields = extractTypedFields(source);
		assert.equal(Object.keys(fields).length, 5);
		assert.ok(fields.ProcessMeta.includes("boundary"));
		assert.ok(fields.ArtifactMeta.includes("revises"));
		assert.ok(fields.ProcessMeta.includes("externalStakeholders"));
		assert.ok(fields.TagMeta.includes("style"));
		assert.ok(!fields.Frontmatter.includes("direction"));
		assert.ok(!fields.Frontmatter.includes("maxWidth"));
	});

	it("rejects missing, empty and unresolved definitions", () => {
		for (const source of [
			"",
			TS_FIXTURE.replace("export interface TagMeta", "interface MissingTag"),
			TS_FIXTURE.replace("label?: string;\n}", "}\n"),
			TS_FIXTURE.replace(
				"export interface TagMeta {\n\tlabel?: string;\n}",
				"export type TagMeta = MissingSchema;",
			),
		]) {
			assert.throws(() => extractTypedFields(source), /field|definition/i);
		}
	});
	it("collects property names per interface, skipping index signatures and comments", () => {
		const fields = extractTypedFields(TS_FIXTURE);
		assert.deepEqual(fields.ArtifactMeta, [
			"label",
			"description",
			"index",
			"status",
		]);
		assert.deepEqual(fields.ProcessMeta, ["label", "subflow", "boundary"]);
		assert.deepEqual(fields.GroupMeta, ["label", "parent"]);
	});

	it("collects top-level Frontmatter fields without descending into nested object types", () => {
		const fields = extractTypedFields(TS_FIXTURE);
		assert.deepEqual(fields.Frontmatter, [
			"title",
			"layout",
			"artifact",
			"basePath",
			"type",
		]);
	});
});

describe("extractSectionText", () => {
	it("returns text from the heading up to the next same-level heading", () => {
		const section = extractSectionText(
			TEMPLATE_FIXTURE,
			"## Frontmatter structure",
		);
		assert.ok(section.includes("basePath"));
		assert.ok(!section.includes("カウントされない"));
	});

	it("throws when the heading is absent", () => {
		assert.throws(() =>
			extractSectionText("# nothing here", "## Frontmatter structure"),
		);
	});
});

describe("findMissingFields", () => {
	it("reports actual schema fields for an empty section and fields only named elsewhere", () => {
		const source = readFileSync(
			"packages/core/src/types/frontmatter.ts",
			"utf8",
		);
		const empty = "## Frontmatter structure\n\n## Other\nboundary revises\n";
		const missing = findMissingFields(source, empty);
		assert.ok(missing.includes("ProcessMeta.boundary"));
		assert.ok(missing.includes("ArtifactMeta.revises"));
		assert.equal(
			missing.length,
			Object.values(extractTypedFields(source)).flat().length,
		);
	});

	it("checks the maintained template against the actual schema and detects removed mentions", () => {
		const source = readFileSync(
			"packages/core/src/types/frontmatter.ts",
			"utf8",
		);
		const template = readFileSync("scripts/skill-template/SKILL.md", "utf8");
		assert.deepEqual(findMissingFields(source, template), []);
		const missing = findMissingFields(
			source,
			template
				.replaceAll(/\bboundary\b/g, "removedBoundary")
				.replaceAll(/\brevises\b/g, "removedRevises"),
		);
		assert.ok(missing.includes("ProcessMeta.boundary"));
		assert.ok(missing.includes("ArtifactMeta.revises"));
	});
	it("returns empty when every typed field is mentioned in the section", () => {
		assert.deepEqual(findMissingFields(TS_FIXTURE, TEMPLATE_FIXTURE), []);
	});

	it("reports fields absent from the section, qualified by interface", () => {
		const template = TEMPLATE_FIXTURE.replace("    index: 1\n", "").replace(
			"basePath: ../\n",
			"",
		);
		const missing = findMissingFields(TS_FIXTURE, template);
		assert.deepEqual(missing, ["Frontmatter.basePath", "ArtifactMeta.index"]);
	});

	it("does not count mentions outside the frontmatter section", () => {
		const template = TEMPLATE_FIXTURE.replace(
			"    boundary: { parent_id: child_id }\n",
			"",
		);
		const missing = findMissingFields(TS_FIXTURE, template);
		assert.deepEqual(missing, ["ProcessMeta.boundary"]);
	});
});
