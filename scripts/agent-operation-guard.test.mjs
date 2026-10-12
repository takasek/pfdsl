import assert from "node:assert/strict";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parserRecoveryCommand } from "./lib/agent-operation-table.mjs";
import { run, tryRun, withoutGitTargetEnvironment } from "./lib/run-exec.mjs";
import { shellParserPath } from "./lib/shell-parser-tool.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const helperFiles = [
	"agent-operation-guard.mjs",
	"setup-shell-parser.mjs",
	"lib/agent-operation-classifier.mjs",
	"lib/agent-operation-table.mjs",
	"lib/agent-operation-policy.mjs",
	"lib/agent-operation-environment.mjs",
	"lib/shell-commands.mjs",
	"lib/shell-parser-tool.mjs",
	"lib/run-exec.mjs",
	"lib/git-environment.mjs",
	"lib/native-worktree-owner.mjs",
	"lib/physical-path.mjs",
	"lib/guard-probe.mjs",
	"lib/policy-supervisor.mjs",
	"lib/agent-operation-timeouts.mjs",
	"lib/hook-io.mjs",
	"lib/cli-entrypoint.mjs",
];
function fixture() {
	const root = mkdtempSync(join(source, "node_modules/pfdsl-entry-"));
	const primary = join(root, "primary"),
		own = join(root, "own"),
		other = join(root, "other");
	const env = withoutGitTargetEnvironment(process.env);
	delete env.CLAUDE_PROJECT_DIR;
	const git = (cwd, args) =>
		run("git", args, { cwd, env, captureStderr: true }).trim();
	mkdirSync(primary);
	git(primary, ["init", "-b", "main"]);
	git(primary, ["config", "user.name", "Guard Fixture"]);
	git(primary, ["config", "user.email", "guard@example.invalid"]);
	writeFileSync(join(primary, "a"), "base\n");
	git(primary, ["add", "a"]);
	git(primary, ["commit", "-m", "fixture"]);
	git(primary, ["remote", "add", "origin", primary]);
	git(primary, [
		"symbolic-ref",
		"refs/remotes/origin/HEAD",
		"refs/remotes/origin/main",
	]);
	git(primary, ["worktree", "add", "-b", "feat/own", own]);
	git(primary, ["worktree", "add", "-b", "feat/other", other]);
	for (const relative of helperFiles) {
		const target = join(own, "scripts", relative);
		mkdirSync(dirname(target), { recursive: true });
		if (existsSync(join(source, "scripts", relative)))
			copyFileSync(join(source, "scripts", relative), target);
	}
	mkdirSync(dirname(shellParserPath(own)), { recursive: true });
	copyFileSync(shellParserPath(source), shellParserPath(own));
	chmodSync(shellParserPath(own), 0o755);
	const invoke = (
		tool_input,
		{
			harness = "claude",
			tool_name = "Bash",
			cwd = own,
			agent_id,
			agent_type,
			environment = {},
		} = {},
	) => {
		const payload = {
			tool_name,
			cwd,
			session_id: "fixture-session",
			...(agent_id ? { agent_id } : {}),
			...(agent_type ? { agent_type } : {}),
			tool_input,
		};
		const result = tryRun(
			process.execPath,
			[join(own, "scripts/agent-operation-guard.mjs")],
			{
				cwd: other,
				env: {
					...env,
					CLAUDE_PROJECT_DIR: harness === "claude" ? own : "",
					...environment,
				},
				input: JSON.stringify(payload),
				captureStderr: true,
				timeout: 8000,
			},
		);
		const output = result.out.trim()
			? JSON.parse(result.out).hookSpecificOutput
			: null;
		return {
			...result,
			decision: output?.permissionDecision ?? (result.ok ? "allow" : "failed"),
			reason: output?.permissionDecisionReason,
		};
	};
	return {
		root,
		primary,
		own,
		other,
		git,
		invoke,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("entry integration: normal and safety representatives for Claude and Codex", () => {
	const f = fixture();
	try {
		for (const [command, expected, harness] of [
			[`cd ${f.own} && git add a && git commit -m x`, "allow", "claude"],
			[`git -C ${f.own} commit -m x`, "allow", "codex"],
			["git commit -m x", "deny", "codex"],
			[`git -C ${f.other} add a`, "deny", "claude"],
			[`git -C ${f.primary} commit -m x`, "deny", "codex"],
			[`git -C ${f.own} commit --no-verify -m x`, "deny", "claude"],
			["git config user.name x", "ask", "claude"],
			[`git -C ${f.own} config user.name x`, "deny", "codex"],
			["gh pr merge 1413", "deny", "claude"],
		]) {
			const result = f.invoke({ command }, { harness });
			assert.equal(result.status, 0, result.out);
			assert.equal(result.decision, expected, command);
		}
		assert.equal(
			f.invoke(
				{ command: "gh pr create" },
				{ agent_id: "child", agent_type: "reviewer" },
			).decision,
			"deny",
		);
		assert.match(
			f.invoke(
				{ command: "gh pr create" },
				{ agent_id: "child", agent_type: "reviewer" },
			).reason,
			/Recovery: parent/,
		);
		assert.equal(
			f.invoke(
				{ command: "gh pr create" },
				{ agent_id: "child", agent_type: "issue-worker" },
			).decision,
			"allow",
		);
		assert.equal(
			f.invoke(
				{ file_path: join(f.primary, "a"), content: "x" },
				{ tool_name: "Write" },
			).decision,
			"deny",
		);
		assert.match(
			f.invoke(
				{ file_path: join(f.primary, "a"), content: "x" },
				{ tool_name: "Write" },
			).reason,
			/Recovery: human terminal/,
		);
		const patch = `*** Begin Patch\n*** Add File: ${f.own}/child-file\n+x\n*** End Patch`;
		assert.equal(
			f.invoke(
				{ command: patch },
				{ tool_name: "apply_patch", harness: "codex", agent_id: "child" },
			).decision,
			"allow",
		);
		assert.equal(
			f.invoke(
				{},
				{ tool_name: "mcp__github__merge_pull_request", harness: "codex" },
			).decision,
			"deny",
		);
		assert.equal(
			f.invoke(
				{},
				{ tool_name: "mcp__github__get_pull_request", harness: "codex" },
			).decision,
			"allow",
		);
	} finally {
		f.cleanup();
	}
});

test("entry integration: stage-three ordinary verbs, literal targets and routine children", () => {
	const f = fixture();
	try {
		for (const command of [
			"git rev-list --count HEAD",
			"git reflog",
			"git reflog show",
			"git for-each-ref",
			"git ls-remote origin",
			"git check-ignore a.txt",
			"git diff-tree -r HEAD",
			"git symbolic-ref --short HEAD",
			"git shortlog -sn",
			"git range-diff a...b",
			"git patch-id",
			"git count-objects -v",
			"git tag -l",
			"git sparse-checkout list",
			"git format-patch -1",
			"git hash-object a.txt",
			"git commit-tree HEAD^{tree} -m x",
			"git pull",
			"git pull --rebase",
			"git pull --ff-only",
			"git pull origin main",
			"git tag v1",
			"git init /tmp/x",
			"git clone https://example.invalid/r /tmp/b",
			"git archive HEAD -o /tmp/x.tar",
			"git bundle create /tmp/x.bundle HEAD",
			"git worktree prune",
			"git bisect start",
			"git submodule update --init",
		]) {
			const result = f.invoke({ command });
			assert.equal(result.status, 0, result.out);
			assert.equal(result.decision, "allow", command);
		}
		for (const command of [
			`pushd '${f.primary}' && git add -A`,
			`export GIT_DIR='${f.primary}/.git' GIT_WORK_TREE='${f.primary}'; git add -A`,
			`bash -c 'git -C ${f.primary} commit -m x'`,
			`eval 'git -C ${f.primary} commit -m x'`,
		])
			assert.equal(f.invoke({ command }).decision, "deny", command);
		for (const verb of ["stage-all", "commit", "branch-rename"]) {
			const command = `/personal/codex-git-routine.mjs ${verb} ${f.own} feat/own x`;
			const result = f.invoke(
				{ command },
				{ harness: "codex", agent_id: "child" },
			);
			assert.equal(result.decision, "deny", verb);
			assert.match(result.reason, /Recovery: parent/);
			assert.equal(
				f.invoke({ command }, { harness: "codex" }).decision,
				"allow",
			);
		}
	} finally {
		f.cleanup();
	}
});

test("entry integration: parser missing -> exact bootstrap repair -> installed healthy -> normal allow", () => {
	const f = fixture();
	try {
		rmSync(shellParserPath(f.own));
		const denied = f.invoke(
			{ command: `git -C ${f.own} commit -m x` },
			{ harness: "codex" },
		);
		assert.equal(denied.decision, "deny");
		const repair = parserRecoveryCommand(f.own);
		assert.ok(denied.reason.includes(repair));
		assert.equal(
			f.invoke({ command: repair }, { harness: "codex" }).decision,
			"allow",
		);
		assert.equal(
			f.invoke({ command: "make setup" }, { harness: "codex" }).decision,
			"deny",
		);
		assert.equal(
			f.invoke({ command: `${repair}; git status` }, { harness: "codex" })
				.decision,
			"deny",
		);
		const download = join(f.root, "download.mjs");
		writeFileSync(
			download,
			`import { readFileSync } from "node:fs"; globalThis.fetch = async () => ({ok: true, arrayBuffer: async () => readFileSync(${JSON.stringify(shellParserPath(source))})});\n`,
		);
		run(
			process.execPath,
			["--import", download, join(f.own, "scripts/setup-shell-parser.mjs")],
			{ cwd: f.other, captureStderr: true },
		);
		assert.equal(
			f.invoke({ command: `git -C ${f.own} commit -m x` }, { harness: "codex" })
				.decision,
			"allow",
		);
	} finally {
		f.cleanup();
	}
});

test("entry integration: native identity allows its owner and preserves stale, malformed and bypass denials", () => {
	const f = fixture();
	try {
		const metadata = f.git(f.other, [
			"rev-parse",
			"--git-path",
			"codex-thread.json",
		]);
		const command = `git -C '${f.other}' add a`;
		writeFileSync(
			metadata,
			JSON.stringify({ version: 1, ownerThreadId: "fixture-session" }),
		);
		assert.equal(f.invoke({ command }, { harness: "codex" }).decision, "allow");
		assert.equal(
			f.invoke(
				{ command: `git -C '${f.other}' commit --no-verify -m x` },
				{ harness: "codex" },
			).decision,
			"deny",
		);
		for (const text of [
			JSON.stringify({ version: 1, ownerThreadId: "other" }),
			"{broken",
		]) {
			writeFileSync(metadata, text);
			assert.equal(
				f.invoke(
					{ command },
					{ harness: "codex", environment: { CODEX_THREAD_ID: "other" } },
				).decision,
				"deny",
			);
		}
		rmSync(metadata);
		assert.equal(f.invoke({ command }, { harness: "codex" }).decision, "deny");
		writeFileSync(
			metadata,
			JSON.stringify({ version: 1, ownerThreadId: "fixture-session" }),
		);
		assert.equal(
			f.invoke(
				{ command },
				{
					harness: "codex",
					environment: {
						GIT_DIR: f.git(f.other, ["rev-parse", "--absolute-git-dir"]),
					},
				},
			).decision,
			"deny",
		);
		const start = run("ps", ["-o", "lstart=", "-p", String(process.pid)], {
			env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
		}).trim();
		f.git(f.primary, [
			"worktree",
			"lock",
			"--reason",
			`claude session other (pid ${process.pid} start ${start})`,
			f.other,
		]);
		assert.equal(f.invoke({ command }).decision, "allow");
		f.git(f.primary, ["worktree", "unlock", f.other]);
		f.git(f.primary, [
			"worktree",
			"lock",
			"--reason",
			`claude session other (pid ${process.pid} start Tue Oct 6 00:00:00 2026)`,
			f.other,
		]);
		assert.equal(f.invoke({ command }).decision, "deny");
	} finally {
		f.cleanup();
	}
});

test("entry integration: missing policy and supervisor produce a human-terminal deny", () => {
	const f = fixture();
	try {
		rmSync(join(f.own, "scripts/lib/agent-operation-table.mjs"));
		const failed = f.invoke({ command: "git status" });
		assert.equal(failed.status, 2);
		assert.equal(failed.decision, "deny");
		assert.match(failed.reason, /human terminal/);
		assert.equal(
			f.invoke({ command: parserRecoveryCommand(f.own) }).decision,
			"deny",
			"a healthy parser is not a policy-load repair exemption",
		);
		rmSync(join(f.own, "scripts/lib/policy-supervisor.mjs"));
		const bootstrap = f.invoke({ command: "git status" });
		assert.equal(bootstrap.status, 2);
		assert.equal(bootstrap.decision, "deny");
		assert.match(bootstrap.reason, /human terminal/);
	} finally {
		f.cleanup();
	}
});

test("representative real Git oracle: default ref, other index, own commit", () => {
	const f = fixture();
	try {
		const base = f.git(f.own, ["rev-parse", "HEAD"]);
		writeFileSync(join(f.own, "a"), "own change\n");
		const own = `git -C ${f.own} add a && git -C ${f.own} commit -m own`;
		assert.equal(
			f.invoke({ command: own }, { harness: "codex" }).decision,
			"allow",
		);
		f.git(f.own, ["add", "a"]);
		f.git(f.own, ["commit", "-m", "own"]);
		const next = f.git(f.own, ["rev-parse", "HEAD"]);
		assert.notEqual(next, base);
		const changeDefault = `git -C ${f.own} update-ref refs/heads/main ${next}`;
		assert.equal(
			f.invoke({ command: changeDefault }, { harness: "codex" }).decision,
			"deny",
		);
		assert.equal(f.git(f.own, ["rev-parse", "refs/heads/main"]), base);
		// Counterfactual operations run only in this disposable oracle fixture.
		f.git(f.own, ["update-ref", "refs/heads/main", next]);
		assert.equal(f.git(f.own, ["rev-parse", "refs/heads/main"]), next);
		writeFileSync(join(f.other, "a"), "other change\n");
		assert.equal(
			f.invoke({ command: `git -C ${f.other} add a` }, { harness: "codex" })
				.decision,
			"deny",
		);
		assert.equal(f.git(f.other, ["diff", "--cached", "--name-only"]), "");
		f.git(f.other, ["add", "a"]);
		assert.equal(f.git(f.other, ["diff", "--cached", "--name-only"]), "a");
		assert.equal(f.git(f.own, ["diff", "--cached", "--name-only"]), "");
	} finally {
		f.cleanup();
	}
});
