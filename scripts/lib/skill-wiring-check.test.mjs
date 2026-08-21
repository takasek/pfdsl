import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	edgeMembers,
	findUnmodeledMirrors,
	findUnwiredSkills,
	isBundledSource,
	repoRelative,
} from "./skill-wiring-check.mjs";

/** The shape of gen-plugin's PLUGIN_MIRRORS, with this repo's current members. */
const MIRRORS = [
	{
		dest: "skills",
		src: ".claude/skills",
		trees: ["pfd-grill", "pfd-ops", "pfd-retro"],
	},
	{ dest: "agents", src: ".claude/agents", files: ["pfd-lens.md"] },
	{ dest: "hooks", src: "hooks", whole: true },
];

const ARTIFACTS = {
	retro_skill: { location: "../.claude/skills/pfd-retro/" },
	grill_skill: { location: "../.claude/skills/pfd-grill/" },
	ops_skill_l3: {
		location: "../.claude/skills/pfd-ops/references/github-issues-backend.md",
	},
	pfd_lens_agent: { location: "../.claude/agents/pfd-lens.md" },
	pfdsl_skill: { location: "../.claude/skills/pfdsl/" },
	vscode_ext_debug_skill: { location: "../.claude/skills/vscode-ext-debug/" },
	feature_samples: { location: "../docs/samples/" },
	adrs: {},
};

const WORKFLOW_EDGES = [
	{ kind: "output", artifact: "retro_skill", process: "distill_ops" },
	{ kind: "output", artifact: "grill_skill", process: "distill_ops" },
	{ kind: "output", artifact: "ops_skill_l3", process: "distill_ops" },
	{ kind: "output", artifact: "pfd_lens_agent", process: "distill_ops" },
	{ kind: "feedback", artifact: "pfdsl_skill", process: "write_examples" },
];

const PIPELINE_EDGES = [
	{ kind: "input", artifact: "retro_skill", process: "gen_plugin" },
	{ kind: "input", artifact: "grill_skill", process: "gen_plugin" },
	{ kind: "input", artifact: "ops_skill_l3", process: "gen_plugin" },
	{ kind: "input", artifact: "pfd_lens_agent", process: "gen_plugin" },
	{ kind: "output", artifact: "pfdsl_skill", process: "gen_skill" },
	{ kind: "output", artifact: "plugin_dist", process: "gen_plugin" },
];

describe("repoRelative", () => {
	it("strips the companion-relative prefix", () => {
		assert.equal(
			repoRelative("../.claude/skills/pfd-retro/"),
			".claude/skills/pfd-retro/",
		);
		assert.equal(repoRelative("./docs/samples/"), "docs/samples/");
		assert.equal(
			repoRelative(".claude/agents/pfd-lens.md"),
			".claude/agents/pfd-lens.md",
		);
	});
});

describe("isBundledSource", () => {
	it("accepts a directory the manifest mirrors as a tree", () => {
		assert.equal(isBundledSource(".claude/skills/pfd-retro/", MIRRORS), true);
	});

	it("accepts a file inside a mirrored tree", () => {
		assert.equal(
			isBundledSource(
				".claude/skills/pfd-ops/references/github-issues-backend.md",
				MIRRORS,
			),
			true,
		);
	});

	it("accepts a file the manifest names individually", () => {
		assert.equal(isBundledSource(".claude/agents/pfd-lens.md", MIRRORS), true);
	});

	it("rejects a sibling the manifest does not carry", () => {
		assert.equal(
			isBundledSource(".claude/skills/vscode-ext-debug/", MIRRORS),
			false,
		);
		assert.equal(
			isBundledSource(".claude/agents/other-agent.md", MIRRORS),
			false,
		);
	});

	it("rejects a path under no mirror at all", () => {
		assert.equal(isBundledSource("docs/samples/", MIRRORS), false);
	});

	it("accepts anything under a whole-tree mirror", () => {
		assert.equal(isBundledSource("hooks/anything.mjs", MIRRORS), true);
	});

	it("accepts the whole-tree mirror's own directory", () => {
		// An artifact modelling the directory points at it, not into it.
		assert.equal(isBundledSource("hooks/", MIRRORS), true);
		assert.equal(isBundledSource("hooks", MIRRORS), true);
	});

	it("accepts the parent of a trees/files mirror, which contains its listed members", () => {
		// The directory contains listed members (pfd-grill, pfd-ops, ...), so it
		// overlaps them the same way an artifact on the directory covers them in
		// findUnmodeledMirrors (#780's pfd_commands case, pinned below).
		assert.equal(isBundledSource(".claude/skills/", MIRRORS), true);
		assert.equal(isBundledSource(".claude/agents", MIRRORS), true);
	});

	it("still rejects a directory that contains none of a mirror's listed members", () => {
		assert.equal(isBundledSource("docs/", MIRRORS), false);
		assert.equal(
			isBundledSource(".claude/skills/vscode-ext-debug/", MIRRORS),
			false,
		);
	});

	it("accepts a files-mirror's src directory, the pfd_commands shape (#944)", () => {
		const commandMirrors = [
			{
				dest: "commands",
				src: ".claude/commands",
				files: ["pfd-cycle.md", "pfd-init.md", "pfd-retro.md"],
			},
		];
		assert.equal(isBundledSource(".claude/commands/", commandMirrors), true);
	});
});

