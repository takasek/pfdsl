import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("pr diff images workflow", () => {
	it("validates the PR number, replaces its artifact directory, and stages deletions", () => {
		const workflow = parse(
			readFileSync(
				resolve(root, ".github/workflows/pr-diff-images.yml"),
				"utf8",
			),
		);
		const step = workflow.jobs["attach-diff-images"].steps.find(
			(candidate) => candidate.name === "Push SVG artifacts to ci-image-store",
		);
		assert.ok(step);
		const command = step.run;
		const validation = command.indexOf('if [[ ! "$PR_NUMBER" =~ ^[0-9]+$ ]]');
		const removal = command.search(
			/rm -rf -- "\/tmp\/ci-image-store\/pfdsl\/pr-\$\{PR_NUMBER\}"/,
		);
		assert.ok(validation >= 0, "PR_NUMBER must be validated as numeric");
		assert.ok(
			removal > validation,
			"the validated per-PR directory must be removed",
		);
		assert.match(command, /git add -A -- "pfdsl\/pr-\$\{PR_NUMBER\}"/);
	});
});
