import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { CORPUS_ROOTS, corpusFacts } from "./agent-operation-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

// Immutable snapshots of the owner's supplied transcript inputs: drafts are
// intentionally uncommitted and need not exist in CI.
const frequencies = JSON.parse(
	readFileSync(
		new URL("./__fixtures__/agent-operation-git-verbs.json", import.meta.url),
		"utf8",
	),
);
const supplied = readFileSync(
	new URL("./__fixtures__/agent-operation-git-forms.txt", import.meta.url),
	"utf8",
)
	.trim()
	.split("\n");
const missingForms = {
	diff: "git diff",
	status: "git status",
	log: "git log -1",
	show: "git show HEAD",
	add: "git add a",
	commit: "git commit -m x",
	"rev-parse": "git rev-parse HEAD",
	branch: "git branch -vv",
	fetch: "git fetch origin",
	push: "git push origin HEAD",
	switch: "git switch feat/free",
	checkout: "git checkout feat/free",
	reset: "git reset --soft HEAD",
	merge: "git merge origin/main",
};
const forms = Object.fromEntries(
	supplied.map((command) => [command.split(" ")[1], command]),
);
const facts = corpusFacts();
function classify(command) {
	const payload = {
		tool_name: "Bash",
		cwd: CORPUS_ROOTS.own,
		tool_input: { command },
	};
	const environment = { ...facts, shell: readShell(command) };
	return {
		classified: classifyAgentOperations(payload, environment),
		decision: evaluateAgentOperationPolicy(payload, environment).decision,
	};
}

test("transcript snapshots equal the owner inputs when available", () => {
	for (const [draft, snapshot] of [
		["transcript-git-verbs.json", "agent-operation-git-verbs.json"],
		["transcript-git-verb-forms.txt", "agent-operation-git-forms.txt"],
	]) {
		const original = new URL(`../../drafts/${draft}`, import.meta.url);
		if (existsSync(original)) {
			const before = readFileSync(original, "utf8"),
				after = readFileSync(
					new URL(`./__fixtures__/${snapshot}`, import.meta.url),
					"utf8",
				);
			if (draft.endsWith(".json"))
				assert.deepEqual(JSON.parse(before), JSON.parse(after));
			else assert.equal(before, after);
		}
	}
});

test("property 1: frequent transcript Git verbs have an own normal representative without U", async (t) => {
	const frequent = frequencies.filter(([, count]) => count >= 3);
	assert.equal(frequent.length, 54);
	for (const [verb, count] of frequent) {
		// No standard representative was supplied for this extracted word.
		// Keep it visible instead of manufacturing `--help` to pass coverage.
		if (verb === "metadata") {
			await t.test(
				`${verb} (${count}): input needs owner clarification`,
				{ skip: "recorded in drafts/open-questions.md" },
				() => {},
			);
			continue;
		}
		await t.test(`${verb} (${count})`, () => {
			const command = forms[verb] ?? missingForms[verb];
			assert.equal(typeof command, "string", `missing representative: ${verb}`);
			const { classified, decision } = classify(command);
			assert.equal(
				classified.operations.some(({ classes }) => classes.includes("U")),
				false,
				command,
			);
			assert.equal(decision, "allow", command);
		});
	}
});

test("property 1: acceptance readers and own work beyond the frequency threshold allow", async (t) => {
	for (const command of [
		...supplied,
		"git shortlog -sn",
		"git range-diff a...b",
		"git count-objects -v",
		"git format-patch -1",
		"git pull --rebase",
		"git pull --ff-only",
		"git pull origin main",
		"git reflog show",
		"git reflog list",
		"git reflog exists HEAD",
		"git bisect start",
		"git submodule update --init",
	])
		await t.test(command, () =>
			assert.equal(classify(command).decision, "allow", command),
		);
});
