import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	extractTypedFields,
	extractSectionText,
	findMissingFields,
} from "./skill-field-drift.mjs";

const TS_FIXTURE = `
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
	it("collects property names per interface, skipping index signatures and comments", () => {
		const fields = extractTypedFields(TS_FIXTURE);
		assert.deepEqual(fields.ArtifactMeta, ["label", "description", "index", "status"]);
		assert.deepEqual(fields.ProcessMeta, ["label", "subflow", "boundary"]);
		assert.deepEqual(fields.GroupMeta, ["label", "parent"]);
	});

	it("collects top-level Frontmatter fields without descending into nested object types", () => {
		const fields = extractTypedFields(TS_FIXTURE);
		assert.deepEqual(fields.Frontmatter, ["title", "layout", "artifact", "basePath", "type"]);
	});
});

describe("extractSectionText", () => {
	it("returns text from the heading up to the next same-level heading", () => {
		const section = extractSectionText(TEMPLATE_FIXTURE, "## Frontmatter structure");
		assert.ok(section.includes("basePath"));
		assert.ok(!section.includes("カウントされない"));
	});

	it("throws when the heading is absent", () => {
		assert.throws(() => extractSectionText("# nothing here", "## Frontmatter structure"));
	});
});

describe("findMissingFields", () => {
	it("returns empty when every typed field is mentioned in the section", () => {
		assert.deepEqual(findMissingFields(TS_FIXTURE, TEMPLATE_FIXTURE), []);
	});

	it("reports fields absent from the section, qualified by interface", () => {
		const template = TEMPLATE_FIXTURE.replace("    index: 1\n", "").replace("basePath: ../\n", "");
		const missing = findMissingFields(TS_FIXTURE, template);
		assert.deepEqual(missing, ["Frontmatter.basePath", "ArtifactMeta.index"]);
	});

	it("does not count mentions outside the frontmatter section", () => {
		const template = TEMPLATE_FIXTURE.replace("    boundary: { parent_id: child_id }\n", "");
		const missing = findMissingFields(TS_FIXTURE, template);
		assert.deepEqual(missing, ["ProcessMeta.boundary"]);
	});
});
