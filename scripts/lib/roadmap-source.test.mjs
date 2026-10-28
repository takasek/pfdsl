import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	acquireRoadmapSource,
	readRoadmapSourceConfig,
} from "./roadmap-source.mjs";

const git = (cwd, ...args) =>
	execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: "pipe",
	}).trim();
function repo(t) {
	const root = mkdtempSync(join(tmpdir(), "roadmap-source-test-"));
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
function fixture(t) {
	const wiki = repo(t),
		body = repo(t);
	mkdirSync(join(body, ".pfdsl"));
	writeFileSync(join(body, "plan.md"), "First plan\n");
	const c0 = commit(body);
	writeFileSync(
		join(wiki, "roadmap.pfdsl"),
		"---\ntype: roadmap\nbasePath: ..\nbaseRef: {source: body, revision: main}\nartifact:\n  a: {status: done, location: plan.md}\n  b: {status: todo, criteria: Reviewed., ref: {source: body, revision: alternate}}\n---\na >> p -> b\n",
	);
	writeFileSync(join(wiki, "roadmap.md"), "Companion\n");
	const w = commit(wiki);
	writeFileSync(join(body, "plan.md"), "Alternate plan\n");
	const c1 = commit(body);
	git(body, "branch", "alternate");
	git(body, "reset", "--hard", c0);
	const descriptor = {
		adapter: "local-git",
		source: "wiki",
		revision: w,
		documentId: "roadmap.pfdsl",
		companionId: "roadmap.md",
		logicalPath: ".pfdsl/roadmap.pfdsl",
		basis: { source: "body", revision: c0 },
	};
	return { wiki, body, c0, c1, w, descriptor, localSources: { wiki, body } };
}
test("without a source descriptor, preserves the repository reader path", (t) => {
	const root = repo(t);
	const result = acquireRoadmapSource({ repositoryRoot: root });
	assert.equal(result.file, join(root, ".pfdsl/roadmap.pfdsl"));
	assert.equal(result.context, undefined);
	result.dispose();
});
test("pins Wiki origin, independent model basis and each artifact target into one reusable context", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.body, "plan.md"), "Uncommitted plan\n");
	const result = acquireRoadmapSource(f);
	t.after(result.dispose);
	assert.equal(
		readFileSync(result.file, "utf8"),
		readFileSync(join(f.wiki, "roadmap.pfdsl"), "utf8"),
	);
	assert.equal(readFileSync(result.companionFile, "utf8"), "Companion\n");
	assert.deepEqual(result.context.model, {
		source: "wiki",
		fixedRevision: f.w,
		documentId: "roadmap.pfdsl",
		extractionId: "whole-file",
	});
	assert.equal(result.context.logicalPath, ".pfdsl/roadmap.pfdsl");
	assert.equal(result.context.basis.fixedRevision, f.c0);
	assert.equal(result.context.targets.length, 2);
	assert.equal(
		result.context.targets.find((target) => target.revision === "main")
			.fixedRevision,
		f.c0,
	);
	assert.equal(
		result.context.targets.find((target) => target.revision === "alternate")
			.fixedRevision,
		f.c1,
	);
	assert.equal(
		readFileSync(join(result.context.basis.root, "plan.md"), "utf8"),
		"First plan\n",
	);
	assert.deepEqual(
		JSON.parse(readFileSync(result.contextFile, "utf8")),
		result.context,
	);
	assert.equal(
		readFileSync(join(f.body, "plan.md"), "utf8"),
		"Uncommitted plan\n",
	);
	const file = result.file;
	result.dispose();
	assert.equal(existsSync(file), false);
});
test("repins moving refs on the next acquisition and changes the key even for the same Wiki", (t) => {
	const f = fixture(t);
	const first = acquireRoadmapSource(f);
	t.after(first.dispose);
	writeFileSync(join(f.body, "plan.md"), "New main\n");
	const latest = commit(f.body);
	const next = acquireRoadmapSource(f);
	t.after(next.dispose);
	assert.equal(
		first.context.targets.find((target) => target.revision === "main")
			.fixedRevision,
		f.c0,
	);
	assert.equal(
		next.context.targets.find((target) => target.revision === "main")
			.fixedRevision,
		latest,
	);
	assert.notEqual(first.key, next.key);
	assert.equal(
		first.context.model.fixedRevision,
		next.context.model.fixedRevision,
	);
});
test("unknown sources and revisions fail instead of using a checkout fallback", (t) => {
	const f = fixture(t);
	assert.throws(
		() => acquireRoadmapSource({ ...f, localSources: { wiki: f.wiki } }),
		/unknown source/i,
	);
	assert.throws(
		() =>
			acquireRoadmapSource({
				...f,
				descriptor: { ...f.descriptor, revision: "missing" },
			}),
		/unknown revision/i,
	);
	assert.throws(
		() =>
			acquireRoadmapSource({
				...f,
				descriptor: { ...f.descriptor, logicalPath: undefined },
			}),
		/logical.*path/i,
	);
});
test("rejects escaping symlinks before extraction and accepts contained links", (t) => {
	const f = fixture(t);
	symlinkSync("plan.md", join(f.body, "local-plan"));
	commit(f.body);
	const valid = acquireRoadmapSource(f);
	valid.dispose();
	symlinkSync("../outside", join(f.body, "escape"));
	commit(f.body);
	assert.throws(
		() => acquireRoadmapSource(f),
		/symlink.*outside|symlink.*escape/i,
	);
});

