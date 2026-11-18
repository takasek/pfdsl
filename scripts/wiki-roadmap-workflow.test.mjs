import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const step = workflow.jobs.generate.steps.find(
	(item) => item.name === "Generate and publish the trial pair",
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
	return { root, wiki, temp, older, current };
}
function configure({ root, wiki, temp }) {
	const source = step.run.match(
		/node --input-type=module <<'NODE'\n([\s\S]*?)\nNODE/,
	);
	assert.ok(source, "the workflow must prepare its explicit reference sources");
	execFileSync(process.execPath, ["--input-type=module", "-e", source[1]], {
		env: {
			...process.env,
			REPOSITORY: "takasek/pfdsl",
			GITHUB_WORKSPACE: root,
			RUNNER_TEMP: temp,
			WIKI_REVISION: git(wiki, "rev-parse", "HEAD"),
		},
		encoding: "utf8",
	});
	const config = join(temp, "roadmap-source.json");
	const settings = JSON.parse(readFileSync(config, "utf8"));
	assert.equal(settings.roadmapSource.revision, git(wiki, "rev-parse", "HEAD"));
	assert.equal(
		settings.roadmapSource.basis.revision,
		settings.roadmapSource.revision,
	);
	assert.match(step.run, /--expected-revision/);
	assert.match(
		step.run,
		/--source-config "\$RUNNER_TEMP\/roadmap-source.json"/,
	);
	return config;
}
function generate({ wiki }, config) {
	return JSON.parse(
		execFileSync(
			process.execPath,
			[
				resolve("scripts/wiki-roadmap-generate.mjs"),
				"--wiki",
				wiki,
				"--repository",
				"takasek/pfdsl",
				"--source-config",
				config,
				"--expected-revision",
				git(wiki, "rev-parse", "HEAD"),
			],
			{ encoding: "utf8", stdio: "pipe" },
		),
	);
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
	const config = configure(fixture);
	assert.equal(generate(fixture, config).status, "generated");
	const record = receipt(wiki);
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
		readFileSync(join(wiki, file)),
	);
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
		assert.throws(() => generate(fixture, configure(fixture)));
		for (const [index, file] of ["roadmap.index.md", "roadmap.svg"].entries())
			assert.deepEqual(readFileSync(join(wiki, file)), before[index]);
	}
});

test("the Actions configuration preserves a legacy Wiki-only preset and reuses output-only revisions", (t) => {
	const fixture = setup(t);
	assert.equal(generate(fixture, configure(fixture)).status, "generated");
	commit(fixture.wiki);
	assert.equal(generate(fixture, configure(fixture)).status, "unchanged");
	assert.equal(
		readFileSync(join(fixture.wiki, "roadmap.pfdsl"), "utf8"),
		original,
	);
});
