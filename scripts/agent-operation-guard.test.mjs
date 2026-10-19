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
			payload: observedPayload,
			processCwd = other,
		} = {},
	) => {
		const payload = observedPayload ?? {
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
				cwd: processCwd,
				env: {
					...env,
					CLAUDE_PROJECT_DIR: harness === "claude" ? own : "",
					...environment,
				},
				input: JSON.stringify(payload),
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

test("entry integration: replay observed Codex managed-outside hook inputs", () => {
	const observed = JSON.parse(
		readFileSync(
			new URL(
				"./lib/__fixtures__/codex-managed-outside-hook-inputs-2026-10-15.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert.deepEqual(
		observed.cases.map(({ name }) => name),
		["read", "create", "remove", "negative"],
	);
	const f = fixture();
	try {
		const environment = Object.fromEntries(
			[
				"CODEX_THREAD_ID",
				"CODEX_SESSION_ID",
				"CODEX_AGENT_ID",
				"CODEX_PARENT_THREAD_ID",
				"CLAUDE_PROJECT_DIR",
			].map((name) => [name, undefined]),
		);
		const invoke = (payload) =>
			f.invoke(undefined, {
				harness: "codex",
				payload,
				environment,
				processCwd: f.own,
			});
		for (const {
			name,
			input,
			environment: capturedEnvironment,
		} of observed.cases) {
			assert.deepEqual(capturedEnvironment, {}, name);
			assert.equal(Object.hasOwn(input, "agent_id"), false, name);
			assert.equal(Object.hasOwn(input, "agent_type"), false, name);
			// Rebind physical roots, preserving the observed schema and relative paths.
			const payload = JSON.parse(
				JSON.stringify(input)
					.replaceAll("/fixture/pfdsl/.worktrees/acceptance", f.own)
					.replaceAll("/fixture/pfdsl", f.primary),
			);
			const result = invoke(payload);
			assert.equal(result.status, 0, `${name}: ${result.out}`);
			assert.equal(
				result.decision,
				name === "negative" ? "deny" : "allow",
				name,
			);
			if (name === "negative") {
				assert.match(
					result.reason,
					/Write only in your assigned linked worktree/,
				);
			}
			if (name === "create" || name === "remove") {
				// Synthetic contrasts: an ignored command or Delete header must not
				// turn an otherwise identical primary-target patch into a read/allow.
				const primaryTarget = {
					...payload,
					tool_input: {
						command: payload.tool_input.command.replaceAll(f.own, f.primary),
					},
				};
				const denied = invoke(primaryTarget);
				assert.equal(denied.status, 0, denied.out);
				assert.equal(denied.decision, "deny", `${name}: primary target`);
				assert.match(
					denied.reason,
					/Write only in your assigned linked worktree/,
				);
			}
		}
	} finally {
		f.cleanup();
	}
});

test("entry integration: replay observed resumed Codex child hook inputs", () => {
	const observed = JSON.parse(
		readFileSync(
			new URL(
				"./lib/__fixtures__/codex-resumed-child-hook-inputs-2026-10-15.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert.deepEqual(
		observed.cases.map(({ name }) => name),
		["create", "read", "update", "remove", "negative"],
	);
	const f = fixture();
	try {
		const environment = Object.fromEntries(
			[
				"CODEX_THREAD_ID",
				"CODEX_SESSION_ID",
				"CODEX_AGENT_ID",
				"CODEX_PARENT_THREAD_ID",
				"CLAUDE_PROJECT_DIR",
			].map((name) => [name, undefined]),
		);
		const inputs = observed.cases.map(
			({ input, environment: capturedEnvironment }) => {
				assert.deepEqual(capturedEnvironment, {});
				assert.notEqual(input.session_id, input.agent_id);
				assert.equal(input.agent_type, "default");
				return JSON.parse(
					JSON.stringify(input)
						.replaceAll("/fixture/codex/worktrees/acceptance/pfdsl", f.own)
						.replaceAll("/fixture/pfdsl", f.primary),
				);
			},
		);
		const invoke = (payload) =>
			f.invoke(undefined, {
				harness: "codex",
				payload,
				environment,
				processCwd: f.primary,
			});
		const missingOwner = invoke(inputs[0]);
		assert.equal(missingOwner.status, 0, missingOwner.out);
		assert.equal(missingOwner.decision, "deny");
		assert.match(missingOwner.reason, /Recovery: parent/);
		const metadata = f.git(f.own, [
			"rev-parse",
			"--git-path",
			"codex-thread.json",
		]);
		writeFileSync(
			metadata,
			JSON.stringify({ version: 1, ownerThreadId: inputs[0].session_id }),
		);
		for (const [index, { name }] of observed.cases.entries()) {
			const result = invoke(inputs[index]);
			assert.equal(result.status, 0, `${name}: ${result.out}`);
			assert.equal(
				result.decision,
				name === "negative" ? "deny" : "allow",
				name,
			);
			if (name === "negative") {
				assert.match(result.reason, /Return this operation to the parent/);
				assert.match(result.reason, /A Codex child/);
			}
		}
		// Synthetic contrasts distinguish child responsibility from target ownership.
		const parentInput = { ...inputs.at(-1) };
		delete parentInput.agent_id;
		delete parentInput.agent_type;
		assert.equal(invoke(parentInput).decision, "allow");
		writeFileSync(
			metadata,
			JSON.stringify({ version: 1, ownerThreadId: inputs[0].agent_id }),
		);
		const childIdIsNotOwner = invoke(inputs[0]);
		assert.equal(childIdIsNotOwner.status, 0, childIdIsNotOwner.out);
		assert.equal(childIdIsNotOwner.decision, "deny");
		assert.match(childIdIsNotOwner.reason, /Recovery: parent/);
	} finally {
		f.cleanup();
	}
});

test("entry integration: replay observed Claude parent, child and live-peer Git inputs", () => {
	const observed = JSON.parse(
		readFileSync(
			new URL(
				"./lib/__fixtures__/claude-native-git-hook-inputs-2026-10-19.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert.deepEqual(
		observed.cases.map(({ name }) => name),
		["parent-own-add", "child-own-add", "parent-peer-cd-add"],
	);
	assert.equal(observed.provenance.claudeCodeVersion, "2.1.299");
	assert.deepEqual(
		observed.cases.map(({ nativeResult }) => nativeResult.isError),
		[false, false, true],
	);
	const f = fixture();
	try {
		const inputs = observed.cases.map(
			({ input, environment, process: capturedProcess }) => {
				assert.equal(input.cwd, observed.nativeEvidence.own.root);
				assert.equal(capturedProcess.cwd, input.cwd);
				assert.equal(
					capturedProcess.parentPid,
					observed.nativeEvidence.own.pid,
				);
				assert.equal(environment.CLAUDE_PROJECT_DIR, "/fixture/pfdsl");
				return JSON.parse(
					JSON.stringify(input)
						.replaceAll(observed.nativeEvidence.own.root, f.own)
						.replaceAll(observed.nativeEvidence.peer.root, f.other)
						.replaceAll("/fixture/pfdsl", f.primary),
				);
			},
		);
		const parentKeys = [
			"cwd",
			"hook_event_name",
			"permission_mode",
			"session_id",
			"tool_input",
			"tool_name",
			"tool_use_id",
			"transcript_path",
		].sort();
		for (const index of [0, 2])
			assert.deepEqual(Object.keys(inputs[index]).sort(), parentKeys);
		assert.deepEqual(
			Object.keys(inputs[1]).sort(),
			[...parentKeys, "agent_id", "agent_type"].sort(),
		);
		assert.equal(typeof inputs[1].agent_id, "string");
		assert.notEqual(inputs[1].agent_id.trim(), "");
		assert.equal(inputs[1].agent_type, "general-purpose");
		assert.notEqual(inputs[1].agent_id, inputs[1].session_id);
		assert.equal(new Set(inputs.map(({ session_id }) => session_id)).size, 1);
		const invoke = (payload) =>
			f.invoke(undefined, {
				payload,
				processCwd: f.own,
				environment: { CLAUDE_PROJECT_DIR: f.primary },
			});
		// Disposable replay: current test processes replace the captured native
		// PID/start. These locks are not additional Desktop acceptance evidence.
		const missingLock = invoke(inputs[0]);
		assert.equal(missingLock.decision, "deny");
		const start = (pid) =>
			run("ps", ["-o", "lstart=", "-p", String(pid)], {
				env: {
					...withoutGitTargetEnvironment(process.env),
					LC_ALL: "C",
					TZ: "UTC",
				},
			}).trim();
		for (const [target, pid, native] of [
			[f.own, process.pid, observed.nativeEvidence.own],
			[f.other, process.ppid, observed.nativeEvidence.peer],
		]) {
			const capturedReason = native.worktreeBlock
				.split("\n")
				.find((line) => line.startsWith("locked "))
				.slice("locked ".length);
			assert.ok(
				capturedReason.includes(`pid ${native.pid} start ${native.start}`),
			);
			f.git(f.own, [
				"worktree",
				"lock",
				"--reason",
				capturedReason.replace(
					`pid ${native.pid} start ${native.start}`,
					`pid ${pid} start ${start(pid)}`,
				),
				target,
			]);
		}
		for (const [index, { name }] of observed.cases.entries()) {
			const result = invoke(inputs[index]);
			assert.equal(result.status, 0, `${name}: ${result.out}`);
			assert.equal(result.decision, index === 2 ? "deny" : "allow", name);
			if (index === 2)
				assert.match(
					result.reason,
					/Write only in your assigned linked worktree/,
				);
		}
		// Removing the qualifying native evidence must revoke the positive replay.
		f.git(f.own, ["worktree", "unlock", f.own]);
		assert.equal(invoke(inputs[1]).decision, "deny");
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
