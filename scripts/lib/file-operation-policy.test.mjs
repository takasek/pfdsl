import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { after, test } from "node:test";
import {
	evaluatePhysicalWrites,
	normalizeFileOperations,
	resolvePhysicalPath,
} from "./file-operation-policy.mjs";

const root = realpathSync(mkdtempSync(join(tmpdir(), "pfdsl-file-policy-")));
const main = join(root, "main"),
	own = join(root, "own"),
	other = join(root, "other");
for (const path of [main, own, other]) mkdirSync(path);
mkdirSync(join(main, "dir"));
writeFileSync(join(main, "AGENTS.md"), "generated");
symlinkSync(join(main, "dir"), join(own, "alias"));
symlinkSync(join(main, "AGENTS.md"), join(own, "instructions"));
symlinkSync(join(root, "missing"), join(own, "dangling"));
for (const directory of [main, own, other]) {
	symlinkSync(join(root, "scratch.txt"), join(directory, "scratch-link"));
}
writeFileSync(join(root, "scratch.txt"), "old");
after(() => rmSync(root, { recursive: true, force: true }));

test("a broken repository outside the known root prefixes is not scratch", () => {
	const target = join(root, "broken-other");
	mkdirSync(target);
	writeFileSync(join(target, ".git"), "gitdir: /missing/native-checkout\n");
	const result = evaluatePhysicalWrites(
		{
			tool_name: "Write",
			tool_input: { file_path: join(target, "file.txt"), content: "ok" },
			cwd: own,
		},
		{ worktreeRoot: own, mainRoot: main, commonDir: join(main, ".git") },
		{ resolveRoots: () => null, supportsAsk: false },
	);
	assert.equal(result.decision, "deny");
});

