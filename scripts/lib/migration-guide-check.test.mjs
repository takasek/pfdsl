import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pendingUnreleasedHeadings } from "./migration-guide-check.mjs";

const guide = (...sections) =>
	`# Migration guide\n\n${sections.join("\n\n")}\n`;

describe("pendingUnreleasedHeadings", () => {
	it("finds the CLI/plugin Unreleased heading the guide carries today", () => {
		assert.deepEqual(
			pendingUnreleasedHeadings(
				guide(
					"## Choosing the update range\n\nbody",
					"## Unreleased — after CLI/plugin v0.0.26\n\nbody",
					"## Maintaining this guide\n\nbody",
				),
			),
			["## Unreleased — after CLI/plugin v0.0.26"],
		);
	});

	it("finds nothing once the section has been assigned a release", () => {
		assert.deepEqual(
			pendingUnreleasedHeadings(
				guide("## CLI/plugin v0.0.27\n\nbody", "## Maintaining this guide"),
			),
			[],
		);
	});

	it("names CLI or plugin case-insensitively, and each pending heading is listed", () => {
		assert.deepEqual(
			pendingUnreleasedHeadings(
				guide(
					"## Unreleased — after Plugin v0.0.26",
					"## Unreleased: cli changes",
				),
			),
			["## Unreleased — after Plugin v0.0.26", "## Unreleased: cli changes"],
		);
	});

	it("ignores an Unreleased heading that names neither CLI nor plugin", () => {
		assert.deepEqual(
			pendingUnreleasedHeadings(
				guide(
					"## Unreleased — after library v0.0.8",
					"## Unreleased — after VS Code extension v0.0.5",
				),
			),
			[],
		);
	});

	it("ignores headings that only mention Unreleased or sit at another level", () => {
		assert.deepEqual(
			pendingUnreleasedHeadings(
				guide(
					"## CLI/plugin v0.0.27 (was Unreleased)",
					"### Unreleased — CLI/plugin details",
					"# Unreleased CLI/plugin",
				),
			),
			[],
		);
	});

	it("ignores a heading quoted inside a code fence", () => {
		assert.deepEqual(
			pendingUnreleasedHeadings(
				guide(
					"```md\n## Unreleased — after CLI/plugin v0.0.26\n```",
					"~~~\n## Unreleased — CLI\n~~~",
				),
			),
			[],
		);
	});

	it("does not treat body text after a closed fence as fenced", () => {
		assert.deepEqual(
			pendingUnreleasedHeadings(
				guide("```\ncode\n```", "## Unreleased — after CLI/plugin v0.0.27"),
			),
			["## Unreleased — after CLI/plugin v0.0.27"],
		);
	});
});
