import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createIssuePfd, referenceContext } from "./lib/issue-pfd.mjs";
import {
	createIssuePfdCli,
	formatIssuePfdHelp,
	ISSUE_PFD_COMMANDS,
	parseIssuePfdArgs,
} from "./lib/issue-pfd-cli.mjs";

function processFixture(t) {
	const dir = mkdtempSync(resolve(".issue-pfd-process-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const scripts = resolve(dir, "scripts/pfdsl");
	mkdirSync(scripts, { recursive: true });
	cpSync(
		fileURLToPath(new URL("./lib", import.meta.url)),
		resolve(scripts, "lib"),
		{ recursive: true },
	);
	cpSync(
		fileURLToPath(new URL("./issue-pfd.mjs", import.meta.url)),
		resolve(scripts, "issue-pfd.mjs"),
	);
	writeFileSync(
		resolve(scripts, "lib/github-ops.mjs"),
		`export class GitHubUnavailableError extends Error { constructor(operation) { super('GitHub operation unavailable: ' + operation); this.operation = operation; } }\nexport const isGitHubUnavailableError = error => error instanceof GitHubUnavailableError;\nexport const GITHUB_UNAVAILABLE_EXIT_CODE = 2;\nexport function createGitHubOps() { return { getArtifact: async () => { if (process.env.PFDSL_TEST_MODE === 'raw') return { artifact: {number: 1}, versions: [{version: 1, body: 'broken\\r\\nraw\\r\\n'}] }; if (process.env.PFDSL_TEST_MODE === 'unavailable') throw new GitHubUnavailableError('getArtifact'); throw new Error('offline'); }, createArtifact: async () => { throw new GitHubUnavailableError('createArtifact'); } }; }\n`,
	);
	mkdirSync(resolve(dir, ".pfdsl"));
	writeFileSync(
		resolve(dir, ".pfdsl/config.json"),
		JSON.stringify({ githubIssues: { enabled: true } }),
	);
	const cli = resolve(dir, "cli.mjs");
	writeFileSync(
		cli,
		"console.log(process.argv.includes('--help') ? 'check --reference-context <file>' : 'pfdsl fixture');\n",
	);
	const invoke = (args, mode) =>
		spawnSync(process.execPath, [resolve(scripts, "issue-pfd.mjs"), ...args], {
			cwd: dir,
			env: {
				...process.env,
				GH_REPO: "github.com/o/r",
				GH_TOKEN: "",
				GITHUB_TOKEN: "",
				PFDSL_CLI: cli,
				PFDSL_TEST_MODE: mode,
				TMPDIR: dir,
			},
			encoding: "utf8",
		});
	return { dir, invoke };
}

test("CLI process distinguishes unavailable transport from ordinary unavailable status", (t) => {
	const f = processFixture(t);
	const unavailable = f.invoke(
		["status", "7", "--artifact", "1"],
		"unavailable",
	);
	assert.equal(unavailable.status, 2, unavailable.stderr);
	assert.match(unavailable.stderr, /GitHub operation unavailable/);
	const offline = f.invoke(["status", "7", "--artifact", "1"], "offline");
	assert.equal(offline.status, 0, offline.stderr);
	assert.equal(JSON.parse(offline.stdout).classification, "unavailable");
	const file = resolve(f.dir, "input.pfdsl");
	writeFileSync(file, "a >> p -> b\n");
	const create = f.invoke(
		["create", "7", file, "--dir", resolve(f.dir, "work"), "--write"],
		"unavailable",
	);
	assert.equal(create.status, 2, create.stderr);
	assert.equal(
		JSON.parse(readFileSync(resolve(f.dir, "work/issue-pfd.json"), "utf8"))
			.operations[0].status,
		"failed",
	);
});

test("global and command help exit zero and describe the public contract", (t) => {
	const f = processFixture(t);
	for (const command of [undefined, ...Object.keys(ISSUE_PFD_COMMANDS)]) {
		const result = f.invoke(
			command ? [command, "--help"] : ["--help"],
			"unavailable",
		);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /default.*dry run|Defaults:.*dry runs/);
		assert.match(result.stdout, /Exit codes: 0.*1.*2.*3/);
		for (const usage of command
			? [ISSUE_PFD_COMMANDS[command]]
			: Object.values(ISSUE_PFD_COMMANDS))
			assert.ok(result.stdout.includes(usage), usage);
	}
});

test("show CLI process emits exact raw bytes without requiring a compatible CLI", (t) => {
	const f = processFixture(t);
	writeFileSync(
		resolve(f.dir, "cli.mjs"),
		"throw new Error('CLI must not run');\n",
	);
	const result = f.invoke(
		["show", "7", "--artifact", "1", "--version", "1"],
		"raw",
	);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "broken\r\nraw\r\n");
});

