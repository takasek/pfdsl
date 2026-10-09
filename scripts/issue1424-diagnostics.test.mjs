import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	instrumentRunner,
	replaceOnce,
} from "./issue1424-diagnostics/prepare.mjs";

test("ambiguous or absent instrumentation anchors fail closed", () => {
	assert.throws(() => replaceOnce("x x", "x", "y"), /exactly once/);
	assert.throws(() => replaceOnce("z", "x", "y"), /exactly once/);
	assert.equal(replaceOnce("x z", "x", "y"), "y z");
});

test("runner instrumentation preserves launch, scenario order, and close wait", () => {
	const fixture = `export async function closeSourceTab() {
	return withWorkbenchOperation(
		page,
		"close source tab",
		async () => {
			await sourceTab.getByRole("button", { name: /^Close \\(/ }).click();
			return expectEventually("original condition", readState, originalPredicate, { timeoutMs });
		},
		{ ...(log ? { log } : {}), ...(log ? { readState } : {}) },
	);
}

async function submitQuickInput() {}
page = await waitForWorkbenchPage(browser);
await assertPreviewInteractions(session);
await assertPreviewUsability(session);
await assertDefinitionQuickFix(session);
await assertPreviewEditingFocus(session);
await assertHiddenSourceExternalChange(session);
await closeSourceTab(page, sourceTab);
await closeSourceTab(page, sourceTab);
const cleanupErrors = await cleanupSmokeSession({ browser, runDir, vscodeProcess });
if (session) {
			const cleanupErrors = await cleanupSmokeSession(session);
}
`;
	const result = instrumentRunner(fixture);
	assert.ok(
		result.includes(
			'expectEventually("original condition", readState, originalPredicate, { timeoutMs })',
		),
	);
	assert.ok(
		result.includes(
			"await preserveSession({ page, profileDir, fixturePath: undefined, output, vscodeProcess });",
		),
	);
	assert.ok(result.includes("await preserveSession(session);"));
	assert.equal(
		result.match(/await assert\w+\(session\);/g).join("\n"),
		fixture.match(/await assert\w+\(session\);/g).join("\n"),
	);
	assert.ok(!result.includes("PFDSL_DIAG_VSCODE"));
	assert.ok(!result.includes(".filter((arg)"));
	assert.ok(!result.includes("waitForSavedSource"));
	const comparison = instrumentRunner(fixture, { waitForSave: true });
	assert.equal(comparison.split("await waitForSavedSource(").length - 1, 2);
	assert.equal(
		comparison.split("await closeSourceTab(page, sourceTab);").length - 1,
		2,
	);
	assert.ok(comparison.includes("originalPredicate, { timeoutMs }"));
	assert.throws(
		() =>
			instrumentRunner(
				fixture.replaceAll("await closeSourceTab(page, sourceTab);", ""),
				{ waitForSave: true },
			),
		/exactly two/,
	);
});

test("CI records failed runs without converting them into success", () => {
	const workflow = readFileSync(
		new URL("../.github/workflows/issue1424-diagnostics.yml", import.meta.url),
		"utf8",
	);
	assert.match(workflow, /if: always\(\)/);
	assert.match(workflow, /set -o pipefail/);
	assert.doesNotMatch(workflow, /continue-on-error|retry|sleep/);
	assert.match(workflow, /526e17c070bb1447ebf3f74192db2fef391b60a8/);
});

test("job-level env does not use the step-only runner context", () => {
	const workflow = readFileSync(
		new URL("../.github/workflows/issue1424-diagnostics.yml", import.meta.url),
		"utf8",
	);
	const jobEnv = workflow.slice(
		workflow.indexOf("    env:"),
		workflow.indexOf("    steps:"),
	);
	assert.doesNotMatch(jobEnv, /runner\./);
});