describe("edgeMembers", () => {
	it("reads one process's inputs", () => {
		const members = edgeMembers(PIPELINE_EDGES, {
			kind: "input",
			process: "gen_plugin",
		});
		assert.equal(members.has("retro_skill"), true);
		assert.equal(members.has("plugin_dist"), false);
	});

	it("reads everything produced anywhere when no process is named", () => {
		const produced = edgeMembers(PIPELINE_EDGES, { kind: "output" });
		assert.deepEqual([...produced].sort(), ["pfdsl_skill", "plugin_dist"]);
	});

	it("keeps feedback edges out of input membership", () => {
		assert.equal(
			edgeMembers(WORKFLOW_EDGES, { kind: "input", process: "write_examples" })
				.size,
			0,
		);
	});
});

describe("findUnmodeledMirrors", () => {
	const run = (overrides = {}) =>
		findUnmodeledMirrors({
			artifacts: ARTIFACTS,
			mirrors: MIRRORS,
			...overrides,
		});

	it("reports a manifest member no artifact's location sits under — the hooks case", () => {
		assert.deepEqual(run(), [{ dest: "hooks", member: "hooks" }]);
	});

	it("stays silent once one artifact points into the member", () => {
		const artifacts = {
			...ARTIFACTS,
			retro_reminder_hook: { location: "../hooks/" },
		};
		assert.deepEqual(run({ artifacts }), []);
	});

	it("reports a member added to the manifest before its artifact exists", () => {
		const mirrors = [
			...MIRRORS,
			{ dest: "newcomer", src: ".claude/newcomer", whole: true },
		];
		const artifacts = {
			...ARTIFACTS,
			retro_reminder_hook: { location: "../hooks/" },
		};
		assert.deepEqual(run({ artifacts, mirrors }), [
			{ dest: "newcomer", member: ".claude/newcomer" },
		]);
	});

	it("reports one member of a multi-member entry whose artifact is gone, while its siblings stay covered", () => {
		// The entry-level answer to this is "skills has artifacts, so it is
		// modelled" — which is how a whole skill tree drops out of both graphs
		// without a word.
		const artifacts = {
			...ARTIFACTS,
			retro_reminder_hook: { location: "../hooks/" },
		};
		delete artifacts.ops_skill_l3;
		assert.deepEqual(run({ artifacts }), [
			{ dest: "skills", member: ".claude/skills/pfd-ops" },
		]);
	});

	it("counts one artifact on the entry's directory as covering every member under it", () => {
		// `pfd_commands` models three individually-listed files as one artifact
		// on the directory (#780). Covering an ancestor covers its members.
		const mirrors = [
			{
				dest: "commands",
				src: ".claude/commands",
				files: ["pfd-cycle.md", "pfd-init.md"],
			},
		];
		const artifacts = { pfd_commands: { location: "../.claude/commands/" } };
		assert.deepEqual(findUnmodeledMirrors({ artifacts, mirrors }), []);
	});

	it("counts an artifact on a file inside a member as covering that member", () => {
		// ops_skill_l3 points at one reference file inside the pfd-ops tree.
		const mirrors = [
			{ dest: "skills", src: ".claude/skills", trees: ["pfd-ops"] },
		];
		const artifacts = { ops_skill_l3: ARTIFACTS.ops_skill_l3 };
		assert.deepEqual(findUnmodeledMirrors({ artifacts, mirrors }), []);
	});

	it("counts an array location whose entry sits under the mirror", () => {
		const artifacts = {
			...ARTIFACTS,
			multi: { location: ["../docs/samples/", "../hooks/hooks.json"] },
		};
		assert.deepEqual(run({ artifacts }), []);
	});
});

