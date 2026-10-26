import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { buildEditCandidate, prepareEdit } from "./wiki-roadmap-edit.mjs";

const hash = (s) => createHash("sha256").update(s).digest("hex");
const before =
	"---\ntype: roadmap\nartifact:\n  request: { status: done }\n  result: { status: todo, criteria: Reviewed. }\n---\nrequest >> verify -> result\n";
const afterSource = before.replace("status: todo", "status: wip");
const page = (source = before) =>
	`# Trial\n\nKeep this text.\n\n\`\`\`pfdsl\n${source}\`\`\`\n\n![Diagram](Roadmap.svg)\n`;
const request = (overrides = {}) => ({
	page: page(),
	wikiRevision: "a".repeat(40),
	expectedRevision: "a".repeat(40),
	expectedPageHash: hash(page()),
	replacement: afterSource,
	...overrides,
});

test("replaces only the PFD block and records source and page identities", () => {
	const result = buildEditCandidate(request());
	assert.equal(result.page, page(afterSource));
	assert.equal(result.source, afterSource);
	assert.equal(result.base.pageHash, hash(page()));
	assert.equal(result.base.sourceHash, hash(before));
	assert.equal(result.candidate.pageHash, hash(result.page));
	assert.equal(result.candidate.sourceHash, hash(afterSource));
});

test("rejects a changed wiki revision or page, including changes outside the fence", () => {
	assert.throws(
		() => buildEditCandidate(request({ expectedRevision: "b".repeat(40) })),
		/revision conflict/i,
	);
	assert.throws(
		() =>
			buildEditCandidate(request({ page: page().replace("Keep", "Changed") })),
		/page conflict/i,
	);
});

test("preserves CRLF and outside prose while normalizing the extracted model", () => {
	const original = page().replaceAll("\n", "\r\n");
	const result = buildEditCandidate(
		request({ page: original, expectedPageHash: hash(original) }),
	);
	assert.equal(result.page, page(afterSource).replaceAll("\n", "\r\n"));
	assert.equal(result.source, afterSource);
});

test("lengthens a fence to keep candidate YAML literal content inside the block", () => {
	const source = "---\ndescription: |\n  ```\n---\na >> p -> b\n";
	const result = buildEditCandidate(request({ replacement: source }));
	assert.match(result.page, /````pfdsl/);
	assert.equal(result.source, source);
});

test("preserves valid indented fences without consuming the model's YAML indentation", () => {
	for (const width of [1, 2, 3]) {
		const indentFence = (text) =>
			text.replace(/```pfdsl\n[\s\S]*?```/, (block) =>
				block
					.split("\n")
					.map((line) => " ".repeat(width) + line)
					.join("\n"),
			);
		const original = indentFence(page());
		const result = buildEditCandidate(
			request({ page: original, expectedPageHash: hash(original) }),
		);
		assert.equal(result.page, indentFence(page(afterSource)));
		assert.equal(result.source, afterSource);
	}
});

test("rejects missing, multiple, quoted and unclosed PFD fences", () => {
	for (const original of [
		"# Empty",
		page() + page(),
		"> ```pfdsl\n> a >> p -> b\n> ```\n",
		"```pfdsl\na >> p -> b\n",
	]) {
		assert.throws(() =>
			buildEditCandidate(
				request({ page: original, expectedPageHash: hash(original) }),
			),
		);
	}
});

const roots = [];
after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-wiki-edit-"));
	roots.push(root);
	const code = join(root, "code");
	const wiki = join(root, "wiki");
	mkdirSync(join(code, ".pfdsl"), { recursive: true });
	mkdirSync(wiki);
	const file = join(code, ".pfdsl/roadmap.pfdsl");
	writeFileSync(file, before);
	writeFileSync(join(wiki, "Roadmap.md"), page());
	return {
		root,
		output: join(root, "candidate"),
		snapshot: {
			code,
			wiki,
			file,
			page: page(),
			source: before,
			sourceHash: hash(before),
			wikiRevision: "a".repeat(40),
			repoRevision: "b".repeat(40),
		},
	};
}

