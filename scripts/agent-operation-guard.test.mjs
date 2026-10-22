import assert from "node:assert/strict";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parserRecoveryCommand } from "./lib/agent-operation-table.mjs";
import { POLICY_DEADLINE_MS } from "./lib/agent-operation-timeouts.mjs";
import { run, tryRun, withoutGitTargetEnvironment } from "./lib/run-exec.mjs";
import { shellParserPath } from "./lib/shell-parser-tool.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const helperFiles = [
	"agent-operation-guard.mjs",
	"setup-shell-parser.mjs",
	"lib/agent-operation-classifier.mjs",
	"lib/agent-operation-input-forms.mjs",
	"lib/agent-operation-option-table.json",
	"lib/agent-operation-unresolved.mjs",
	"lib/agent-operation-table.mjs",
	"lib/agent-operation-policy.mjs",
	"lib/agent-operation-environment.mjs",
	"lib/codex-claude-delegation.mjs",
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
	// A Claude Bash exports CLAUDECODE, which would make every Codex case a delegated child.
	// Delegation cases set it explicitly.
	delete env.CLAUDECODE;
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
			rawInput,
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
				input: rawInput ?? JSON.stringify(payload),
				captureStderr: true,
				// The entry must report its own deadline before this harness gives up.
				timeout: POLICY_DEADLINE_MS + 5000,
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

