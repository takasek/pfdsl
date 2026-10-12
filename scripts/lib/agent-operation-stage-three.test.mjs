import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { CORPUS_ROOTS, corpusFacts } from "./agent-operation-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

const { own, primary, live } = CORPUS_ROOTS;
function inspect(command, overrides = {}) {
	const payload = {
		tool_name: "Bash",
		cwd: own,
		tool_input: { command },
		...overrides.payload,
	};
	const facts = { ...corpusFacts(overrides.facts), shell: readShell(command) };
	return {
		classified: classifyAgentOperations(payload, facts),
		result: evaluateAgentOperationPolicy(payload, facts),
	};
}

test("properties 2 and 7: ordinary Git destinations and ref roles preserve safety", async (t) => {
	for (const [command, target, decision, classes] of [
		["git init /tmp/x", "scratch", "allow", ["W"]],
		["git clone https://example.invalid/r /tmp/b", "scratch", "allow", ["W"]],
		["git archive HEAD -o /tmp/x.tar", "scratch", "allow", ["W"]],
		["git bundle create /tmp/x.bundle HEAD", "scratch", "allow", ["W"]],
		[`git init ${primary}/x`, "primary", "deny", ["W"]],
		[
			`git clone https://example.invalid/r ${live}/x`,
			"other-live",
			"deny",
			["W"],
		],
		[`git archive HEAD --output=${primary}/x.tar`, "primary", "deny", ["W"]],
		[`git bundle create ${live}/x.bundle HEAD`, "other-live", "deny", ["W"]],
		["git pull origin main", "own", "allow", ["W"]],
		["git pull origin main:main", "own", "deny", ["D"]],
		["git symbolic-ref --short HEAD", "own", "allow", ["R"]],
		["git symbolic-ref HEAD refs/heads/main", "own", "deny", ["D"]],
		["git symbolic-ref HEAD refs/heads/feature", "own", "deny", ["U"]],
		["git reflog delete HEAD", "own", "deny", ["U"]],
		["git reflog HEAD", "own", "allow", ["R"]],
		["git reflog feature", "own", "allow", ["R"]],
		["git reflog refs/heads/feature", "own", "allow", ["R"]],
		["git tag v1", "own", "allow", ["B"]],
		["git hash-object -w a.txt", "own", "allow", ["W"]],
	])
		await t.test(command, () => {
			const { classified, result } = inspect(command);
			assert.equal(result.decision, decision);
			assert.equal(classified.operations[0].target, target);
			assert.deepEqual(classified.operations[0].classes, classes);
		});
	assert.equal(
		inspect(`git -C ${own} commit-tree HEAD^{tree} -m x`, {
			payload: { agent_id: "child" },
			facts: { harness: "codex" },
		}).result.recovery,
		"parent",
	);
});

test("property 7: directory stack and literal environment writes leave mutation targets unresolved", async (t) => {
	for (const command of [
		`pushd ${primary} && git add -A`,
		"pushd /tmp; ls; popd; git add a",
		`export GIT_DIR=${primary}/.git GIT_WORK_TREE=${primary}; git add -A`,
		"GIT_DIR=; git add a",
		"readonly GIT_INDEX_FILE=/tmp/index; git add a",
		`declare GIT_COMMON_DIR=${primary}/.git; git -C ${own} add a`,
		"typeset CDPATH=/tmp; git add a",
		"read -r GIT_OBJECT_DIRECTORY; git add a",
		"printf -v GIT_NAMESPACE '%s' x; git add a",
		"git add a; export GIT_ALTERNATE_OBJECT_DIRECTORIES=/tmp/objects",
	])
		await t.test(command, () => {
			const { classified, result } = inspect(command);
			assert.equal(result.decision, "deny");
			assert.equal(
				classified.operations.find(({ kind }) => kind === "git").target,
				"unresolved",
			);
		});
	assert.equal(inspect("echo GIT_DIR; git add a").result.decision, "allow");
	assert.equal(
		inspect("printf '%s' GIT_DIR; git add a").result.decision,
		"allow",
	);
	assert.equal(
		inspect("read -p GIT_DIR answer; git add a").result.decision,
		"allow",
	);
	assert.equal(
		inspect("git -c color.ui=never commit -m 'export GIT_DIR=x'").result
			.decision,
		"allow",
	);
	assert.equal(inspect("git commit -m 'GIT_DIR=x'").result.decision, "allow");
	assert.equal(inspect("echo GIT_DIR=x; git add a").result.decision, "allow");
	assert.equal(
		inspect("export GIT_DIR=$target; git add a").result.decision,
		"deny",
	);
});

