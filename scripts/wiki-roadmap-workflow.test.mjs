import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
	readFileSync(
		new URL("../.github/workflows/wiki-roadmap-generate.yml", import.meta.url),
		"utf8",
	),
);
const step = workflow.jobs.generate.steps.find((item) =>
	item.run?.includes("scripts/wiki-roadmap-run.mjs"),
);
const token = "fixture-token";
const authorization = Buffer.from(`x-access-token:${token}`).toString("base64");
const git = (cwd, ...args) =>
	execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: "pipe",
	}).trim();
const runner = resolve("scripts/wiki-roadmap-run.mjs");
const original =
	"---\ntitle: Trial\ntype: roadmap\nextends: preset.yaml\nartifact:\n  request: {status: done}\n  result: {status: todo, criteria: Reviewed.}\n---\nrequest >> verify -> result\n";

function createRepository(t, prefix) {
	const root = mkdtempSync(join(tmpdir(), prefix));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	git(root, "init", "-b", "main");
	git(root, "config", "user.name", "Test");
	git(root, "config", "user.email", "test@example.invalid");
	return root;
}
function commit(root) {
	git(root, "add", ".");
	git(root, "commit", "-m", "Fixture");
	return git(root, "rev-parse", "HEAD");
}
function setup(t, repository = "takasek/pfdsl") {
	const root = createRepository(t, "wiki-workflow-body-");
	writeFileSync(join(root, "plan.md"), "Previous version\n");
	const older = commit(root);
	writeFileSync(join(root, "plan.md"), "Current version\n");
	const current = commit(root);
	const temp = mkdtempSync(join(tmpdir(), "wiki-workflow-runner-"));
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const wiki = join(temp, "editor");
	git(temp, "init", "-b", "main", wiki);
	git(wiki, "config", "user.name", "Test");
	git(wiki, "config", "user.email", "test@example.invalid");
	writeFileSync(join(wiki, "roadmap.pfdsl"), original);
	writeFileSync(join(wiki, "roadmap.md"), "# Companion\n");
	// A repository target must not move the model's Wiki-only preset lookup.
	writeFileSync(
		join(wiki, "preset.yaml"),
		'statusStyles: {todo: {fillcolor: "#ffffff"}}\n',
	);
	commit(wiki);
	const remote = join(temp, "wiki.git");
	git(temp, "clone", "--bare", wiki, remote);
	const globalConfig = join(temp, "gitconfig");
	writeFileSync(globalConfig, "");
	const bin = join(temp, "bin");
	mkdirSync(bin);
	const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
	const shim = join(bin, "git");
	// Observe calls and credentials at the Git process boundary; only transport is redirected.
	writeFileSync(
		shim,
		`#!/usr/bin/env node
const {spawnSync} = require('node:child_process');
const {appendFileSync} = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('clone') && !args.includes(${JSON.stringify(`https://github.com/${repository}.wiki.git`)})) {
  console.error('Unexpected fixture clone source');
  process.exit(1);
}
appendFileSync(process.env.PFDSL_TEST_GIT_LOG, JSON.stringify({
  args,
  authorized: process.env.GIT_CONFIG_COUNT === '1'
    && process.env.GIT_CONFIG_KEY_0 === 'http.https://github.com/.extraheader'
    && process.env.GIT_CONFIG_VALUE_0 === 'AUTHORIZATION: basic ' + ${JSON.stringify(authorization)}
}) + '\\n');
if (args.some(arg => ['clone', 'fetch', 'push'].includes(arg)))
  args.unshift('-c', 'url.' + process.env.PFDSL_TEST_REMOTE + '.insteadOf=' + ${JSON.stringify(`https://github.com/${repository}.wiki.git`)});
const result = spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit'});
process.exit(result.status ?? 1);
`,
	);
	chmodSync(shim, 0o755);
	return {
		root,
		wiki,
		temp,
		remote,
		globalConfig,
		bin,
		older,
		current,
		repository,
	};
}
function publishSource(fixture) {
	git(fixture.wiki, "push", fixture.remote, "main");
}
function syncEditor(fixture) {
	git(fixture.wiki, "fetch", fixture.remote, "main");
	git(fixture.wiki, "merge", "--ff-only", "FETCH_HEAD");
}
function invoke(fixture, { publish = true, extraArgs = [], workflowRun } = {}) {
	const runDirectory = mkdtempSync(join(fixture.temp, "runner-"));
	const wiki = join(runDirectory, "roadmap-wiki");
	const log = join(runDirectory, "git.jsonl");
	const env = {
		...process.env,
		PATH: `${fixture.bin}${delimiter}${process.env.PATH}`,
		PFDSL_TEST_REMOTE: fixture.remote,
		PFDSL_TEST_GIT_LOG: log,
		GIT_CONFIG_GLOBAL: fixture.globalConfig,
		GIT_CONFIG_NOSYSTEM: "1",
		GH_TOKEN: token,
		REPOSITORY: fixture.repository,
		GITHUB_WORKSPACE: fixture.root,
		RUNNER_TEMP: runDirectory,
	};
	const result =
		workflowRun === undefined
			? spawnSync(
					process.execPath,
					[
						runner,
						"--wiki",
						wiki,
						"--repository",
						fixture.repository,
						"--repository-root",
						fixture.root,
						...(publish ? ["--publish"] : []),
						...extraArgs,
					],
					{ encoding: "utf8", env },
				)
			: spawnSync("bash", ["-e", "-c", workflowRun], { encoding: "utf8", env });
	return {
		...result,
		wiki,
		gitCalls: existsSync(log)
			? readFileSync(log, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: [],
	};
}
function assertNoCredentials(result) {
	for (const stream of ["stdout", "stderr"])
		for (const secret of [token, authorization])
			assert.ok(
				!result[stream].includes(secret),
				`${stream} must not contain credential material`,
			);
}
function successful(result) {
	assert.equal(result.status, 0, result.stderr || result.error?.message);
	assertNoCredentials(result);
	return JSON.parse(result.stdout);
}
function receipt(wiki) {
	return JSON.parse(
		readFileSync(join(wiki, "roadmap.index.md"), "utf8")
			.split("<!-- pfdsl-wiki-preview: ")[1]
			.split(" -->")[0],
	);
}
function remoteBytes(fixture, name) {
	return execFileSync("git", ["-C", fixture.remote, "show", `main:${name}`]);
}

test("publishes model defaults and artifact overrides at different repository commits", (t) => {
	const f = setup(t);
	writeFileSync(
		join(f.wiki, "roadmap.pfdsl"),
		original
			.replace(
				"artifact:",
				`baseRef: {source: 'https://github.com/takasek/pfdsl.git', revision: '${f.current}'}\nartifact:`,
			)
			.replace(
				"request: {status: done}",
				"request: {status: done, location: plan.md}",
			)
			.replace(
				"result: {status: todo, criteria: Reviewed.}",
				`result: {status: todo, criteria: Reviewed., location: plan.md, ref: {source: 'https://github.com/takasek/pfdsl.git', revision: '${f.older}'}}`,
			),
	);
	commit(f.wiki);
	publishSource(f);
	const result = invoke(f);
	const generated = successful(result);
	assert.equal(generated.status, "published");
	assert.equal(generated.referenceRepositoryRevision, f.current);
	assert.equal(
		generated.implementationRevision,
		git(resolve("."), "rev-parse", "HEAD"),
	);
	assert.equal(git(f.remote, "rev-parse", "main"), generated.revision);
	assert.deepEqual(
		remoteBytes(f, "roadmap.pfdsl"),
		readFileSync(join(f.wiki, "roadmap.pfdsl")),
	);
	const record = receipt(result.wiki);
	assert.equal(record.wikiRevision, generated.inputWikiRevision);
	const checks = record.referenceChecks.flatMap((item) => item.results);
	for (const [id, revision] of [
		["request", f.current],
		["result", f.older],
	]) {
		const item = checks.find((value) => value.id === id);
		assert.equal(item.result, "exists");
		assert.equal(item.source, "https://github.com/takasek/pfdsl.git");
		assert.equal(item.fixedRevision, revision);
		assert.equal(item.logicalPath, "plan.md");
	}
	assert.equal(
		record.referenceContext.basis.source,
		"https://github.com/takasek/pfdsl.wiki.git",
	);
});

for (const { name, source, diagnostic } of [
	{
		name: "an unregistered source",
		source: (revision) =>
			original.replace(
				"artifact:",
				`baseRef: {source: 'unknown', revision: '${revision}'}\nartifact:`,
			),
		diagnostic: /Unknown source: unknown/,
	},
	{
		name: "an unavailable revision",
		source: () =>
			original.replace(
				"artifact:",
				`baseRef: {source: 'https://github.com/takasek/pfdsl.git', revision: '${"0".repeat(40)}'}\nartifact:`,
			),
		diagnostic:
			/Unknown revision for https:\/\/github.com\/takasek\/pfdsl.git: 0{40}/,
	},
	{
		name: "a cyclic model",
		source: () => "---\ntype: roadmap\n---\nrequest >> verify -> request\n",
		diagnostic: /error \[V010\]/,
	},
]) {
	test(`rejects ${name} with its diagnostic and preserves published output`, (t) => {
		const f = setup(t);
		publishSource(f);
		successful(invoke(f));
		const before = ["roadmap.index.md", "roadmap.svg"].map((file) =>
			remoteBytes(f, file),
		);
		syncEditor(f);
		writeFileSync(join(f.wiki, "roadmap.pfdsl"), source(f.current));
		commit(f.wiki);
		publishSource(f);
		const revision = git(f.remote, "rev-parse", "main");
		const result = invoke(f);
		assert.equal(result.status, 1, result.stdout || result.stderr);
		assert.match(result.stderr, diagnostic);
		assertNoCredentials(result);
		assert.equal(git(f.remote, "rev-parse", "main"), revision);
		for (const [index, file] of ["roadmap.index.md", "roadmap.svg"].entries())
			assert.deepEqual(remoteBytes(f, file), before[index]);
	});
}

test("preserves a legacy Wiki-only preset and reuses published output without another push", (t) => {
	const f = setup(t);
	publishSource(f);
	const first = successful(invoke(f));
	assert.equal(first.status, "published");
	const revision = git(f.remote, "rev-parse", "main");
	const result = invoke(f);
	const next = successful(result);
	assert.equal(next.status, "unchanged");
	assert.equal(next.inputWikiRevision, first.inputWikiRevision);
	assert.equal(next.acquiredWikiRevision, revision);
	assert.equal(git(f.remote, "rev-parse", "main"), revision);
	assert.deepEqual(remoteBytes(f, "roadmap.pfdsl"), Buffer.from(original));
	assert.ok(!result.gitCalls.some((call) => call.args.includes("push")));
});

test("the workflow publishes through its declared arguments and credential bindings", (t) => {
	assert.ok(step, "the workflow must call the runner");
	// These are GitHub context bindings, not an exact copy of the shell command.
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub Actions expression.
	assert.equal(step.env.GH_TOKEN, "${{ github.token }}");
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub Actions expression.
	assert.equal(step.env.REPOSITORY, "${{ github.repository }}");
	const checkout = workflow.jobs.generate.steps.find((item) =>
		item.uses?.startsWith("actions/checkout@"),
	);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub Actions expression.
	assert.equal(checkout.with.ref, "${{ github.sha }}");
	assert.equal(checkout.with["fetch-depth"], 0);
	const f = setup(t, "fixture-owner/non-default-project");
	publishSource(f);
	const result = invoke(f, { workflowRun: step.run });
	const generated = successful(result);
	assert.equal(generated.status, "published");
	assert.equal(generated.referenceRepositoryRevision, f.current);
	assert.equal(git(f.remote, "rev-parse", "main"), generated.revision);
	for (const command of ["clone", "fetch", "push"]) {
		const calls = result.gitCalls.filter((call) => call.args.includes(command));
		assert.ok(calls.length > 0, `the workflow must exercise ${command}`);
		assert.ok(
			calls.every((call) => call.authorized),
			`${command} must receive the configured credential`,
		);
	}
});

test("generates a local preview without publishing or exposing credentials", (t) => {
	const f = setup(t);
	const before = git(f.remote, "rev-parse", "main");
	const result = invoke(f, { publish: false });
	assert.equal(successful(result).status, "generated");
	assert.match(readFileSync(join(result.wiki, "roadmap.svg"), "utf8"), /<svg/);
	assert.equal(git(f.remote, "rev-parse", "main"), before);
	assert.ok(!result.gitCalls.some((call) => call.args.includes("push")));
});

test("rejects an unknown flag before invoking Git or creating the clone", (t) => {
	const f = setup(t);
	const result = invoke(f, { extraArgs: ["--publsh"] });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Unknown option.*--publsh/);
	assertNoCredentials(result);
	assert.deepEqual(result.gitCalls, []);
	assert.equal(existsSync(result.wiki), false);
});

test("shows usage", () => {
	assert.match(
		execFileSync(process.execPath, [runner, "--help"], { encoding: "utf8" }),
		/Usage:/,
	);
});