test("guide commands match help grammar and explain context, recovery and abandonment", async () => {
	const guide = readFileSync(
		"scripts/harness-template/skills/pfd-ops/references/issue-artifact-pfd.md",
		"utf8",
	);
	const commands = [
		...guide.matchAll(/^node scripts\/pfdsl\/issue-pfd\.mjs (.+)$/gm),
	];
	assert.ok(commands.length >= 10);
	for (const [, line] of commands) {
		const args = line
			.replace("<operation-uuid>", "12345678-1234-4234-8234-123456789abc")
			.split(/\s+/);
		const parsed = parseIssuePfdArgs(args);
		if (parsed.help && !parsed.command) {
			assert.match(formatIssuePfdHelp(), /Usage:/);
			continue;
		}
		assert.ok(
			formatIssuePfdHelp(parsed.command).includes(
				ISSUE_PFD_COMMANDS[parsed.command],
			),
		);
	}
	assert.match(guide, /入口が自動.*利用者.*渡さ/);
	assert.match(guide, /pull.*--version.*省略.*現在版/);
	assert.match(guide, /diff issue-123\/base.pfdsl issue-123\/model.pfdsl/);
	assert.match(guide, /\*\*.*要求を取り消さない.*\*\*/);
	assert.match(guide, /現在のモデル hash が図の入力モデルと一致する/);
	assert.match(
		guide,
		/create.*publish.*restore.*status.*publish-diagram.*resolve.*照合/,
	);
	const sample = guide.match(/```pfdsl\n([\s\S]*?)\n```/);
	assert.ok(sample);
	const dir = mkdtempSync(resolve(".issue-pfd-guide-"));
	try {
		const cli = createIssuePfdCli({ root: resolve("."), temporaryRoot: dir });
		const result = await cli({
			command: "check",
			model: `${sample[1]}\n`,
			context: referenceContext({ dir, model: `${sample[1]}\n` }),
		});
		assert.equal(result.exitCode, 0, result.stderr);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("CLI adapter pins one snapshot and passes basis-free context to check and SVG render", async () => {
	const context = {
		adapter: "test",
		model: {
			source: "artifact",
			fixedRevision: "2",
			documentId: "1",
			extractionId: "pfdsl-fence",
		},
		logicalPath: "model.pfdsl",
		targets: [],
	};
	const seen = [];
	const cli = createIssuePfdCli({
		root: resolve("."),
		temporaryRoot: resolve("."),
		spawn: (_node, argv) => {
			seen.push(argv);
			if (argv.includes("--help"))
				return {
					status: 0,
					stdout: "check --reference-context <file>",
					stderr: "",
				};
			if (argv[1] === "--version")
				return { status: 0, stdout: "pfdsl 1.2.3\n", stderr: "" };
			assert.equal(readFileSync(argv[2], "utf8"), "a >> p -> b\n");
			assert.deepEqual(
				JSON.parse(
					readFileSync(argv[argv.indexOf("--reference-context") + 1], "utf8"),
				),
				context,
			);
			return { status: 0, stdout: "<svg/>", stderr: "" };
		},
	});
	await cli({ command: "check", model: "a >> p -> b\n", context });
	const result = await cli({
		command: "render",
		model: "a >> p -> b\n",
		context,
	});
	assert.equal(result.cliVersion, "pfdsl 1.2.3");
	assert.ok(seen.at(-1).includes("svg"));
});

test("argument parser validates command-specific options and positive version numbers", () => {
	assert.deepEqual(
		parseIssuePfdArgs([
			"pull",
			"7",
			"--dir",
			"work",
			"--artifact",
			"3",
			"--version",
			"2",
		]),
		{
			command: "pull",
			issue: 7,
			dir: "work",
			artifact: 3,
			version: 2,
			write: false,
		},
	);
	assert.throws(
		() => parseIssuePfdArgs(["pull", "7", "--dir", "work", "--version", "0"]),
		/positive/,
	);
	assert.throws(() => parseIssuePfdArgs(["status", "7", "--write"]), /--write/);
	assert.throws(() => parseIssuePfdArgs(["render", "work"]), /--out/);
	assert.throws(() => parseIssuePfdArgs(["unknown"]), /command/);
	assert.equal(
		parseIssuePfdArgs(["restore", "work", "--version", "2", "--write"]).version,
		2,
	);
	assert.equal(
		parseIssuePfdArgs([
			"resolve",
			"work",
			"--abandon",
			"12345678-1234-4234-8234-123456789abc",
		]).dir,
		"work",
	);
	assert.throws(() => parseIssuePfdArgs(["restore", "work"]), /--version/);
	assert.throws(() => parseIssuePfdArgs(["resolve", "work"]), /--abandon/);
});

test("real CLI accepts public and local contexts and rejects extends in each", async () => {
	const dir = mkdtempSync(resolve(".issue-pfd-test-"));
	try {
		const state = {
			host: "github.com",
			owner: "o",
			repo: "r",
			issue: 1,
			artifact: 1,
		};
		const model = "a >> p -> b\n";
		const contexts = [
			referenceContext({ state, version: 7 }),
			referenceContext({ dir, model }),
		];
		assert.equal(contexts[0].model.fixedRevision, "7");
		assert.equal(
			contexts[1].model.fixedRevision,
			createHash("sha256").update(model).digest("hex"),
		);
		assert.equal(contexts[1].model.source, `local:${dir}`);
		assert.equal(
			referenceContext({ dir, model: "a\r\n" }).model.fixedRevision,
			createHash("sha256").update("a\r\n").digest("hex"),
		);
		const guide = readFileSync(
			"scripts/harness-template/skills/pfd-ops/references/issue-artifact-pfd.md",
			"utf8",
		);
		const examples = [...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
			(match) => JSON.parse(match[1]),
		);
		assert.equal(examples.length, 2);
		assert.equal(
			examples[1].model.fixedRevision,
			createHash("sha256").update(model).digest("hex"),
		);
		contexts.push(...examples);
		const cli = createIssuePfdCli({ root: resolve("."), temporaryRoot: dir });
		for (const context of contexts) {
			assert.equal(context.logicalPath, "issue-pfd.pfdsl");
			assert.deepEqual(context.targets, []);
			assert.equal(Object.hasOwn(context, "basis"), false);
			const result = await cli({
				command: "check",
				model: "---\nextends: preset.yaml\n---\na >> p -> b\n",
				context,
			});
			assert.equal(result.exitCode, 1, result.stderr);
			assert.match(
				result.stderr + result.stdout,
				/basis|model-position-unknown/,
			);
			const valid = await cli({
				command: "check",
				model,
				context,
			});
			assert.equal(valid.exitCode, 0, valid.stderr);
		}
		const fencedModel = "---\ntitle: |\n  ```\n---\na >> p -> b\n";
		const fenced = await cli({
			command: "check",
			model: fencedModel,
			context: referenceContext({ dir, model: fencedModel }),
		});
		assert.equal(fenced.exitCode, 0, fenced.stderr);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("CLI without reference-context is an environment error before any write", async () => {
	const dir = mkdtempSync(resolve(".issue-pfd-test-"));
	const calls = [];
	try {
		const cli = createIssuePfdCli({
			root: resolve("."),
			temporaryRoot: dir,
			spawn: (_node, args) => {
				calls.push(args);
				return {
					status: 0,
					stdout: args.includes("--help")
						? "check <file> --json"
						: "pfdsl 0.2.0",
					stderr: "",
				};
			},
		});
		const runner = createIssuePfd({
			root: dir,
			cli,
			repository: () => {
				throw new Error("repository should not be accessed");
			},
			github: {},
		});
		await assert.rejects(
			runner.run({
				command: "create",
				issue: 1,
				file: "missing.pfdsl",
				dir: resolve(dir, "work"),
				write: true,
			}),
			(error) =>
				error.exitCode === 3 &&
				/CLI environment error.*--reference-context/.test(error.message),
		);
		assert.deepEqual(readdirSync(dir), []);
		assert.equal(calls.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
