import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import {
	acquire,
	evaluate,
	extractRoadmap,
	publish,
} from "./wiki-roadmap-spike.mjs";

const cli = resolve("packages/cli/dist/cli.js");
const temporaryRoots = [];
after(() => {
	for (const root of temporaryRoots)
		rmSync(root, { recursive: true, force: true });
});
const source = `---
type: roadmap
basePath: ..
artifact:
  input:
    status: done
    location: evidence.txt
  output:
    status: todo
    criteria: The trial output is available.
process:
  work:
    location: https://github.com/takasek/pfdsl/issues/1519
---
input >> work -> output
`;
const page = (s = source) =>
	`# Roadmap\n\nTrial only.\n\n\`\`\`pfdsl\n${s}\`\`\`\n`;
function git(cwd, ...args) {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function commit(cwd, name, content) {
	writeFileSync(join(cwd, name), content);
	git(cwd, "add", "--", name);
	git(
		cwd,
		"-c",
		"user.name=Wiki spike",
		"-c",
		"user.email=wiki-spike@example.invalid",
		"commit",
		"-m",
		"fixture",
	);
	return git(cwd, "rev-parse", "HEAD");
}
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-wiki-spike-"));
	temporaryRoots.push(root);
	const repo = join(root, "repo");
	const wiki = join(root, "wiki.git");
	const editor = join(root, "editor");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	mkdirSync(join(repo, ".pfdsl"));
	commit(repo, ".pfdsl/roadmap.pfdsl", source);
	const repoRevision = commit(
		repo,
		"evidence.txt",
		"Available at the pinned revision.\n",
	);
	git(root, "init", "--bare", "--initial-branch=main", wiki);
	git(root, "clone", wiki, editor);
	commit(editor, "Roadmap.md", page());
	git(editor, "push", "origin", "HEAD:main");
	return { root, repo, wiki, editor, repoRevision };
}

test("extracts one closed top-level PFDSL fence and rejects missing, ambiguous and unfinished input", () => {
	assert.equal(extractRoadmap(page()), source);
	assert.equal(extractRoadmap(`~~~pfdsl\n${source}~~~\n`), source);
	for (const invalid of [
		"# Empty",
		page() + page(),
		`\`\`\`pfdsl\n${source}`,
		"> ```pfdsl\n> input >> work -> output\n> ```",
	]) {
		assert.throws(() => extractRoadmap(invalid));
	}
});

test("pins Wiki and code revisions, uses one real file for check/ready/render/links, and skips unchanged input", () => {
	const f = fixture();
	const snapshot = acquire(f);
	const result = evaluate(snapshot, cli);
	assert.equal(result.ready.ready[0].id, "work");
	assert.match(result.svg, /<svg/);
	assert.match(
		result.svg,
		/https:\/\/github.com\/takasek\/pfdsl\/issues\/1519/,
	);
	assert.equal(readFileSync(snapshot.file, "utf8"), source);
	commit(f.repo, "evidence.txt", "Changed after acquisition\n");
	assert.match(
		readFileSync(join(snapshot.code, "evidence.txt"), "utf8"),
		/^Available/,
	);
	const published = publish(snapshot, result, cli);
	assert.equal(published.status, "published");
	git(f.editor, "pull", "--ff-only");
	assert.equal(readFileSync(join(f.editor, "Roadmap.md"), "utf8"), page());
	commit(f.editor, "Unrelated.md", "Other page\n");
	git(f.editor, "push", "origin", "HEAD:main");
	const next = acquire(f);
	assert.equal(evaluate(next, cli).status, "unchanged");
});

test("concurrent editors and stale renders cannot overwrite a newer page", () => {
	const f = fixture();
	const old = acquire(f);
	const result = evaluate(old, cli);
	const replacement = page(source.replace("status: todo", "status: wip"));
	commit(f.editor, "Roadmap.md", replacement);
	git(f.editor, "push", "origin", "HEAD:main");
	assert.throws(() => publish(old, result, cli), /conflict/i);
	commit(
		old.wiki,
		"Roadmap.md",
		page(source.replace("status: todo", "status: done")),
	);
	assert.throws(() => git(old.wiki, "push", "origin", "HEAD:main"));
	assert.equal(git(f.wiki, "show", "main:Roadmap.md"), replacement.trim());
});

test("fetch and validation failures never become empty plans or successful cached renders", () => {
	const f = fixture();
	const valid = acquire(f);
	publish(valid, evaluate(valid, cli));
	git(f.editor, "pull", "--ff-only");
	assert.throws(() => acquire({ ...f, wiki: join(f.root, "missing.git") }));
	for (const invalid of [
		"# Missing block",
		page("---\n: broken: [\n---\na >> p -> b\n"),
		page("a >> p -> b\nb >> q -> a\n"),
	]) {
		commit(f.editor, "Roadmap.md", invalid);
		git(f.editor, "push", "origin", "HEAD:main");
		assert.throws(() => evaluate(acquire(f), cli));
	}
});

