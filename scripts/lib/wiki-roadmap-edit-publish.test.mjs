import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { publishEdit } from "./wiki-roadmap-edit-publish.mjs";

const git = (cwd, ...args) =>
	execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
const read = (root, name) => readFileSync(join(root, name), "utf8");
const source =
	"---\ntype: roadmap\ntitle: Before\nartifact:\n  a: {status: done}\n  b: {status: todo, criteria: Reviewed.}\n---\na >> p -> b\n";
const edited = source.replace("Before", "After");
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "wiki-edit-publish-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const remote = join(root, "remote.git"),
		wiki = join(root, "wiki");
	git(root, "init", "--bare", "-b", "master", remote);
	git(root, "clone", remote, wiki);
	git(wiki, "config", "user.name", "Test editor");
	git(wiki, "config", "user.email", "editor@example.invalid");
	writeFileSync(join(wiki, "roadmap.pfdsl"), source);
	writeFileSync(join(wiki, "roadmap.md"), "# Companion\n\nPreserve me.\n");
	writeFileSync(join(wiki, "Home.md"), "Home\n");
	git(wiki, "add", ".");
	git(wiki, "commit", "-m", "Initial Wiki");
	git(wiki, "push", "-u", "origin", "master");
	return { root, remote, wiki, base: git(wiki, "rev-parse", "HEAD") };
}
const options = (f) => ({
	wiki: f.wiki,
	repository: "takasek/pfdsl",
	expectedRemote: f.remote,
	cli: resolve("packages/cli/dist/cli.js"),
	temporaryRoot: f.root,
});
function remoteBytes(f, name) {
	return execFileSync("git", ["-C", f.remote, "show", `master:${name}`], {
		encoding: "utf8",
	});
}

test("one publication sends edited source and matching generated files, then leaves the editor clone usable", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), edited);
	const updates = join(f.root, "published-updates");
	const hook = join(f.remote, "hooks/post-receive");
	writeFileSync(
		hook,
		`#!/usr/bin/env node\nconst fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(updates)},fs.readFileSync(0));\n`,
	);
	chmodSync(hook, 0o755);
	const transportLog = join(f.root, "transport-used");
	const receivePack = join(f.root, "receive-pack");
	writeFileSync(
		receivePack,
		`#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(transportLog)},'used\\n');\nconst r=require('node:child_process').spawnSync('git-receive-pack',process.argv.slice(2),{stdio:'inherit'});process.exit(r.status ?? 1);\n`,
	);
	chmodSync(receivePack, 0o755);
	git(f.wiki, "config", "remote.origin.receivepack", receivePack);
	const result = publishEdit(options(f));
	assert.equal(result.status, "published");
	assert.equal(result.localUpdated, true);
	assert.equal(git(f.remote, "rev-parse", "master"), result.revision);
	assert.equal(git(f.remote, "rev-parse", "master^"), result.sourceRevision);
	assert.equal(git(f.remote, "rev-parse", "master^^"), f.base);
	const received = readFileSync(updates, "utf8").trim().split("\n");
	assert.equal(received.length, 1);
	assert.equal(received[0], `${f.base} ${result.revision} refs/heads/master`);
	assert.equal(readFileSync(transportLog, "utf8"), "used\n");
	assert.equal(remoteBytes(f, "roadmap.pfdsl"), edited);
	assert.equal(remoteBytes(f, "roadmap.md"), "# Companion\n\nPreserve me.\n");
	assert.equal(remoteBytes(f, "Home.md"), "Home\n");
	const index = remoteBytes(f, "roadmap.index.md"),
		svg = remoteBytes(f, "roadmap.svg");
	assert.match(index, /# After/);
	assert.match(svg, /<svg/);
	const receipt = JSON.parse(
		index.split("<!-- pfdsl-wiki-preview: ")[1].split(" -->")[0],
	);
	assert.equal(receipt.wikiRevision, result.sourceRevision);
	assert.equal(
		receipt.sourceHash,
		createHash("sha256").update(edited).digest("hex"),
	);
	assert.equal(receipt.svgHash, createHash("sha256").update(svg).digest("hex"));
	assert.equal(git(f.wiki, "rev-parse", "HEAD"), result.revision);
	assert.equal(git(f.wiki, "status", "--porcelain"), "");
	assert.equal(publishEdit(options(f)).status, "unchanged");
	writeFileSync(join(f.wiki, "roadmap.md"), "Updated companion only\n");
	assert.equal(publishEdit(options(f)).status, "published");
	assert.equal(remoteBytes(f, "roadmap.pfdsl"), edited);
	assert.equal(remoteBytes(f, "roadmap.md"), "Updated companion only\n");
});

test("invalid edits preserve the editor's bytes and leave all public files and local HEAD unchanged", (t) => {
	const f = fixture(t);
	const invalid = "a >> p -> a\n";
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), invalid);
	assert.throws(() => publishEdit(options(f)), /V010|V035/);
	assert.equal(git(f.remote, "rev-parse", "master"), f.base);
	assert.equal(git(f.wiki, "rev-parse", "HEAD"), f.base);
	assert.equal(read(f.wiki, "roadmap.pfdsl"), invalid);
	assert.equal(remoteBytes(f, "roadmap.pfdsl"), source);
	assert.equal(existsSync(join(f.wiki, "roadmap.svg")), false);
});

