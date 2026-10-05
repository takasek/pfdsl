import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";
import {
	OPERATIONAL_SVG,
	operationalSvgSource,
} from "./operational-svg-contract.mjs";

const workflow = parse(
	readFileSync(
		new URL("../../.github/workflows/render-pfdsl-svg.yml", import.meta.url),
		"utf8",
	),
);

function assertWorkflowContract(workflow) {
	assert.deepEqual(workflow.on.push.paths, [OPERATIONAL_SVG.sourceGlob]);
	for (const trigger of ["workflow_dispatch", "workflow_call"])
		assert.equal(
			workflow.on[trigger].inputs.paths.default,
			OPERATIONAL_SVG.sourceGlob,
		);
	let fallbacks = 0;
	for (const job of Object.values(workflow.jobs)) {
		for (const step of job.steps ?? []) {
			if (step.env?.FILE_PATTERNS || step.run?.includes("FILE_PATTERNS")) {
				assert.equal(
					step.env?.FILE_PATTERNS,
					`\${{ inputs.paths || '${OPERATIONAL_SVG.sourceGlob}' }}`,
				);
				fallbacks++;
			}
		}
	}
	assert.ok(fallbacks > 0);
}

test("renderer workflow defaults and every execution fallback match the shared SVG contract", () => {
	assertWorkflowContract(workflow);
});

test("changing any workflow default or execution fallback is detected", () => {
	const changedPush = structuredClone(workflow);
	changedPush.on.push.paths = ["docs/**/*.pfdsl"];
	assert.throws(() => assertWorkflowContract(changedPush));
	for (const trigger of ["workflow_dispatch", "workflow_call"]) {
		const changed = structuredClone(workflow);
		changed.on[trigger].inputs.paths.default = "docs/**/*.pfdsl";
		assert.throws(() => assertWorkflowContract(changed));
	}
	for (const [name, job] of Object.entries(workflow.jobs)) {
		for (const [index, step] of job.steps.entries()) {
			if (!step.env?.FILE_PATTERNS) continue;
			const changed = structuredClone(workflow);
			changed.jobs[name].steps[index].env.FILE_PATTERNS = "docs/**/*.pfdsl";
			assert.throws(() => assertWorkflowContract(changed));
		}
	}
});

test("shared ownership includes direct and nested siblings but excludes unsafe and foreign paths", () => {
	for (const path of [".pfdsl/pipeline.svg", ".pfdsl/a/b/diagram.svg"])
		assert.equal(operationalSvgSource(path), path.replace(/\.svg$/, ".pfdsl"));
	for (const path of [
		"docs/samples/a.svg",
		".pfdsl/../a.svg",
		".pfdsl/./a.svg",
		".pfdsl//a.svg",
		".pfdsl/a.svg.extra",
		".pfdsl/a\nb.svg",
	])
		assert.equal(operationalSvgSource(path), undefined, path);
});