const patch = (body) => ({
	tool_name: "apply_patch",
	cwd: own,
	tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch` },
});
const roots = {
	worktreeRoot: own,
	mainRoot: main,
	commonDir: join(main, ".git"),
};

test("patch header whitespace resolves the same symlink target as apply_patch", () => {
	assert.equal(
		evaluatePhysicalWrites(
			patch("*** Update File: instructions \n@@\n-generated\n+changed"),
			roots,
			io,
		).decision,
		"deny",
	);
});
const io = {
	resolveRoots: (path) =>
		path.startsWith(main)
			? { ...roots, worktreeRoot: main }
			: path.startsWith(other)
				? { ...roots, worktreeRoot: other }
				: path.startsWith(own)
					? roots
					: null,
	ownerRelation: (target) => (target === own ? "own" : "sibling"),
};

test("a child cannot rewrite or delete a linked checkout's Git pointer", () => {
	writeFileSync(join(own, ".git"), "gitdir: /fixture/metadata\n");
	for (const p of [
		{
			tool_name: "Write",
			cwd: own,
			tool_input: { file_path: join(own, ".git"), content: "changed" },
		},
		patch("*** Delete File: .git"),
	]) {
		assert.equal(
			evaluatePhysicalWrites({ ...p, agent_id: "child" }, roots, io).decision,
			"deny",
		);
	}
	assert.equal(
		evaluatePhysicalWrites(
			{ ...patch("*** Add File: ordinary.txt\n+ok"), agent_id: "child" },
			roots,
			io,
		).decision,
		"allow",
	);
});

test("all patch source/destination paths participate in one decision", () => {
	const p = patch(
		`*** Add File: safe.txt\n+ok\n*** Update File: old.txt\n*** Move to: ${other}/new.txt\n@@\n-old\n+new`,
	);
	const ops = normalizeFileOperations(p);
	assert.deepEqual(
		ops.map((op) => op.tool_input.file_path),
		[join(own, "safe.txt"), join(own, "old.txt"), join(other, "new.txt")],
	);
	assert.equal(evaluatePhysicalWrites(p, roots, io).decision, "deny");
});

test("relative paths, existing symlinks, symlink parents, and symlink/.. use physical semantics", () => {
	assert.equal(
		resolvePhysicalPath("alias/new.txt", own),
		join(main, "dir/new.txt"),
	);
	assert.equal(
		resolvePhysicalPath("alias/../AGENTS.md", own),
		join(main, "AGENTS.md"),
	);
	assert.equal(
		resolvePhysicalPath("instructions", own),
		join(main, "AGENTS.md"),
	);
	assert.equal(
		evaluatePhysicalWrites(
			patch("*** Add File: alias/new.txt\n+bad"),
			roots,
			io,
		).decision,
		"deny",
	);
	assert.throws(() => resolvePhysicalPath("dangling/new.txt", own));
});

test("Delete paths and unknown/malformed patch inputs cannot escape checks", () => {
	assert.equal(
		evaluatePhysicalWrites(
			patch(`*** Delete File: ${main}/AGENTS.md`),
			roots,
			io,
		).decision,
		"deny",
	);
	for (const body of [
		"*** Unknown File: x\n+y",
		"*** Add File: x\nnot-an-addition",
		"*** Update File: x\n@@\n?bad",
	])
		assert.throws(() => normalizeFileOperations(patch(body)));
	assert.throws(() =>
		normalizeFileOperations({
			tool_name: "apply_patch",
			cwd: own,
			tool_input: { command: "bad" },
		}),
	);
	assert.throws(() =>
		normalizeFileOperations({
			tool_name: "Write",
			tool_input: { file_path: "relative" },
		}),
	);
});

test("patch deletion checks the symlink entry rather than its referent", () => {
	for (const [path, decision] of [
		[join(main, "scratch-link"), "deny"],
		[join(other, "scratch-link"), "deny"],
		[join(own, "scratch-link"), "allow"],
		[join(own, "instructions"), "allow"],
		[join(own, "dangling"), "allow"],
		[`${own}/alias/../scratch-link`, "deny"],
	]) {
		const input = patch(`*** Delete File: ${path}`);
		assert.equal(
			evaluatePhysicalWrites(input, roots, io).decision,
			decision,
			path,
		);
	}
});

test("patch moves check source entries and destination content writes", () => {
	const move = (source, destination) =>
		patch(
			`*** Update File: ${source}\n*** Move to: ${destination}\n@@\n-old\n+new`,
		);
	for (const input of [
		move(join(main, "scratch-link"), join(own, "moved.txt")),
		move(join(main, "scratch-link"), join(main, "scratch-link")),
		move(join(other, "scratch-link"), join(own, "moved.txt")),
		move(join(own, "old.txt"), join(own, "instructions")),
	])
		assert.equal(evaluatePhysicalWrites(input, roots, io).decision, "deny");
	assert.equal(
		evaluatePhysicalWrites(
			move(join(own, "instructions"), join(own, "moved.txt")),
			roots,
			io,
		).decision,
		"allow",
	);
	assert.equal(
		evaluatePhysicalWrites(
			move(join(own, "scratch-link"), join(own, "moved.txt")),
			roots,
			io,
		).decision,
		"allow",
	);
	assert.equal(
		evaluatePhysicalWrites(
			move(join(own, "old.txt"), join(main, "scratch-link")),
			roots,
			io,
		).decision,
		"allow",
	);
	assert.equal(
		evaluatePhysicalWrites(
			patch(`*** Update File: ${main}/scratch-link\n@@\n-old\n+new`),
			roots,
			io,
		).decision,
		"allow",
	);
});

test("own native target and scratch are usable; another owner after cd remains rejected", () => {
	assert.equal(
		evaluatePhysicalWrites(patch("*** Add File: ok.txt\n+ok"), roots, io)
			.decision,
		"allow",
	);
	assert.equal(
		evaluatePhysicalWrites(
			patch(`*** Add File: ${root}/scratch.txt\n+ok`),
			roots,
			io,
		).decision,
		"allow",
	);
	assert.equal(
		evaluatePhysicalWrites(
			{ ...patch("*** Add File: no.txt\n+bad"), cwd: other },
			{ ...roots, worktreeRoot: other },
			io,
		).decision,
		"deny",
	);
	assert.equal(
		evaluatePhysicalWrites(patch("*** Add File: ok.txt\n+ok"), null, io)
			.decision,
		"deny",
	);
});

test("patch changes retain before/after text for roadmap detection", () => {
	const [op] = normalizeFileOperations(
		patch(
			"*** Update File: .pfdsl/roadmap.pfdsl\n@@\n publish_old:\n-old\n+new\n+publish_new:",
		),
	);
	assert.equal(op.tool_input.old_string, "publish_old:\nold");
	assert.equal(op.tool_input.new_string, "publish_old:\nnew\npublish_new:");
});

test("Windows file targets retain drive and UNC roots with native components", () => {
	const cwd = "Z:\\pfdsl-virtual-fixture\\repo";
	const fsApi = {
		lstatSync: () => {
			throw Object.assign(new Error("Absent fixture component"), {
				code: "ENOENT",
			});
		},
		realpathSync: () =>
			assert.fail("Virtual fixture has no existing components"),
	};
	for (const [target, expected] of [
		[
			"Z:\\pfdsl-virtual-fixture\\repo\\file.txt",
			"Z:\\pfdsl-virtual-fixture\\repo\\file.txt",
		],
		[
			"Z:/pfdsl-virtual-fixture/repo/file.txt",
			"Z:\\pfdsl-virtual-fixture\\repo\\file.txt",
		],
		["folder\\..\\file.txt", "Z:\\pfdsl-virtual-fixture\\repo\\file.txt"],
		[
			"\\\\pfdsl-virtual-server\\share\\repo\\file.txt",
			"\\\\pfdsl-virtual-server\\share\\repo\\file.txt",
		],
	]) {
		assert.equal(
			resolvePhysicalPath(target, cwd, { pathApi: win32, fsApi }),
			expected,
		);
	}
});