test("restoring cached valid content publishes the source commit without regenerating or staging leftover edits", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), edited);
	const accepted = publishEdit(options(f));
	const index = remoteBytes(f, "roadmap.index.md");
	const svg = remoteBytes(f, "roadmap.svg");
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), "a >> p -> a\n");
	git(f.wiki, "add", "roadmap.pfdsl");
	git(f.wiki, "commit", "-m", "Unvalidated external edit");
	git(f.wiki, "push");
	const invalidRevision = git(f.remote, "rev-parse", "master");
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), edited);
	const result = publishEdit(options(f));
	assert.equal(result.status, "published");
	assert.equal(result.localUpdated, true);
	assert.equal(result.revision, result.sourceRevision);
	assert.equal(result.inputWikiRevision, accepted.sourceRevision);
	assert.equal(git(f.remote, "rev-parse", "master"), result.revision);
	assert.equal(git(f.remote, "rev-parse", "master^"), invalidRevision);
	assert.equal(remoteBytes(f, "roadmap.pfdsl"), edited);
	assert.equal(remoteBytes(f, "roadmap.index.md"), index);
	assert.equal(remoteBytes(f, "roadmap.svg"), svg);
	assert.equal(git(f.wiki, "rev-parse", "HEAD"), result.revision);
	assert.equal(git(f.wiki, "status", "--porcelain"), "");
	assert.equal(publishEdit(options(f)).status, "unchanged");
});

test("stale editors and unrelated or staged edits are refused without losing work", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), edited);
	writeFileSync(join(f.wiki, "Home.md"), "Unrelated edit\n");
	assert.throws(() => publishEdit(options(f)), /only.*roadmap/i);
	writeFileSync(join(f.wiki, "Home.md"), "Home\n");
	git(f.wiki, "add", "roadmap.pfdsl");
	assert.throws(() => publishEdit(options(f)), /index.*clean|staged/i);
	git(f.wiki, "restore", "--staged", "roadmap.pfdsl");
	const other = join(f.root, "other");
	git(f.root, "clone", f.remote, other);
	git(other, "config", "user.name", "Other editor");
	git(other, "config", "user.email", "other@example.invalid");
	writeFileSync(join(other, "roadmap.md"), "Concurrent companion\n");
	git(other, "add", ".");
	git(other, "commit", "-m", "Companion edit");
	git(other, "push");
	const head = git(f.remote, "rev-parse", "master");
	assert.throws(() => publishEdit(options(f)), /conflict/i);
	assert.equal(git(f.remote, "rev-parse", "master"), head);
	assert.equal(read(f.wiki, "roadmap.pfdsl"), edited);
});

test("rejected pushes retain a recoverable prepared checkout, and a later retry publishes normally", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), edited);
	const hook = join(f.remote, "hooks/pre-receive");
	writeFileSync(hook, "#!/usr/bin/env node\nprocess.exit(1);\n");
	chmodSync(hook, 0o755);
	let failure;
	try {
		publishEdit(options(f));
	} catch (error) {
		failure = error;
	}
	assert.ok(failure);
	assert.ok(failure.recovery?.path);
	assert.ok(existsSync(join(failure.recovery.path, "roadmap.svg")));
	assert.equal(read(f.wiki, "roadmap.pfdsl"), edited);
	assert.equal(git(f.remote, "rev-parse", "master"), f.base);
	rmSync(hook);
	assert.equal(publishEdit(options(f)).status, "published");
	assert.equal(remoteBytes(f, "roadmap.pfdsl"), edited);
});

test("a newer in-progress editor change survives a successful publication and is reported as not synchronized", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), edited);
	const newer = edited.replace("After", "Still editing");
	const hook = join(f.remote, "hooks/pre-receive");
	writeFileSync(
		hook,
		`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(join(f.wiki, "roadmap.pfdsl"))},${JSON.stringify(newer)});\n`,
	);
	chmodSync(hook, 0o755);
	const result = publishEdit(options(f));
	assert.equal(result.status, "published");
	assert.equal(result.localUpdated, false);
	assert.equal(remoteBytes(f, "roadmap.pfdsl"), edited);
	assert.equal(read(f.wiki, "roadmap.pfdsl"), newer);
	assert.equal(git(f.wiki, "rev-parse", "HEAD"), f.base);
});

test("temporary cleanup failure does not hide a completed publication", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.wiki, "roadmap.pfdsl"), edited);
	const marker = join(f.root, "blocked-cleanup");
	const hook = join(f.remote, "hooks/post-receive");
	writeFileSync(
		hook,
		`#!/usr/bin/env node\nconst fs=require('node:fs'),p=require('node:path');const root=${JSON.stringify(f.root)};const dir=p.join(root,fs.readdirSync(root).find(n=>n.startsWith('pfdsl-wiki-edit-')),'wiki','.git');fs.writeFileSync(${JSON.stringify(marker)},dir);fs.chmodSync(dir,0o500);\n`,
	);
	chmodSync(hook, 0o755);
	let result, failure;
	try {
		result = publishEdit(options(f));
	} catch (error) {
		failure = error;
	} finally {
		if (existsSync(marker)) chmodSync(readFileSync(marker, "utf8"), 0o755);
	}
	assert.equal(failure, undefined);
	assert.equal(result.status, "published");
	assert.equal(result.localUpdated, true);
	assert.match(result.cleanupWarning, /cleanup/i);
	assert.ok(existsSync(result.cleanupPath));
	assert.equal(git(f.remote, "rev-parse", "master"), result.revision);
});