test("validates a candidate with the real CLI, emits evidence, and never updates the wiki page", () => {
	const { output, snapshot } = fixture();
	const result = prepareEdit({
		snapshot,
		...request(),
		output,
		cli: resolve("packages/cli/dist/cli.js"),
	});
	assert.equal(
		readFileSync(join(output, "Roadmap.md"), "utf8"),
		page(afterSource),
	);
	assert.equal(readFileSync(join(snapshot.wiki, "Roadmap.md"), "utf8"), page());
	assert.equal(readFileSync(snapshot.file, "utf8"), before);
	assert.equal(result.referenceResolution, "not-verified");
	assert.equal(result.operationalReady, false);
	assert.equal(result.baseline.ready.ready[0].id, "verify");
	assert.deepEqual(result.ready.ready, []);
	assert.equal(result.base.wikiRevision, snapshot.wikiRevision);
	assert.equal(result.contextRepositoryRevision, snapshot.repoRevision);
	assert.match(result.toolchain.digest, /^[a-f0-9]{64}$/);
	assert.match(
		readFileSync(join(output, "Roadmap.diff"), "utf8"),
		/status: wip/,
	);
});

test("rejects invalid graph input without publishing a success directory and restores the snapshot", () => {
	const { output, snapshot } = fixture();
	assert.throws(() =>
		prepareEdit({
			snapshot,
			...request({ replacement: "a >> p -> a\n" }),
			output,
			cli: resolve("packages/cli/dist/cli.js"),
		}),
	);
	assert.equal(existsSync(output), false);
	assert.equal(readFileSync(snapshot.file, "utf8"), before);
});

test("does not overwrite an existing output directory", () => {
	const { output, snapshot } = fixture();
	mkdirSync(output);
	writeFileSync(join(output, "keep"), "mine");
	assert.throws(
		() =>
			prepareEdit({
				snapshot,
				...request(),
				output,
				cli: resolve("packages/cli/dist/cli.js"),
			}),
		/exists/i,
	);
	assert.equal(readFileSync(join(output, "keep"), "utf8"), "mine");
});

test("runs through the command-line entry point without GitHub or a push", () => {
	const { root } = fixture();
	const repo = join(root, "repo");
	const wiki = join(root, "remote-wiki");
	const git = (cwd, ...args) =>
		execFileSync("git", ["-C", cwd, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	for (const directory of [repo, wiki]) {
		mkdirSync(directory);
		git(directory, "init", "-b", "main");
		mkdirSync(join(directory, ".pfdsl"));
		writeFileSync(
			join(
				directory,
				directory === repo ? ".pfdsl/roadmap.pfdsl" : "Roadmap.md",
			),
			directory === repo ? before : page(),
		);
		git(directory, "add", ".");
		git(
			directory,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"-m",
			"fixture",
		);
	}
	const replacement = join(root, "replacement.pfdsl");
	writeFileSync(replacement, afterSource);
	const output = join(root, "cli-output");
	const revision = git(wiki, "rev-parse", "HEAD");
	execFileSync(
		process.execPath,
		[
			"scripts/wiki-roadmap-edit.mjs",
			"--repo",
			repo,
			"--wiki",
			wiki,
			"--repo-revision",
			"HEAD",
			"--expected-wiki-revision",
			revision,
			"--expected-page-hash",
			hash(page()),
			"--replacement",
			replacement,
			"--output",
			output,
		],
		{ stdio: "pipe" },
	);
	assert.equal(git(wiki, "rev-parse", "HEAD"), revision);
	assert.equal(
		readFileSync(join(output, "Roadmap.md"), "utf8"),
		page(afterSource),
	);
	assert.equal(
		JSON.parse(readFileSync(join(output, "manifest.json"))).operationalReady,
		false,
	);
});
