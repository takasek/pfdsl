import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
	readFileSync(
		new URL("../.github/workflows/wiki-roadmap-generate.yml", import.meta.url),
		"utf8",
	),
);
const git = (cwd, ...args) =>
	execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: "pipe",
	}).trim();
function repository(t, prefix) {
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
const original =
	"---\ntitle: Trial\ntype: roadmap\nextends: preset.yaml\nartifact:\n  request: {status: done}\n  result: {status: todo, criteria: Reviewed.}\n---\nrequest >> verify -> result\n";
function setup(t) {
	const root = repository(t, "wiki-workflow-body-");
	writeFileSync(join(root, "plan.md"), "Previous version\n");
	const older = commit(root);
	writeFileSync(join(root, "plan.md"), "Current version\n");
	const current = commit(root);
	const temp = mkdtempSync(join(tmpdir(), "wiki-workflow-runner-"));
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const wiki = join(temp, "roadmap-wiki");
	git(temp, "init", "-b", "main", wiki);
	git(wiki, "config", "user.name", "Test");
	git(wiki, "config", "user.email", "test@example.invalid");
	writeFileSync(join(wiki, "roadmap.pfdsl"), original);
	writeFileSync(join(wiki, "roadmap.md"), "# Companion\n");
	// Only the Wiki has this preset: registering a repository target must not move the model basis.
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
	// Redirect only Git transport to a real local bare remote; all other Git operations are unchanged.
	const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
	const shim = join(bin, "git");
	writeFileSync(
		shim,
		`#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');\nconst args=process.argv.slice(2);\nif(args.some(arg=>['clone','fetch','push'].includes(arg))) args.unshift('-c', 'url.'+process.env.PFDSL_TEST_REMOTE+'.insteadOf=https://github.com/takasek/pfdsl.wiki.git');\nconst result=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});\nprocess.exit(result.status??1);\n`,
	);
	chmodSync(shim, 0o755);
	return { root, wiki, temp, remote, globalConfig, bin, older, current };
}
function generate(fixture, { publish = true } = {}) {
	const { root, wiki, temp, remote, globalConfig, bin } = fixture;
	git(wiki, "push", remote, "main");
	const clone = join(mkdtempSync(join(temp, "runner-")), "wiki");
	const out = execFileSync(
		process.execPath,
		[
			resolve("scripts/wiki-roadmap-run.mjs"),
			"--wiki",
			clone,
			"--repository",
			"takasek/pfdsl",
			"--repository-root",
			root,
			...(publish ? ["--publish"] : []),
		],
		{
			encoding: "utf8",
			stdio: "pipe",
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				PFDSL_TEST_REMOTE: remote,
				GIT_CONFIG_GLOBAL: globalConfig,
				GIT_CONFIG_NOSYSTEM: "1",
				GH_TOKEN: "fixture-token",
			},
		},
	);
	assert.doesNotMatch(out, /fixture-token/);
	return { ...JSON.parse(out), wiki: clone };
}
function receipt(wiki) {
	return JSON.parse(
		readFileSync(join(wiki, "roadmap.index.md"), "utf8")
			.split("<!-- pfdsl-wiki-preview: ")[1]
			.split(" -->")[0],
	);
}

test("the Actions configuration resolves model defaults and artifact overrides at different repository commits", (t) => {
	const fixture = setup(t);
	const { wiki, older, current } = fixture;
	const checkout = workflow.jobs.generate.steps.find((item) =>
		item.uses?.startsWith("actions/checkout@"),
	);
	// biome-ignore lint/suspicious/noTemplateCurlyInString: This is a literal GitHub Actions expression.
	assert.equal(checkout.with.ref, "${{ github.sha }}");
	assert.equal(
		checkout.with["fetch-depth"],
		0,
		"the checkout must contain the older reference target",
	);
	writeFileSync(
		join(wiki, "roadmap.pfdsl"),
		original
			.replace(
				"artifact:",
				`baseRef: {source: 'https://github.com/takasek/pfdsl.git', revision: '${current}'}\nartifact:`,
			)
			.replace(
				"request: {status: done}",
				"request: {status: done, location: plan.md}",
			)
			.replace(
				"result: {status: todo, criteria: Reviewed.}",
				`result: {status: todo, criteria: Reviewed., location: plan.md, ref: {source: 'https://github.com/takasek/pfdsl.git', revision: '${older}'}}`,
			),
	);
	commit(wiki);
	const generated = generate(fixture);
	assert.equal(generated.status, "published");
	assert.equal(generated.referenceRepositoryRevision, current);
	assert.equal(
		generated.implementationRevision,
		git(resolve("."), "rev-parse", "HEAD"),
	);
	assert.equal(git(fixture.remote, "rev-parse", "main"), generated.revision);
	assert.equal(
		git(fixture.remote, "show", "main:roadmap.pfdsl"),
		readFileSync(join(wiki, "roadmap.pfdsl"), "utf8").trim(),
	);
	const record = receipt(generated.wiki);
	assert.equal(record.wikiRevision, generated.inputWikiRevision);
	const checks = record.referenceChecks.flatMap((item) => item.results);
	for (const [id, revision] of [
		["request", current],
		["result", older],
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
	const before = ["roadmap.index.md", "roadmap.svg"].map((file) =>
		readFileSync(join(generated.wiki, file)),
	);
	git(wiki, "fetch", fixture.remote, "main");
	git(wiki, "merge", "--ff-only", "FETCH_HEAD");
	for (const invalid of [
		original.replace(
			"artifact:",
			`baseRef: {source: 'unknown', revision: '${current}'}\nartifact:`,
		),
		original.replace(
			"artifact:",
			`baseRef: {source: 'https://github.com/takasek/pfdsl.git', revision: '${"0".repeat(40)}'}\nartifact:`,
		),
		"---\ntype: roadmap\n---\nrequest >> verify -> request\n",
	]) {
		writeFileSync(join(wiki, "roadmap.pfdsl"), invalid);
		commit(wiki);
		assert.throws(() => generate(fixture));
		for (const [index, file] of ["roadmap.index.md", "roadmap.svg"].entries())
			assert.deepEqual(
				execFileSync("git", ["-C", fixture.remote, "show", `main:${file}`]),
				before[index],
			);
	}
});

test("the Actions configuration preserves a legacy Wiki-only preset and reuses output-only revisions", (t) => {
	const fixture = setup(t);
	const first = generate(fixture);
	assert.equal(first.status, "published");
	git(fixture.wiki, "fetch", fixture.remote, "main");
	git(fixture.wiki, "merge", "--ff-only", "FETCH_HEAD");
	const revision = git(fixture.remote, "rev-parse", "main");
	const next = generate(fixture);
	assert.equal(next.status, "unchanged");
	assert.equal(
		next.inputWikiRevision,
		first.inputWikiRevision,
		"a reused diagram retains its receipt's input revision",
	);
	assert.equal(
		next.acquiredWikiRevision,
		revision,
		"the newly acquired output commit is reported separately",
	);
	assert.equal(git(fixture.remote, "rev-parse", "main"), revision);
	assert.equal(
		readFileSync(join(fixture.wiki, "roadmap.pfdsl"), "utf8"),
		original,
	);
});