test("missing origin/HEAD points to setup and leaves setup recovery available", () => {
	const f = fixture();
	try {
		f.git(f.primary, ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"]);
		const denied = f.invoke(
			{ file_path: join(f.root, "scratch.md"), content: "scratch" },
			{ tool_name: "Write" },
		);
		assert.equal(denied.decision, "deny");
		assert.match(denied.reason, /make setup/);
		assert.match(
			denied.reason,
			/existing cloud session.*restart.*fresh clone/i,
		);
		assert.match(
			denied.reason,
			/restarting an old checkout does not update its hooks/i,
		);
		assert.doesNotMatch(denied.reason, /human terminal/);
		// ADR-0047 excludes shell redirects from file-target classification.
		// This difference is observed behavior, not a protected-write guarantee.
		assert.equal(
			f.invoke({ command: `cat > ${join(f.root, "scratch.md")}` }).decision,
			"allow",
		);
		assert.equal(f.invoke({ command: "make setup" }).decision, "allow");
		f.git(f.primary, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
		f.git(f.primary, ["remote", "set-head", "origin", "-a"]);
		assert.equal(
			f.invoke(
				{ file_path: join(f.root, "scratch.md"), content: "scratch" },
				{ tool_name: "Write" },
			).decision,
			"allow",
		);
		assert.equal(
			f.invoke({ command: `cat > ${join(f.root, "scratch.md")}` }).decision,
			"allow",
		);
		assert.equal(
			f.invoke({ command: `git -C ${f.own} commit -m fixture` }).decision,
			"allow",
		);
	} finally {
		f.cleanup();
	}
});

test("GitHub commit and label reads pass the entry for parents and children", () => {
	const f = fixture();
	try {
		for (const harness of ["claude", "codex"])
			for (const agent_id of [undefined, "child"])
				for (const [name, input] of [
					["get_commit", { sha: "HEAD" }],
					["get_commit", { sha: "HEAD", include_diff: true }],
					["get_label", { name: "bug" }],
				]) {
					const result = f.invoke(
						{ owner: "fixture", repo: "repo", ...input },
						{
							harness,
							agent_id,
							tool_name: `mcp__github__${name}`,
							cwd: f.primary,
						},
					);
					assert.equal(
						result.decision,
						"allow",
						`${harness} ${name}: ${result.reason}`,
					);
				}
	} finally {
		f.cleanup();
	}
});

test("current GitHub issue_write capability keeps parent and child outward-write boundaries", () => {
	const f = fixture();
	try {
		const input = {
			method: "create",
			owner: "fixture",
			repo: "repo",
			title: "Fixture",
		};
		const options = { tool_name: "mcp__github__issue_write", harness: "codex" };
		assert.equal(f.invoke(input, options).decision, "allow");
		const child = f.invoke(input, { ...options, agent_id: "child" });
		assert.equal(child.decision, "deny");
		assert.match(child.reason, /parent/i);
	} finally {
		f.cleanup();
	}
});

test("Codex tag lookup passes the hook entry without permitting tag pushes or custom upload programs", () => {
	const f = fixture();
	try {
		const options = { harness: "codex", tool_name: "exec_command" };
		const command = `git -C ${f.other} ls-remote --tags origin refs/tags/v0.2.0`;
		assert.equal(
			f.invoke({ cmd: command, workdir: f.other }, options).decision,
			"allow",
		);
		// Execute against the local fixture remote, with no network or ref writes.
		assert.equal(
			f.git(f.other, ["ls-remote", "--tags", "origin", "refs/tags/v0.2.0"]),
			"",
		);
		for (const cmd of [
			`git -C ${f.own} push --tags origin`,
			`git -C ${f.other} ls-remote --tags --upload-pack=/tmp/program origin`,
		])
			assert.equal(
				f.invoke({ cmd, workdir: f.other }, options).decision,
				"deny",
			);
	} finally {
		f.cleanup();
	}
});

test("primary fast-forward preparation passes the hook entry while unsafe variants remain denied", () => {
	const f = fixture();
	try {
		f.git(f.primary, ["fetch", "origin", "main:refs/remotes/origin/main"]);
		f.git(f.primary, ["branch", "--set-upstream-to=origin/main", "main"]);
		const command = `git -C ${f.primary} pull --ff-only --no-autostash origin main`;
		const options = { harness: "codex", cwd: f.primary };
		assert.equal(f.invoke({ command }, options).decision, "allow");
		assert.equal(
			f.invoke({ command }, { ...options, agent_id: "child" }).decision,
			"deny",
		);
		assert.equal(
			f.invoke({ command: `git -C ${f.primary} add a` }, options).decision,
			"deny",
		);
		writeFileSync(join(f.primary, "untracked"), "keep");
		assert.equal(f.invoke({ command }, options).decision, "deny");
	} finally {
		f.cleanup();
	}
});

test("delegated Codex entry keeps child restrictions when the fixed chain is missing", () => {
	const f = fixture();
	try {
		const options = { harness: "codex", environment: { CLAUDECODE: "1" } };
		for (const command of [
			`git -C ${f.own} add a`,
			"gh issue comment 1 --body x",
		])
			assert.equal(f.invoke({ command }, options).decision, "deny");
		assert.equal(
			f.invoke({ command: "git status" }, options).decision,
			"allow",
		);
		assert.equal(
			f.invoke(
				{ file_path: join(f.own, "a"), content: "x" },
				{ ...options, tool_name: "Write" },
			).decision,
			"deny",
		);
		rmSync(shellParserPath(f.own));
		const repair = parserRecoveryCommand(f.own);
		assert.equal(f.invoke({ command: repair }, options).decision, "deny");
	} finally {
		f.cleanup();
	}
});

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

test("entry integration: U recording is private and the aggregate CLI reads the common directory", () => {
	const f = fixture();
	try {
		const log = join(f.primary, ".git/pfdsl/agent-operation-unresolved.jsonl");
		assert.equal(f.invoke({ command: "git status" }).decision, "allow");
		assert.equal(existsSync(log), false);
		assert.equal(
			f.invoke({
				command: "gh api --not-declared=/fixture/private repos/o/r/issues",
			}).decision,
			"deny",
		);
		const text = readFileSync(log, "utf8");
		assert.doesNotMatch(text, /fixture|private|"command"/);
		assert.deepEqual(JSON.parse(text).unknownOptions, ["--not-declared"]);
		const summary = JSON.parse(
			run(
				process.execPath,
				[join(source, "scripts/agent-operation-unresolved-report.mjs")],
				{ cwd: f.own },
			),
		);
		assert.equal(summary.total, 1);
		assert.deepEqual(summary.options, { "--not-declared": 1 });
	} finally {
		f.cleanup();
	}
});

test("entry integration: Codex subdirectory origins keep ownership and explicit destinations separate", () => {
	const f = fixture();
	try {
		const cwd = join(f.own, "packages/app");
		mkdirSync(cwd, { recursive: true });
		for (const [destination, expected] of [
			[f.own, "allow"],
			[f.primary, "deny"],
			[f.other, "deny"],
		]) {
			const result = f.invoke(
				{ cmd: `git -C ${destination} add a.txt` },
				{ harness: "codex", tool_name: "exec_command", cwd },
			);
			assert.equal(result.decision, expected);
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
		assert.match(denied.reason, /After.*make setup/);
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
			f.invoke({ command: "make setup" }, { harness: "codex" }).decision,
			"allow",
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

test("Claude native owner can fast-forward a feature worktree while a primary startup stays protected", () => {
	const f = fixture();
	try {
		const start = run("ps", ["-o", "lstart=", "-p", String(process.pid)], {
			env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
		}).trim();
		f.git(f.primary, [
			"worktree",
			"lock",
			"--reason",
			`claude session own (pid ${process.pid} start ${start})`,
			f.own,
		]);
		writeFileSync(join(f.primary, "a"), "fetched update\n");
		f.git(f.primary, ["add", "a"]);
		f.git(f.primary, ["commit", "-m", "upstream"]);
		f.git(f.own, ["fetch", "origin", "main"]);
		const options = { environment: { CLAUDE_PROJECT_DIR: f.primary } };
		const command = `git -C ${f.own} merge --ff-only origin/main`;
		assert.equal(f.invoke({ command }, options).decision, "allow");
		f.git(f.own, ["merge", "--ff-only", "origin/main"]);
		assert.equal(
			f.git(f.own, ["rev-parse", "HEAD"]),
			f.git(f.primary, ["rev-parse", "HEAD"]),
		);
		assert.equal(f.git(f.own, ["branch", "--show-current"]), "feat/own");
		const primary = f.invoke(
			{ command: `git -C ${f.primary} merge --ff-only origin/main` },
			options,
		);
		assert.equal(primary.decision, "deny");
		assert.match(primary.reason, /Recovery: same agent rewrite/);
		assert.match(primary.reason, /fresh session/);
		writeFileSync(join(f.own, "topic"), "topic\n");
		f.git(f.own, ["add", "topic"]);
		f.git(f.own, ["commit", "-m", "topic"]);
		writeFileSync(join(f.primary, "a"), "divergent update\n");
		f.git(f.primary, ["add", "a"]);
		f.git(f.primary, ["commit", "-m", "later upstream"]);
		f.git(f.own, ["fetch", "origin", "main"]);
		const before = f.git(f.own, ["rev-parse", "HEAD"]);
		assert.equal(f.invoke({ command }, options).decision, "allow");
		const refused = tryRun("git", ["merge", "--ff-only", "origin/main"], {
			cwd: f.own,
			env: withoutGitTargetEnvironment(process.env),
			captureStderr: true,
		});
		assert.equal(refused.ok, false);
		assert.equal(f.git(f.own, ["rev-parse", "HEAD"]), before);
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

test("entry integration: probe failures deny with bounded evidence and read-only investigation guidance", () => {
	for (const [detail, expected] of [
		[
			"Git policy probe budget exhausted",
			/Git safety checks did not finish within their time budget/,
		],
		[
			"Git policy probe could not execute within its budget",
			/cause is not established/,
		],
		["fixture unknown observation failure", /cause is not established/],
	]) {
		const f = fixture();
		try {
			writeFileSync(
				join(f.own, "scripts/lib/guard-probe.mjs"),
				`export function createGuardProbe() { return () => { throw new Error(${JSON.stringify(detail)}); }; }\n`,
			);
			const result = f.invoke(
				{ command: `git -C ${f.own} add a` },
				{ harness: "codex" },
			);
			assert.equal(result.status, 2);
			assert.equal(result.decision, "deny");
			assert.ok(result.reason.includes(detail));
			assert.match(result.reason, expected);
			assert.match(
				result.reason,
				/operation was denied because safety verification is incomplete/,
			);
			assert.match(result.reason, /read-only/);
			assert.doesNotMatch(result.reason, /human terminal|Repair the hook/);
		} finally {
			f.cleanup();
		}
	}
});

test("entry integration: a policy-load deadline returns recovery to a human without blaming received input", () => {
	const f = fixture();
	try {
		writeFileSync(
			join(f.own, "scripts/lib/policy-supervisor.mjs"),
			"await new Promise(() => {});\nexport async function supervisePolicy() {}\n",
		);
		const result = f.invoke({ command: "git status" });
		assert.equal(result.status, 2);
		assert.equal(result.decision, "deny");
		assert.match(
			result.reason,
			/Policy components did not finish loading within the time limit/,
		);
		assert.match(result.reason, /read-only/);
		assert.match(result.reason, /human terminal/);
		assert.match(result.reason, /guarded tools cannot repair/);
		assert.doesNotMatch(
			result.reason,
			/input was not received|caller|could not be loaded/,
		);
	} finally {
		f.cleanup();
	}
});

test("entry integration: a stalled worker helper returns unknown deadline recovery to a human", () => {
	const f = fixture();
	try {
		writeFileSync(
			join(f.own, "scripts/lib/hook-io.mjs"),
			"await new Promise(() => {});\n",
		);
		const result = f.invoke({ command: "git status" });
		assert.equal(result.status, 2);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /time limit/);
		assert.match(result.reason, /cause is not established/);
		assert.match(result.reason, /human terminal/);
		assert.match(result.reason, /read-only/);
		assert.doesNotMatch(
			result.reason,
			/Policy components could not be loaded|input was not received|Repair the hook/,
		);
	} finally {
		f.cleanup();
	}
});

test("entry integration: invalid input points to caller payload inspection", () => {
	const f = fixture();
	try {
		for (const rawInput of [
			"{bad",
			JSON.stringify({ tool_name: "Bash", tool_input: {} }),
		]) {
			const result = f.invoke({}, { rawInput });
			assert.equal(result.status, 2);
			assert.equal(result.decision, "deny");
			assert.match(result.reason, /[Hh]ook input/);
			assert.match(result.reason, /caller|payload/);
			assert.doesNotMatch(result.reason, /human terminal|Repair the hook/);
		}
	} finally {
		f.cleanup();
	}
});

test("entry integration: missing policy and supervisor return loading failures to a human", () => {
	const f = fixture();
	try {
		rmSync(join(f.own, "scripts/lib/agent-operation-table.mjs"));
		const failed = f.invoke({ command: "git status" });
		assert.equal(failed.status, 2);
		assert.equal(failed.decision, "deny");
		assert.match(failed.reason, /Policy components could not be loaded/);
		assert.match(failed.reason, /read-only/);
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
		assert.match(bootstrap.reason, /Policy components could not be loaded/);
		assert.match(bootstrap.reason, /human terminal/);
	} finally {
		f.cleanup();
	}
});

test("entry integration: corrupt policy and supervisor return loading failures to a human", () => {
	const f = fixture();
	try {
		for (const relative of [
			"agent-operation-table.mjs",
			"policy-supervisor.mjs",
		]) {
			writeFileSync(join(f.own, "scripts/lib", relative), "export const = ;\n");
			const result = f.invoke({ command: "git status" });
			assert.equal(result.status, 2);
			assert.equal(result.decision, "deny");
			assert.match(result.reason, /Policy components could not be loaded/);
			assert.match(result.reason, /read-only/);
			assert.match(result.reason, /human terminal/);
		}
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
