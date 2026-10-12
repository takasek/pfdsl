import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { corpusFacts } from "./agent-operation-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { readShell } from "./shell-commands.mjs";

// Each declared decision argument is crossed with every input source, without
// generating Git syntax from help or interpreting external input contents.
const roles = [
	[
		"Git setting key",
		["git", "-c", "color.ui=never", "-C", "/fixture/own", "commit", "-m", "x"],
		2,
		"W",
	],
	[
		"Git config-env key",
		[
			"git",
			"--config-env",
			"color.ui=COLOR",
			"-C",
			"/fixture/own",
			"commit",
			"-m",
			"x",
		],
		2,
		"W",
	],
	[
		"API field key",
		[
			"gh",
			"api",
			"graphql",
			"-f",
			"query=mutation { updateIssue(input: {}) { clientMutationId } }",
		],
		4,
		"O",
	],
	["Git execution path", ["git", "-C", "/fixture/own", "add", "a"], 2, "W"],
	[
		"update-ref",
		["git", "-C", "/fixture/own", "update-ref", "refs/heads/topic", "HEAD"],
		4,
		"B",
	],
	[
		"fetch refspec",
		["git", "-C", "/fixture/own", "fetch", "origin", "topic:topic"],
		5,
		"B",
	],
	[
		"pull refspec",
		["git", "-C", "/fixture/own", "pull", "origin", "topic:topic"],
		5,
		"W",
	],
	["branch", ["git", "-C", "/fixture/own", "branch", "topic"], 4, "B"],
	["switch", ["git", "-C", "/fixture/own", "switch", "topic"], 4, "B"],
	[
		"config key",
		["git", "-C", "/fixture/own", "config", "user.name", "x"],
		4,
		"C",
	],
	[
		"remote verb",
		["git", "-C", "/fixture/own", "remote", "add", "origin", "url"],
		4,
		"C",
	],
	["stash verb", ["git", "-C", "/fixture/own", "stash", "pop"], 4, "W"],
	["init path", ["git", "-C", "/fixture/own", "init", "/tmp/new"], 4, "W"],
	[
		"clone path",
		["git", "-C", "/fixture/own", "clone", "url", "/tmp/new"],
		5,
		"W",
	],
	[
		"archive output",
		["git", "-C", "/fixture/own", "archive", "HEAD", "-o", "/tmp/new"],
		6,
		"W",
	],
	[
		"format output",
		["git", "-C", "/fixture/own", "format-patch", "-1", "-o", "/tmp/new"],
		6,
		"W",
	],
	[
		"bundle file",
		["git", "-C", "/fixture/own", "bundle", "create", "/tmp/new", "HEAD"],
		5,
		"W",
	],
	[
		"worktree path",
		["git", "-C", "/fixture/own", "worktree", "add", "/tmp/new", "topic"],
		5,
		"B",
	],
	[
		"worktree branch",
		["git", "-C", "/fixture/own", "worktree", "add", "/tmp/new", "topic"],
		6,
		"B",
	],
	[
		"created branch",
		["git", "-C", "/fixture/own", "switch", "-c", "topic"],
		5,
		"B",
	],
	[
		"worktree removal",
		["git", "-C", "/fixture/own", "worktree", "remove", "/tmp/trial"],
		5,
		"W",
	],
	["API endpoint", ["gh", "api", "repos/o/r/issues", "-X", "PUT"], 2, "O"],
	["API method", ["gh", "api", "repos/o/r/issues", "-X", "PUT"], 4, "O"],
	[
		"API query",
		[
			"gh",
			"api",
			"graphql",
			"-F",
			"query=mutation { updateIssue(input: {}) { clientMutationId } }",
		],
		4,
		"O",
	],
];
const sources = ["literal", "dynamic", "stdin", "file", "unknown-option"];
test("read classes do not depend on execution targets or a proven GET endpoint", async (t) => {
	for (const harness of ["claude", "codex"])
		for (const source of sources)
			for (const tail of [
				["status"],
				["log"],
				["diff"],
				["show"],
				["fetch", "origin"],
				["branch", "--list"],
			])
				await t.test(`${harness} R ${tail[0]}: ${source}`, () => {
					const target =
						source === "dynamic"
							? { value: "$root", dynamic: true }
							: {
									value:
										source === "stdin"
											? "-"
											: source === "file"
												? "@fixture"
												: "/fixture/own",
								};
					const tokens = [
						{ value: "git" },
						{ value: "-C" },
						target,
						...tail.map((value) => ({ value })),
					];
					if (source === "unknown-option")
						tokens.push({ value: "--not-declared" });
					const payload = {
						tool_name: "Bash",
						cwd: "/fixture/own",
						tool_input: { command: "matrix" },
					};
					const facts = corpusFacts({
						harness,
						shell: { commands: [{ tokens }] },
					});
					const result = evaluateAgentOperationPolicy(payload, facts);
					assert.equal(
						result.operationClass,
						source === "unknown-option" ? "U" : "R",
					);
					assert.equal(
						result.decision,
						source === "unknown-option" ? "deny" : "allow",
					);
				});
	for (const method of [[], ["-X", "GET"], ["--method", "GET"]])
		for (const source of sources)
			await t.test(
				`API GET ${method.join(" ") || "default"}: ${source}`,
				() => {
					const endpoint = {
						value:
							source === "dynamic"
								? "repos/o/r/issues/comments/$id"
								: source === "stdin"
									? "-"
									: source === "file"
										? "@fixture"
										: "repos/o/r/issues",
						dynamic: source === "dynamic",
					};
					const tokens = [
						{ value: "gh" },
						{ value: "api" },
						...method.map((value) => ({ value })),
						endpoint,
					];
					if (source === "unknown-option")
						tokens.push({ value: "--not-declared" });
					const payload = {
						tool_name: "Bash",
						cwd: "/fixture/own",
						tool_input: { command: "matrix" },
					};
					const facts = corpusFacts({ shell: { commands: [{ tokens }] } });
					const result = evaluateAgentOperationPolicy(payload, facts);
					assert.equal(
						result.operationClass,
						source === "unknown-option" ? "U" : "R",
					);
					assert.equal(
						result.decision,
						source === "unknown-option" ? "deny" : "allow",
					);
				},
			);
});

