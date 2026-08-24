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

const PIPELINE_TEXT = `artifact:
  pfd_commands:
    label: commands
    location: ../.claude/commands/
`;

const PIPELINE_COMMANDS = {
	frontmatter: {
		artifact: { pfd_commands: { location: "../.claude/commands/" } },
	},
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
	pipelineText = PIPELINE_TEXT,
	locate = fakeLocate,
} = {}) {
	return {
		readFile: (file) =>
			file.includes("runtime-pipeline") ? pipelineText : WORKFLOW_TEXT,
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
		assert.match(result.stderrLines[0], /reach gen_plugin/);
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

	it("tells the reader how to satisfy the missing wiring", () => {
		const workflow = {
			frontmatter: WORKFLOW.frontmatter,
			edges: [],
		};
		const result = runSkillWiringCheck(
			deps({ workflow, pipeline: { frontmatter: {}, edges: [] } }),
		);
		assert.match(result.stderrLines.join("\n"), /distill_ops -> \[\.\.\.\]/);
		assert.match(
			result.stderrLines.join("\n"),
			/Make it reach `gen_plugin` through primary input\/output edges/,
		);
	});

	it("names only the edges the findings are actually missing", () => {
		// A pipeline-only artifact is never eligible for distill_ops outputs
		// (#944), so telling its reader to add one — and that the artifact "is
		// produced there" — sends them to write an edge the check rejects.
		const mirrors = [
			{ dest: "commands", src: ".claude/commands", files: ["pfd-cycle.md"] },
		];
		const result = runSkillWiringCheck({
			...deps({ pipeline: PIPELINE_COMMANDS }),
			mirrors,
		});
		const stderr = result.stderrLines.join("\n");
		assert.match(
			stderr,
			/Make it reach `gen_plugin` through primary input\/output edges/,
		);
		assert.doesNotMatch(stderr, /distill_ops -> \[\.\.\.\]/);
	});

	it("fails when the manifest carries an entry no artifact models", () => {
		const mirrors = [...MIRRORS, { dest: "hooks", src: "hooks", whole: true }];
		const result = runSkillWiringCheck({ ...deps(), mirrors });
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines.join("\n"), /hooks/);
	});

	it("counts an artifact declared in either graph as modelling the entry", () => {
		const mirrors = [...MIRRORS, { dest: "hooks", src: "hooks", whole: true }];
		const pipeline = {
			frontmatter: {
				artifact: { retro_reminder_hook: { location: "../hooks/" } },
			},
			// A pipeline-only bundled artifact still needs its own gen_plugin
			// inputs edge (#944) — only distill_ops outputs is exempt for it.
			edges: [
				...PIPELINE.edges,
				{
					kind: "input",
					artifact: "retro_reminder_hook",
					process: "gen_plugin",
				},
			],
		};
		const result = runSkillWiringCheck({ ...deps({ pipeline }), mirrors });
		assert.equal(result.exitCode, 0);
	});

	it("anchors a pipeline-only bundled artifact's finding at runtime-pipeline.pfdsl, not workflow.pfdsl (#944)", () => {
		const mirrors = [
			{
				dest: "commands",
				src: ".claude/commands",
				files: ["pfd-cycle.md"],
			},
		];
		const result = runSkillWiringCheck({
			...deps({ pipeline: PIPELINE_COMMANDS }),
			mirrors,
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /runtime-pipeline\.pfdsl:2:/);
		assert.match(result.stderrLines[0], /pfd_commands/);
		assert.match(result.stderrLines[0], /reach gen_plugin/);
		assert.doesNotMatch(result.stderrLines[0], /distill_ops outputs/);
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