test("materializes original blob bytes including export-ignored and export-substituted files", (t) => {
	const f = fixture(t);
	const binary = Buffer.from([0, 255, 254, 13, 10, 128]);
	writeFileSync(
		join(f.body, ".gitattributes"),
		"plan.md export-subst\nbinary.bin export-ignore\n",
	);
	writeFileSync(join(f.body, "plan.md"), "$Format:%H$\n");
	writeFileSync(join(f.body, "binary.bin"), binary);
	const revision = commit(f.body);
	writeFileSync(
		join(f.wiki, ".gitattributes"),
		"roadmap.md export-ignore\nroadmap.pfdsl export-subst\n",
	);
	const wikiRevision = commit(f.wiki);
	const result = acquireRoadmapSource({
		...f,
		descriptor: {
			...f.descriptor,
			revision: wikiRevision,
			basis: { source: "body", revision },
		},
	});
	t.after(result.dispose);
	assert.equal(readFileSync(result.companionFile, "utf8"), "Companion\n");
	assert.equal(
		readFileSync(join(result.context.basis.root, "plan.md"), "utf8"),
		"$Format:%H$\n",
	);
	assert.deepEqual(
		readFileSync(join(result.context.basis.root, "binary.bin")),
		binary,
	);
});

test("shares a pinned selection between the model basis and artifacts", (t) => {
	const f = fixture(t);
	const result = acquireRoadmapSource({
		...f,
		descriptor: {
			...f.descriptor,
			basis: { source: "body", revision: "main" },
		},
	});
	t.after(result.dispose);
	const main = result.context.targets.find(
		(target) => target.revision === "main",
	);
	assert.equal(main.root, result.context.basis.root);
	assert.equal(main.fixedRevision, result.context.basis.fixedRevision);
});

test("reads dependencies from the model basis and records child origins with their own declarations", (t) => {
	const f = fixture(t);
	const child =
		"---\nartifact:\n  a: {location: ../plan.md, ref: {source: child-source, revision: main}}\n---\na >> q -> b\n";
	writeFileSync(join(f.body, ".pfdsl/child.txt"), child);
	const revision = commit(f.body);
	writeFileSync(
		join(f.wiki, "roadmap.pfdsl"),
		readFileSync(join(f.wiki, "roadmap.pfdsl"), "utf8").replace(
			"artifact:",
			"process: {p: {subflow: child.txt}}\nartifact:",
		),
	);
	writeFileSync(join(f.wiki, "child.txt"), "Wrong Wiki child\n");
	const wikiRevision = commit(f.wiki);
	const result = acquireRoadmapSource({
		...f,
		localSources: { ...f.localSources, "child-source": f.body },
		descriptor: {
			...f.descriptor,
			revision: wikiRevision,
			basis: { source: "body", revision },
		},
	});
	t.after(result.dispose);
	const doc = result.documents.find(
		(item) => item.logicalPath === ".pfdsl/child.txt",
	);
	assert.equal(readFileSync(doc.file, "utf8"), child);
	assert.deepEqual(doc.roles, ["subflow"]);
	const context = JSON.parse(readFileSync(doc.contextFile, "utf8"));
	assert.equal(context.model.source, "body");
	assert.equal(context.model.fixedRevision, revision);
	assert.equal(context.model.documentId, ".pfdsl/child.txt");
	assert.ok(context.targets.some((target) => target.source === "child-source"));
	assert.throws(
		() =>
			acquireRoadmapSource({
				...f,
				descriptor: {
					...f.descriptor,
					revision: wikiRevision,
					basis: undefined,
				},
			}),
		/missing model basis/i,
	);
});

test("rejects link-chain traversal and missing committed paths", (t) => {
	const f = fixture(t);
	symlinkSync(".", join(f.body, "root-link"));
	symlinkSync("root-link/../outside", join(f.body, "indirect-escape"));
	commit(f.body);
	assert.throws(() => acquireRoadmapSource(f), /symlink.*outside/i);
	assert.throws(
		() =>
			acquireRoadmapSource({
				...f,
				descriptor: { ...f.descriptor, documentId: "missing.pfdsl" },
			}),
		/missing snapshot path/i,
	);
});

test("reads explicit preparation configuration and refuses an empty settings file", (t) => {
	const root = repo(t),
		file = join(root, "settings.json");
	assert.deepEqual(readRoadmapSourceConfig(undefined), {});
	writeFileSync(file, "{}");
	assert.throws(
		() => readRoadmapSourceConfig(file),
		/requires roadmapSource and localSources/,
	);
	const settings = {
		roadmapSource: { adapter: "local-git" },
		localSources: { body: root },
	};
	writeFileSync(file, JSON.stringify(settings));
	assert.deepEqual(readRoadmapSourceConfig(file), settings);
});
