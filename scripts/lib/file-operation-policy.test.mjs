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
import { join } from "node:path";
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
