import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { generate, publish } from "./wiki-roadmap-generate.mjs";

const cli = resolve("packages/cli/dist/cli.js");
const model =
	"---\ntype: roadmap\ntitle: Trial roadmap\ndescription: A short introduction.\nartifact:\n  a: {status: done}\n  b: {status: todo, criteria: Reviewed.}\n---\na >> p -> b\n";
const git = (cwd, ...args) =>
	execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
function fixture(t) {
	const wiki = mkdtempSync(join(tmpdir(), "wiki-generate-"));
	t.after(() => rmSync(wiki, { recursive: true, force: true }));
	git(wiki, "init", "-b", "master");
	git(wiki, "config", "user.name", "Test");
	git(wiki, "config", "user.email", "test@example.invalid");
	writeFileSync(join(wiki, "roadmap.pfdsl"), model);
	writeFileSync(join(wiki, "roadmap.md"), "# Companion\n\nHuman prose.\n");
	commit(wiki);
	return wiki;
}
function commit(wiki) {
	git(wiki, "add", ".");
	git(wiki, "commit", "-m", "Fixture");
	return git(wiki, "rev-parse", "HEAD");
}
const options = (wiki) => ({ wiki, repository: "takasek/pfdsl", cli });
const read = (wiki, name) => readFileSync(join(wiki, name), "utf8");

