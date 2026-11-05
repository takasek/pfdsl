import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

function resolveCredential(expression, context) {
	const value = (path) =>
		path.split(".").reduce((item, key) => item?.[key], context) ?? "";
	for (const branch of expression.slice(3, -3).trim().split(" || ")) {
		let result;
		for (const term of branch.split(" && ")) {
			const comparison = /^(\w+\.\w+) (==|!=) ''$/.exec(term);
			result = comparison
				? (value(comparison[1]) === "") === (comparison[2] === "==")
				: value(term);
			if (!result) break;
		}
		if (result) return result;
	}
	return "";
}

test("shared sweep credentials take precedence without borrowing a legacy key", () => {
	const workflow = parse(
		readFileSync(
			new URL(
				"../.github/workflows/pfdsl-sweep-completed-chains.yml",
				import.meta.url,
			),
			"utf8",
		),
	);
	const inputs = workflow.jobs["sweep-completed-chains"].steps.find(
		(step) => step.id === "app-token",
	).with;
	const legacy = {
		vars: { PFDSL_SWEEP_APP_CLIENT_ID: "old-id" },
		secrets: { PFDSL_SWEEP_APP_PRIVATE_KEY: "old-key" },
	};
	assert.equal(resolveCredential(inputs["client-id"], legacy), "old-id");
	assert.equal(resolveCredential(inputs["private-key"], legacy), "old-key");
	const shared = structuredClone(legacy);
	shared.vars.REPO_AUTOMATION_APP_CLIENT_ID = "shared-id";
	assert.equal(resolveCredential(inputs["client-id"], shared), "shared-id");
	assert.equal(resolveCredential(inputs["private-key"], shared), "");
	shared.secrets.REPO_AUTOMATION_APP_PRIVATE_KEY = "shared-key";
	assert.equal(resolveCredential(inputs["private-key"], shared), "shared-key");
});

test("PR automation shares one credential and narrows token permissions per job", () => {
	const cases = [
		[
			"dependabot-actions-integrate.yml",
			"integrate",
			{ contents: "write", "pull-requests": "write", workflows: "write" },
		],
		[
			"repair-generated-conflicts-attempt.yml",
			"publish",
			{ contents: "write", "pull-requests": "read", workflows: "write" },
		],
		[
			"pfdsl-sweep-completed-chains.yml",
			"sweep-completed-chains",
			{ contents: "write", "pull-requests": "write" },
		],
	];
	for (const [file, job, expected] of cases) {
		const workflow = parse(
			readFileSync(
				new URL(`../.github/workflows/${file}`, import.meta.url),
				"utf8",
			),
		);
		const step = workflow.jobs[job].steps.find(
			(value) => value.id === "app-token",
		);
		assert.match(step.with["client-id"], /vars\.REPO_AUTOMATION_APP_CLIENT_ID/);
		assert.match(
			step.with["private-key"],
			/secrets\.REPO_AUTOMATION_APP_PRIVATE_KEY/,
		);
		assert.deepEqual(
			Object.fromEntries(
				Object.entries(step.with)
					.filter(([key]) => key.startsWith("permission-"))
					.map(([key, value]) => [key.slice(11), value]),
			),
			expected,
		);
	}
});
