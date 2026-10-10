import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveGitRoots } from "./lib/run-exec.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const settings = JSON.parse(
	readFileSync(new URL("../.codex/hooks.json", import.meta.url), "utf8"),
);
const scratch = realpathSync(
	mkdtempSync(join(tmpdir(), "pfdsl-write-wiring-")),
);
after(() => rmSync(scratch, { recursive: true, force: true }));

function hooksFor(tool) {
	return settings.hooks.PreToolUse.filter((group) =>
		new RegExp(`^(?:${group.matcher})$`).test(tool),
	).flatMap((group) => group.hooks);
}

const commands = [
	"node scripts/worktree-write-guard.mjs",
	"node scripts/roadmap-publish-guard.mjs",
	"node scripts/generated-root-instructions-guard.mjs",
];

for (const tool of ["Edit", "Write", "apply_patch"]) {
	test(`Codex explicitly selects each write guard once for ${tool}`, () => {
		assert.deepEqual(
			hooksFor(tool).map((hook) => hook.command),
			commands,
		);
	});
}

test("configured apply_patch hooks deny primary edits and allow scratch edits", () => {
	const roots = resolveGitRoots(root);
	assert.ok(roots?.mainRoot);
	const env = { ...process.env, CLAUDE_PROJECT_DIR: "" };
	for (const key of Object.keys(env)) {
		if (key.startsWith("GIT_")) delete env[key];
	}
	const hooks = hooksFor("apply_patch");
	assert.equal(hooks.length, commands.length);
	for (const [target, expected] of [
		[join(roots.mainRoot, "AGENTS.md"), "deny"],
		[join(scratch, "AGENTS.md"), "allow"],
	]) {
		const decisions = hooks.map((hook) => {
			assert.match(hook.command, /^node scripts\/[a-z-]+\.mjs$/);
			const entry = hook.command.slice("node ".length);
			const result = spawnSync(process.execPath, [join(root, entry)], {
				cwd: root,
				env,
				encoding: "utf8",
				input: JSON.stringify({
					tool_name: "apply_patch",
					cwd: root,
					tool_input: {
						command: `*** Begin Patch\n*** Add File: ${target}\n+fixture\n*** End Patch`,
					},
				}),
			});
			assert.equal(result.status, 0, result.stdout + result.stderr);
			return result.stdout
				? JSON.parse(result.stdout).hookSpecificOutput?.permissionDecision
				: "allow";
		});
		assert.equal(decisions.includes("deny") ? "deny" : "allow", expected);
	}
});