test("directory hints apply to writes while reads remain R", () => {
	for (const change of [false, true]) {
		const command = `cd "$root" && git ${change ? "add a" : "status"}`;
		const payload = {
			tool_name: "Bash",
			cwd: "/fixture/own",
			tool_input: { command },
		};
		const facts = corpusFacts({ shell: readShell(command) });
		assert.equal(
			evaluateAgentOperationPolicy(payload, facts).decision,
			change ? "deny" : "allow",
		);
	}
});

test("writes and unknown API methods still depend on their targets", () => {
	for (const values of [
		["git", "-C", "$root", "add", "a"],
		["gh", "api", "-X", "PUT", "$endpoint"],
		["gh", "api", "--method", "$method", "$endpoint"],
		["gh", "api", "$endpoint", "-F", "body=@fixture"],
	]) {
		const tokens = values.map((value) => ({
			value,
			dynamic: value.startsWith("$"),
		}));
		const payload = {
			tool_name: "Bash",
			cwd: "/fixture/own",
			tool_input: { command: "matrix" },
		};
		const facts = corpusFacts({ shell: { commands: [{ tokens }] } });
		assert.equal(
			evaluateAgentOperationPolicy(payload, facts).operationClass,
			"U",
		);
		assert.equal(evaluateAgentOperationPolicy(payload, facts).decision, "deny");
	}
});
test("global unknown options record only the literal name without an attached value", () => {
	const tokens = ["git", "--not-declared=/fixture/private", "status"].map(
		(value) => ({ value }),
	);
	const result = classifyAgentOperations(
		{
			tool_name: "Bash",
			cwd: "/fixture/own",
			tool_input: { command: "matrix" },
		},
		corpusFacts({ shell: { commands: [{ tokens }] } }),
	);
	assert.deepEqual(result.operations[0].unknownOptions, ["--not-declared"]);
});
test("decision arguments cross literal, dynamic, stdin, file and unknown-option sources", async (t) => {
	for (const [role, values, index, klass] of roles)
		for (const source of sources)
			await t.test(`${role}: ${source}`, () => {
				const tokens = values.map((value) => ({ value }));
				const field = role === "API query" ? "query=" : "";
				if (source === "dynamic")
					tokens[index] = { value: `${field}$arg`, dynamic: true };
				if (source === "stdin") tokens[index] = { value: `${field}-` };
				if (source === "file") tokens[index] = { value: `${field}@fixture` };
				if (source === "unknown-option")
					tokens.splice(
						tokens[index - 1]?.value.startsWith("-") ? index - 1 : index,
						0,
						{ value: "--not-declared" },
					);
				const payload = {
					tool_name: "Bash",
					cwd: "/fixture/own",
					tool_input: { command: "matrix" },
				};
				const facts = corpusFacts({ shell: { commands: [{ tokens }] } });
				const classified = classifyAgentOperations(payload, facts);
				const classes = classified.operations.flatMap(({ classes }) => classes);
				if (source === "literal")
					assert.ok(classes.includes(klass), classes.join(","));
				else {
					assert.ok(classes.includes("U"), classes.join(","));
					assert.equal(
						evaluateAgentOperationPolicy(payload, facts).decision,
						"deny",
					);
				}
			});
});

test("property 5: unknown shapes preserve confirmed P X D S prohibitions", () => {
	for (const [values, klass] of [
		[["gh", "api", "repos/o/r/pulls/1/merge", "-X", "PUT"], "P"],
		[["git", "-C", "/fixture/own", "commit", "--no-verify", "-m", "x"], "X"],
		[["git", "-C", "/fixture/own", "branch", "-D", "main"], "D"],
		[["git", "-C", "/fixture/own", "stash", "clear"], "S"],
	]) {
		const tokens = [...values, "--not-declared"].map((value) => ({ value }));
		const payload = {
			tool_name: "Bash",
			cwd: "/fixture/own",
			tool_input: { command: "matrix" },
		};
		const facts = corpusFacts({ shell: { commands: [{ tokens }] } });
		const classes = classifyAgentOperations(payload, facts).operations.flatMap(
			({ classes }) => classes,
		);
		assert.ok(classes.includes(klass), classes.join(","));
		assert.ok(classes.includes("U"), classes.join(","));
		assert.equal(
			evaluateAgentOperationPolicy(payload, facts).operationClass,
			klass,
		);
	}
});

test("body and title values are data rather than decision inputs", () => {
	for (const values of [
		["gh", "api", "repos/o/r/issues", "-F", "body=@fixture"],
		["gh", "pr", "create", "--title", "$title", "--body-file", "-"],
		["git", "-C", "/fixture/own", "commit", "-F", "-"],
	]) {
		const tokens = values.map((value) => ({
			value,
			dynamic: value.includes("$"),
		}));
		const payload = {
			tool_name: "Bash",
			cwd: "/fixture/own",
			tool_input: { command: "matrix" },
		};
		const facts = corpusFacts({ shell: { commands: [{ tokens }] } });
		assert.equal(
			evaluateAgentOperationPolicy(payload, facts).decision,
			"allow",
		);
	}
});