test("relative location, extends and subflow resolve against pinned repository layout", () => {
	const f = fixture();
	commit(
		f.repo,
		".pfdsl/preset.yaml",
		'statusStyles:\n  done: { fillcolor: "#123456", style: filled }\n',
	);
	const repoRevision = commit(
		f.repo,
		".pfdsl/child.pfdsl",
		"input >> p -> output\n",
	);
	const linked = source
		.replace("basePath: ..", "basePath: ..\nextends: preset.yaml")
		.replace("  work:\n", "  work:\n    subflow: child.pfdsl\n");
	commit(f.editor, "Roadmap.md", page(linked));
	git(f.editor, "push", "origin", "HEAD:main");
	const snapshot = acquire({ ...f, repoRevision });
	assert.match(evaluate(snapshot, cli).svg, /#123456/i);
	for (const missing of ["preset.yaml", "child.pfdsl", "evidence.txt"]) {
		const invalid = linked.replace(missing, "missing-file");
		commit(f.editor, "Roadmap.md", page(invalid));
		git(f.editor, "push", "origin", "HEAD:main");
		assert.throws(() => evaluate(acquire({ ...f, repoRevision }), cli));
	}
});

test("real repository roadmap round trip preserves ready and blocked graphs", () => {
	const f = fixture();
	const repo = resolve(".");
	const repoRevision = git(repo, "rev-parse", "HEAD");
	const actual = `${git(repo, "show", `${repoRevision}:.pfdsl/roadmap.pfdsl`)}\n`;
	commit(f.editor, "Roadmap.md", page(actual));
	git(f.editor, "push", "origin", "HEAD:main");
	const snapshot = acquire({ ...f, repo, repoRevision });
	const baseline = (command) =>
		JSON.parse(
			execFileSync(
				process.execPath,
				[cli, "status", command, snapshot.file, "--json"],
				{ encoding: "utf8" },
			),
		);
	assert.equal(readFileSync(snapshot.file, "utf8"), actual);
	const result = evaluate(snapshot, cli);
	assert.deepEqual(result.ready, baseline("ready"));
	assert.deepEqual(result.blocked, baseline("blocked"));
	assert.match(result.svg, /<svg/);
});

test("migration and return preserve bytes and ready/blocked results", () => {
	const f = fixture();
	const before = (command) =>
		JSON.parse(
			execFileSync(
				process.execPath,
				[
					cli,
					"status",
					command,
					join(f.repo, ".pfdsl/roadmap.pfdsl"),
					"--json",
				],
				{ encoding: "utf8" },
			),
		);
	const ready = before("ready");
	const blocked = before("blocked");
	const snapshot = acquire(f);
	const result = evaluate(snapshot, cli);
	assert.deepEqual(result.ready, ready);
	assert.deepEqual(result.blocked, blocked);
	writeFileSync(
		join(f.repo, ".pfdsl/roadmap.pfdsl"),
		readFileSync(snapshot.file),
	);
	assert.equal(
		readFileSync(join(f.repo, ".pfdsl/roadmap.pfdsl"), "utf8"),
		source,
	);
	assert.deepEqual(before("ready"), ready);
	assert.deepEqual(before("blocked"), blocked);
});

test("publishing preserves leading and trailing whitespace in the Wiki page", () => {
	const f = fixture();
	const original = `\n  \n${page()}\n  \n`;
	commit(f.editor, "Roadmap.md", original);
	git(f.editor, "push", "origin", "HEAD:main");
	const snapshot = acquire(f);
	assert.equal(publish(snapshot, evaluate(snapshot, cli)).status, "published");
	git(f.editor, "pull", "--ff-only");
	assert.equal(readFileSync(join(f.editor, "Roadmap.md"), "utf8"), original);
});

test("rejects a render for a different repository revision before changing the Wiki", () => {
	const f = fixture();
	const firstRevision = commit(
		f.repo,
		".pfdsl/preset.yaml",
		'statusStyles:\n  done: { fillcolor: "#123456", style: filled }\n',
	);
	commit(
		f.editor,
		"Roadmap.md",
		page(source.replace("basePath: ..", "basePath: ..\nextends: preset.yaml")),
	);
	git(f.editor, "push", "origin", "HEAD:main");
	const first = acquire({ ...f, repoRevision: firstRevision });
	const oldResult = evaluate(first, cli);
	assert.match(oldResult.svg, /#123456/i);
	const secondRevision = commit(
		f.repo,
		".pfdsl/preset.yaml",
		'statusStyles:\n  done: { fillcolor: "#abcdef", style: filled }\n',
	);
	const second = acquire({ ...f, repoRevision: secondRevision });
	assert.equal(first.sourceHash, second.sourceHash);
	assert.notEqual(first.repoRevision, second.repoRevision);
	const before = git(f.wiki, "rev-parse", "main");
	assert.throws(
		() => publish(second, oldResult),
		/No matching rendered result/,
	);
	assert.equal(git(f.wiki, "rev-parse", "main"), before);
	assert.equal(git(second.wiki, "status", "--porcelain"), "");
	const currentResult = evaluate(second, cli);
	assert.match(currentResult.svg, /#abcdef/i);
	assert.equal(publish(second, currentResult).status, "published");
	const manifest = JSON.parse(git(f.wiki, "show", "main:Roadmap.render.json"));
	assert.equal(manifest.repoRevision, secondRevision);
	assert.equal(manifest.key, currentResult.key);
});