test("properties 1, 5 and 7: literal shell scripts use the same target rules and preserve deny", async (t) => {
	for (const [command, decision] of [
		[`bash -c 'git -C ${primary} commit -m x'`, "deny"],
		[`eval 'git -C ${primary} commit -m x'`, "deny"],
		[`sh -c 'git -C ${live} add a'`, "deny"],
		[`zsh -c 'git -C ${own} add a'`, "allow"],
		[`bash -c 'export GIT_DIR=x; git -C ${own} add a'`, "deny"],
		["bash -c 'git commit --no-verify -m x'; eval '$cmd'", "deny"],
		["bash -c 'git add a; ('", "deny"],
		['bash -c "$script"', "deny"],
		[`cd ${own} && bash -c 'git add a'`, "allow"],
		[`bash -lc 'git -C ${primary} add a'`, "deny"],
		[`bash -ec 'git -C ${primary} add a'`, "deny"],
		[`bash -c -- 'git -C ${primary} add a'`, "deny"],
		[`bash -c -e 'git -C ${primary} add a'`, "deny"],
		[`bash -c -- 'git -C ${own} add a'`, "allow"],
		[`bash -c -e 'git -C ${own} add a'`, "allow"],
		[`eval -- 'git -C ${primary} add a'`, "deny"],
		[`eval -- 'git -C ${own} add a'`, "allow"],
		[`bash -lc 'git -C ${own} add a'`, "allow"],
	])
		await t.test(command, () =>
			assert.equal(inspect(command).result.decision, decision, command),
		);
});

test("hook-process Git target override keeps changing Git unresolved even with explicit C", () => {
	const { result, classified } = inspect(`git -C ${own} add a`, {
		facts: { gitTargetOverride: true },
	});
	assert.equal(result.decision, "deny");
	assert.equal(classified.operations[0].target, "unresolved");
});

test("property 6: child routines return nonverification verbs to the parent", async (t) => {
	for (const prefix of [
		"node -- /personal/codex-git-routine.mjs",
		"/personal/codex-git-routine.mjs",
		"node /personal/codex-git-routine.mjs",
	]) {
		for (const verb of [
			"stage-all",
			"commit",
			"branch-rename",
			"fetch-origin",
			"setup",
		])
			await t.test(`${prefix} ${verb}`, () => {
				const command = `${prefix} ${verb} ${own} feat/own x`;
				const child = inspect(command, {
					facts: { harness: "codex" },
					payload: { agent_id: "child" },
				}).result;
				assert.equal(child.decision, "deny");
				assert.equal(child.recovery, "parent");
				assert.equal(
					inspect(command, { facts: { harness: "codex" } }).result.decision,
					"allow",
				);
			});
		for (const verb of [
			"build",
			"test",
			"typecheck",
			"node-test",
			"node-script",
		])
			assert.equal(
				inspect(`${prefix} ${verb} ${own} feat/own scripts/check.mjs`, {
					facts: { harness: "codex" },
					payload: { agent_id: "child" },
				}).result.decision,
				"allow",
			);
	}
});

test("unresolved target recovery explains why an existing absolute C is insufficient", () => {
	const { result } = inspect(`pushd /tmp; popd; git -C ${own} add a`);
	assert.equal(result.decision, "deny");
	assert.match(result.reason, /directory-stack/);
	assert.match(result.reason, /Git-target/);
});
