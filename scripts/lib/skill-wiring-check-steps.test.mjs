import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runSkillWiringCheck } from "./skill-wiring-check-steps.mjs";

const MIRRORS = [
	{ dest: "skills", src: ".claude/skills", trees: ["pfd-retro"] },
];

const WORKFLOW_TEXT = `artifact:
  retro_skill:
    label: audit skill
    location: ../.claude/skills/pfd-retro/
`;

const WORKFLOW = {
	frontmatter: {
		artifact: { retro_skill: { location: "../.claude/skills/pfd-retro/" } },
	},
	edges: [{ kind: "output", artifact: "retro_skill", process: "distill_ops" }],
};

const WORKFLOW_MULTI_LOCATION = {
	frontmatter: {
		artifact: {
			retro_skill: {
				location: [
					"../.claude/skills/pfd-retro/",
					"../.claude/skills/pfd-retro-patterns/",
				],
			},
		},
	},
	edges: [{ kind: "output", artifact: "retro_skill", process: "distill_ops" }],
};

const PIPELINE = {
	frontmatter: { artifact: {} },
	edges: [{ kind: "input", artifact: "retro_skill", process: "gen_plugin" }],
};

/** Stands in for @pfdsl/core's locateNode: a frontmatter section key's line, by text search. */
function fakeLocate(_document, source, id) {
	const lines = source.split("\n");
	const index = lines.findIndex((line) => line.trimEnd() === `  ${id}:`);
	return { declarationLine: index === -1 ? null : index + 1 };
}

function deps({
	workflow = WORKFLOW,
	pipeline = PIPELINE,
	locate = fakeLocate,
} = {}) {
	return {
		readFile: (file) =>
			file.includes("runtime-pipeline") ? "" : WORKFLOW_TEXT,
		analyzeFile: (text) => (text === WORKFLOW_TEXT ? workflow : pipeline),
		locate,
		mirrors: MIRRORS,
	};
}

describe("runSkillWiringCheck", () => {
	it("passes and says so when both edges carry the artifact", () => {
		const result = runSkillWiringCheck(deps());
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.stdoutLines, ["check-skill-wiring: OK"]);
		assert.deepEqual(result.stderrLines, []);
	});

	it("fails, naming the missing edge and the declaration line", () => {
		const result = runSkillWiringCheck(
			deps({ pipeline: { frontmatter: {}, edges: [] } }),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /workflow\.pfdsl:2:/);
		assert.match(result.stderrLines[0], /retro_skill/);
		assert.match(result.stderrLines[0], /gen_plugin inputs/);
	});

	it("locates the declaration line by delegating to the injected locate function", () => {
		const calls = [];
		const result = runSkillWiringCheck(
			deps({
				pipeline: { frontmatter: {}, edges: [] },
				locate: (document, source, id, kind) => {
					calls.push({ document, source, id, kind });
					return fakeLocate(document, source, id);
				},
			}),
		);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0], {
			document: WORKFLOW.document,
			source: WORKFLOW_TEXT,
			id: "retro_skill",
			kind: "artifact",
		});
		assert.match(result.stderrLines[0], /workflow\.pfdsl:2:/);
	});

	it("still reports when the declaration line cannot be located", () => {
		const workflow = {
			frontmatter: {
				artifact: {
					absent_skill: { location: "../.claude/skills/pfd-retro/" },
				},
			},
			edges: [],
		};
		const result = runSkillWiringCheck(
			deps({ workflow, pipeline: { frontmatter: {}, edges: [] } }),
		);
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/^\.pfdsl\/workflow\.pfdsl: 'absent_skill'/,
		);
	});

	it("tells the reader where to add the missing edges", () => {
		const result = runSkillWiringCheck(
			deps({ pipeline: { frontmatter: {}, edges: [] } }),
		);
		assert.match(result.stderrLines.join("\n"), /distill_ops -> \[\.\.\.\]/);
		assert.match(result.stderrLines.join("\n"), /\[\.\.\.\] >> gen_plugin/);
	});

	it("lists every location when an array-location artifact is reported", () => {
		const result = runSkillWiringCheck(
			deps({
				workflow: WORKFLOW_MULTI_LOCATION,
				pipeline: { frontmatter: {}, edges: [] },
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /pfd-retro\//);
		assert.match(result.stderrLines[0], /pfd-retro-patterns\//);
	});
});