describe("findUnwiredSkills", () => {
	const run = (overrides = {}) =>
		findUnwiredSkills({
			workflowArtifacts: ARTIFACTS,
			pipelineArtifacts: {},
			workflowEdges: WORKFLOW_EDGES,
			pipelineEdges: PIPELINE_EDGES,
			mirrors: MIRRORS,
			...overrides,
		});

	it("reports nothing when every bundled hand-written artifact is on both edges", () => {
		assert.deepEqual(run(), []);
	});

	it("reports an artifact missing from both edges — the #481 case", () => {
		const artifacts = {
			...ARTIFACTS,
			newcomer_skill: { location: "../.claude/skills/pfd-ops/" },
		};
		const found = run({ workflowArtifacts: artifacts });
		assert.deepEqual(found, [
			{
				id: "newcomer_skill",
				location: "../.claude/skills/pfd-ops/",
				missing: ["distill_ops outputs", "gen_plugin inputs"],
				declaredIn: "workflow",
			},
		]);
	});

	it("reports an artifact wired on only one edge", () => {
		const pipelineEdges = PIPELINE_EDGES.filter(
			(edge) => edge.artifact !== "grill_skill",
		);
		const found = run({ pipelineEdges });
		assert.equal(found.length, 1);
		assert.equal(found[0].id, "grill_skill");
		assert.deepEqual(found[0].missing, ["gen_plugin inputs"]);
	});

	it("ignores a skill the bundle manifest does not mirror", () => {
		assert.equal(
			run().some((f) => f.id === "vscode_ext_debug_skill"),
			false,
		);
	});

	it("ignores an artifact the runtime pipeline produces", () => {
		// pfdsl_skill is generated and reaches the bundle through its sources.
		// The manifest already excludes it; this pins the second reason too.
		const mirrors = [
			{
				dest: "skills",
				src: ".claude/skills",
				trees: ["pfd-retro", "pfd-grill", "pfd-ops", "pfdsl"],
			},
		];
		assert.equal(
			run({ mirrors }).some((f) => f.id === "pfdsl_skill"),
			false,
		);
	});

	it("ignores artifacts with no location, and locations outside the bundle", () => {
		const ids = run().map((f) => f.id);
		assert.equal(ids.includes("adrs"), false);
		assert.equal(ids.includes("feature_samples"), false);
	});

	it("treats an array location as bundled when any entry matches a mirror", () => {
		const artifacts = {
			...ARTIFACTS,
			multi_location_skill: {
				location: ["../docs/samples/", "../.claude/skills/pfd-ops/"],
			},
		};
		const found = run({ workflowArtifacts: artifacts });
		assert.deepEqual(found, [
			{
				id: "multi_location_skill",
				location: ["../docs/samples/", "../.claude/skills/pfd-ops/"],
				missing: ["distill_ops outputs", "gen_plugin inputs"],
				declaredIn: "workflow",
			},
		]);
	});

	it("ignores an artifact whose array location has no bundled entry", () => {
		const artifacts = {
			...ARTIFACTS,
			no_bundle_skill: {
				location: ["../docs/samples/", "../not/bundled/anywhere.md"],
			},
		};
		assert.equal(
			run({ workflowArtifacts: artifacts }).some(
				(f) => f.id === "no_bundle_skill",
			),
			false,
		);
	});

	it("keeps scalar-location behavior unchanged", () => {
		const artifacts = {
			...ARTIFACTS,
			newcomer_skill: { location: "../.claude/skills/pfd-ops/" },
		};
		const found = run({ workflowArtifacts: artifacts });
		assert.deepEqual(found, [
			{
				id: "newcomer_skill",
				location: "../.claude/skills/pfd-ops/",
				missing: ["distill_ops outputs", "gen_plugin inputs"],
				declaredIn: "workflow",
			},
		]);
	});

	it("reports an artifact declared in both graphs once, as workflow-declared", () => {
		// Every bundled artifact but pfd_commands is declared in both graphs, so
		// scanning the two pools naively doubles the common case: one finding per
		// declaration, anchored at a different file each, for the same defect.
		const pipelineArtifacts = { retro_skill: ARTIFACTS.retro_skill };
		const pipelineEdges = PIPELINE_EDGES.filter(
			(edge) => edge.artifact !== "retro_skill",
		);
		const found = run({ pipelineArtifacts, pipelineEdges });
		assert.deepEqual(found, [
			{
				id: "retro_skill",
				location: "../.claude/skills/pfd-retro/",
				missing: ["gen_plugin inputs"],
				declaredIn: "workflow",
			},
		]);
	});

	it("requires only gen_plugin inputs of a pipeline-only bundled artifact, the pfd_commands case (#944)", () => {
		const pipelineArtifacts = {
			pfd_commands: { location: "../.claude/commands/" },
		};
		const mirrors = [
			{
				dest: "commands",
				src: ".claude/commands",
				files: ["pfd-cycle.md", "pfd-init.md", "pfd-retro.md"],
			},
		];
		const found = run({
			pipelineArtifacts,
			mirrors,
			pipelineEdges: [],
		});
		assert.deepEqual(found, [
			{
				id: "pfd_commands",
				location: "../.claude/commands/",
				missing: ["gen_plugin inputs"],
				declaredIn: "pipeline",
			},
		]);
	});

	it("reports nothing for a pipeline-only bundled artifact once gen_plugin inputs carries it", () => {
		const pipelineArtifacts = {
			pfd_commands: { location: "../.claude/commands/" },
		};
		const mirrors = [
			{
				dest: "commands",
				src: ".claude/commands",
				files: ["pfd-cycle.md", "pfd-init.md", "pfd-retro.md"],
			},
		];
		const pipelineEdges = [
			{ kind: "input", artifact: "pfd_commands", process: "gen_plugin" },
		];
		const found = run({ pipelineArtifacts, mirrors, pipelineEdges });
		assert.equal(
			found.some((f) => f.id === "pfd_commands"),
			false,
		);
	});
});