test("generates the pair with real CLI validation, separate links and immutable inputs", (t) => {
	const wiki = fixture(t);
	const revision = git(wiki, "rev-parse", "HEAD");
	const result = generate(options(wiki));
	assert.equal(result.status, "generated");
	assert.match(read(wiki, "roadmap.svg"), /<svg/);
	const page = read(wiki, "roadmap.index.md");
	assert.match(page, /# Trial roadmap\n\nA short introduction\./);
	assert.match(
		page,
		/Companion: \[preview\]\(https:\/\/github.com\/takasek\/pfdsl\/wiki\/roadmap\) · \[source\]/,
	);
	assert.match(page, /!\[Roadmap diagram\]\(roadmap.svg\)/);
	assert.equal(page.split("roadmap.svg").length - 1, 1);
	assert.match(page, new RegExp(revision));
	assert.match(page, /last successfully validated snapshot/);
	assert.equal(read(wiki, "roadmap.pfdsl"), model);
	assert.equal(read(wiki, "roadmap.md"), "# Companion\n\nHuman prose.\n");
	commit(wiki);
	const original = read(wiki, "roadmap.index.md");
	assert.equal(generate(options(wiki)).status, "unchanged");
	assert.equal(read(wiki, "roadmap.index.md"), original);
	writeFileSync(join(wiki, "Other.md"), "Unrelated\n");
	commit(wiki);
	assert.equal(generate(options(wiki)).status, "generated");
	assert.notEqual(read(wiki, "roadmap.index.md"), original);
});

test("regenerates edited inputs and repairs a corrupted index or SVG", (t) => {
	const wiki = fixture(t);
	generate(options(wiki));
	commit(wiki);
	writeFileSync(join(wiki, "roadmap.md"), "New companion\n");
	commit(wiki);
	assert.equal(generate(options(wiki)).status, "generated");
	commit(wiki);
	writeFileSync(join(wiki, "roadmap.index.md"), "Corrupt\n");
	commit(wiki);
	assert.equal(generate(options(wiki)).status, "generated");
	commit(wiki);
	writeFileSync(join(wiki, "roadmap.svg"), "Corrupt\n");
	commit(wiki);
	assert.equal(generate(options(wiki)).status, "generated");
});

test("the CLI accepts the four-file layout and rejects unknown flags without running model commands", (t) => {
	const wiki = fixture(t);
	const sentinel = join(wiki, "must-not-run");
	writeFileSync(
		join(wiki, "roadmap.pfdsl"),
		model.replace(
			"artifact:",
			`process:\n  p: {command: 'touch ${sentinel}'}\nartifact:`,
		),
	);
	commit(wiki);
	const args = [
		resolve("scripts/wiki-roadmap-generate.mjs"),
		"--wiki",
		wiki,
		"--repository",
		"takasek/pfdsl",
	];
	const result = JSON.parse(
		execFileSync(process.execPath, args, { encoding: "utf8" }),
	);
	assert.equal(result.status, "generated");
	assert.equal(existsSync(sentinel), false);
	assert.match(
		read(wiki, "roadmap.index.md"),
		/repository roadmap remains authoritative/,
	);
	assert.throws(
		() =>
			execFileSync(process.execPath, [...args, "--publsh"], { stdio: "pipe" }),
		/Command failed/,
	);
});

test("publisher rejects modified outputs and a different remote before making a commit", (t) => {
	const wiki = fixture(t);
	const remote = mkdtempSync(join(tmpdir(), "wiki-publish-"));
	t.after(() => rmSync(remote, { recursive: true, force: true }));
	git(remote, "init", "--bare", "-b", "master");
	git(wiki, "remote", "add", "origin", remote);
	const result = generate(options(wiki));
	assert.throws(
		() => publish({ wiki, result, expectedRemote: `${remote}-wrong` }),
		/remote/i,
	);
	writeFileSync(join(wiki, "roadmap.svg"), "Changed");
	assert.throws(
		() => publish({ wiki, result, expectedRemote: remote }),
		/snapshot changed/i,
	);
	assert.equal(git(wiki, "rev-parse", "HEAD"), result.wikiRevision);
});

test("failure preserves the previous output pair, and dirty work and stale revisions are refused", (t) => {
	const wiki = fixture(t);
	generate(options(wiki));
	const revision = commit(wiki);
	const index = read(wiki, "roadmap.index.md"),
		svg = read(wiki, "roadmap.svg");
	writeFileSync(join(wiki, "roadmap.pfdsl"), "invalid >>\n");
	assert.throws(() => generate(options(wiki)), /clean/i);
	commit(wiki);
	assert.throws(
		() => generate({ ...options(wiki), expectedRevision: revision }),
		/revision conflict/i,
	);
	assert.throws(() => generate(options(wiki)));
	assert.equal(read(wiki, "roadmap.index.md"), index);
	assert.equal(read(wiki, "roadmap.svg"), svg);
});

test("does not silently ignore reference fields unsupported by the current resolver", (t) => {
	for (const addition of [
		"baseRef: {source: github:takasek/pfdsl, revision: main}\n",
		"artifact: {a: {ref: {source: github:takasek/pfdsl, revision: main}}}\n",
	]) {
		const wiki = fixture(t);
		writeFileSync(
			join(wiki, "roadmap.pfdsl"),
			`---\n${addition}---\na >> p -> b\n`,
		);
		commit(wiki);
		assert.throws(
			() => generate(options(wiki)),
			/reference resolution.*not supported/i,
		);
	}
});

test("checks external references in the actual dependency closure regardless of filename extension", (t) => {
	const wiki = fixture(t);
	writeFileSync(
		join(wiki, "roadmap.pfdsl"),
		model.replace("artifact:", "process: {p: {subflow: child.txt}}\nartifact:"),
	);
	writeFileSync(
		join(wiki, "child.txt"),
		"---\nbaseRef: {source: github:takasek/pfdsl, revision: main}\n---\na >> q -> b\n",
	);
	commit(wiki);
	assert.throws(
		() => generate(options(wiki)),
		/reference resolution.*not supported/i,
	);
});

test("escapes index metadata and rejects symlink inputs", (t) => {
	const wiki = fixture(t);
	writeFileSync(
		join(wiki, "roadmap.pfdsl"),
		model.replace("Trial roadmap", "'<img src=x> [click](evil)'"),
	);
	commit(wiki);
	generate(options(wiki));
	const page = read(wiki, "roadmap.index.md");
	assert.doesNotMatch(page, /<img/);
	assert.match(page, /&lt;img/);
	commit(wiki);
	rmSync(join(wiki, "roadmap.md"));
	symlinkSync("roadmap.pfdsl", join(wiki, "roadmap.md"));
	commit(wiki);
	assert.throws(() => generate(options(wiki)), /regular file/i);
});

test("publishes only the generated pair and refuses competing remote commits", (t) => {
	const wiki = fixture(t);
	const remote = mkdtempSync(join(tmpdir(), "wiki-remote-"));
	t.after(() => rmSync(remote, { recursive: true, force: true }));
	git(remote, "init", "--bare", "-b", "master");
	git(wiki, "remote", "add", "origin", remote);
	git(wiki, "push", "-u", "origin", "master");
	const result = generate(options(wiki));
	assert.equal(
		publish({ wiki, result, expectedRemote: remote }).status,
		"published",
	);
	assert.deepEqual(
		git(wiki, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
			.split("\n")
			.sort(),
		["roadmap.index.md", "roadmap.svg"],
	);
	writeFileSync(join(wiki, "roadmap.md"), "Changed companion\n");
	commit(wiki);
	git(wiki, "push");
	const next = generate(options(wiki));
	git(wiki, "push", "origin", `${next.wikiRevision}:refs/heads/competing`);
	// Advance the remote master without changing this checkout.
	const other = mkdtempSync(join(tmpdir(), "wiki-editor-"));
	t.after(() => rmSync(other, { recursive: true, force: true }));
	git(other, "clone", remote, ".");
	git(other, "config", "user.name", "Editor");
	git(other, "config", "user.email", "editor@example.invalid");
	writeFileSync(join(other, "Other.md"), "Concurrent\n");
	commit(other);
	git(other, "push");
	assert.throws(
		() => publish({ wiki, result: next, expectedRemote: remote }),
		/conflict/i,
	);
	assert.equal(git(wiki, "rev-parse", "HEAD"), next.wikiRevision);
});
