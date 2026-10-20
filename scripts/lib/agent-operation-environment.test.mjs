import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { collectAgentOperationEnvironment } from "./agent-operation-environment.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { GIT_TARGET_ENVIRONMENT_VARIABLES } from "./git-environment.mjs";
import { readShell } from "./shell-commands.mjs";

test("read-only calls do not observe repository roots, worktrees or native ownership", () => {
	const noObservation = () => {
		throw new Error("read-only observation must be skipped");
	};
	for (const command of [
		"git status",
		"git reflog show",
		"git tag -l",
		"bash -c 'git rev-list --count HEAD'",
		"git diff; git log -1",
	]) {
		const payload = {
			tool_name: "Bash",
			cwd: "/fixture/own",
			tool_input: { command },
		};
		const facts = collectAgentOperationEnvironment(payload, {
			hookRoot: "/fixture/own",
			environment: {},
			shell: readShell(command),
			probeGit: noObservation,
			probeProcess: noObservation,
			readMetadata: noObservation,
		});
		assert.deepEqual(facts.worktrees, []);
		assert.equal(
			evaluateAgentOperationPolicy(payload, facts).decision,
			"allow",
			command,
		);
	}
});

test("each inherited Git target variable makes mutations unresolved without weakening bypass denial", () => {
	for (const variable of GIT_TARGET_ENVIRONMENT_VARIABLES) {
		const payload = {
			tool_name: "Bash",
			cwd: "/fixture/own",
			tool_input: { command: "git -C /fixture/own add a" },
		};
		const facts = collectAgentOperationEnvironment(payload, {
			hookRoot: "/fixture/own",
			environment: { [variable]: "/fixture/primary" },
			shell: readShell(payload.tool_input.command),
		});
		const result = evaluateAgentOperationPolicy(payload, facts);
		assert.equal(facts.gitTargetOverride, true, variable);
		assert.equal(
			classifyAgentOperations(payload, facts).operations[0].target,
			"unresolved",
			variable,
		);
		assert.equal(result.decision, "deny", variable);
		assert.equal(result.recovery, "rewrite", variable);
		const bypass = {
			...payload,
			tool_input: { command: "git -C /fixture/own commit --no-verify -m x" },
		};
		assert.equal(
			evaluateAgentOperationPolicy(bypass, {
				...facts,
				shell: readShell(bypass.tool_input.command),
			}).operationClass,
			"X",
			variable,
		);
	}
});

function fixture({ nativeLock = true, extraLocks = {} } = {}) {
	const root = mkdtempSync(
		fileURLToPath(new URL("../../node_modules/pfdsl-facts-", import.meta.url)),
	);
	const roots = Object.fromEntries(
		["primary", "own", "live", "native", "unowned", "foreign"].map((name) => [
			name,
			join(root, name),
		]),
	);
	for (const path of Object.values(roots)) mkdirSync(path);
	mkdirSync(join(roots.primary, "sub"));
	writeFileSync(join(roots.primary, "a"), "a");
	symlinkSync(join(roots.primary, "sub"), join(roots.own, "link"));
	symlinkSync(join(roots.primary, "a"), join(roots.own, "file-link"));
	const commonDir = join(roots.primary, ".git");
	const start = "Mon Oct 12 00:00:00 2026";
	const locks = {
		live: 456,
		...(nativeLock ? { native: 123 } : {}),
		...extraLocks,
	};
	const listing = Object.entries(roots)
		.filter(([name]) => name !== "foreign")
		.map(
			([name, path]) =>
				`worktree ${path}\0branch refs/heads/${name === "primary" ? "main" : `feat/${name}`}\0${locks[name] ? `locked claude session ${name} (pid ${locks[name]} start ${start})\0` : ""}\0`,
		)
		.join("");
	const seen = [];
	const probeGit = (args, options) => {
		seen.push({ args, options });
		const target = Object.values(roots).find(
			(path) => options.cwd === path || options.cwd.startsWith(`${path}/`),
		);
		const ok = (out) => ({ ok: true, status: 0, out });
		if (args.includes("--show-toplevel"))
			return target
				? ok(target)
				: { ok: false, status: 128, out: "not a git repository" };
		if (args.includes("--git-common-dir"))
			return ok(target === roots.foreign ? join(target, ".git") : commonDir);
		if (args.includes("--git-path"))
			return ok(
				join(
					commonDir,
					"worktrees",
					target?.split("/").at(-1),
					"codex-thread.json",
				),
			);
		if (args.includes("--absolute-git-dir"))
			return ok(join(commonDir, "worktrees", target?.split("/").at(-1)));
		if (args[0] === "worktree") return ok(listing);
		if (args[0] === "symbolic-ref") return ok("origin/main\n");
		throw new Error(`unexpected observation ${JSON.stringify(args)}`);
	};
	const probeProcess = () => ({ ok: true, status: 0, out: start });
	const readMetadata = (path) =>
		JSON.stringify({
			version: 1,
			ownerThreadId: path.includes("/native/") ? "session" : "other",
		});
	return {
		root,
		roots,
		commonDir,
		seen,
		probeGit,
		probeProcess,
		readMetadata,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("a subdirectory origin observes its containing worktree root without changing explicit targets", () => {
	const f = fixture({ nativeLock: false });
	try {
		for (const [origin, destination, expected] of [
			[f.roots.own, f.roots.own, "allow"],
			[f.roots.own, f.roots.primary, "deny"],
			[f.roots.primary, f.roots.primary, "deny"],
			[f.roots.live, f.roots.live, "deny"],
		]) {
			const cwd = join(origin, "packages/app");
			mkdirSync(cwd, { recursive: true });
			const payload = {
				tool_name: "exec_command",
				cwd,
				session_id: "session",
				tool_input: { cmd: `git -C ${destination} add a.txt` },
			};
			const facts = collectAgentOperationEnvironment(payload, {
				hookRoot: f.root,
				environment: {},
				shell: readShell(payload.tool_input.cmd),
				probeGit: f.probeGit,
				probeProcess: f.probeProcess,
				readMetadata: f.readMetadata,
			});
			assert.equal(facts.sessionRoot, origin);
			assert.equal(
				evaluateAgentOperationPolicy(payload, facts).decision,
				expected,
			);
			assert.equal(
				classifyAgentOperations(payload, facts).operations[0].executionPath,
				destination,
			);
		}
	} finally {
		f.cleanup();
	}
});

test("environment observations preserve session origin, physical targets, branch occupancy and live native evidence", () => {
	const f = fixture();
	try {
		const payload = {
			tool_name: "Write",
			cwd: f.roots.own,
			session_id: "session",
			tool_input: { file_path: `${f.roots.own}/link/../a`, content: "x" },
		};
		const facts = collectAgentOperationEnvironment(payload, {
			hookRoot: f.root,
			environment: { CLAUDE_PROJECT_DIR: f.roots.own, GIT_DIR: "/unobserved" },
			parentPid: 123,
			probeGit: f.probeGit,
			probeProcess: f.probeProcess,
			readMetadata: f.readMetadata,
		});
		assert.equal(facts.sessionRoot, f.roots.own);
		assert.equal(facts.commonDir, f.commonDir);
		assert.ok(facts.gitMetadataPaths.includes(f.commonDir));
		assert.equal(facts.defaultBranch, "main");
		assert.equal(facts.branches["feat/live"].checkedOutAt, f.roots.live);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.primary).primary,
			true,
		);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.live).ownership.live,
			true,
		);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.native).ownership
				.ownerId,
			"session",
		);
		const operation = classifyAgentOperations(payload, facts).operations[0];
		assert.equal(operation.target, "primary");
		assert.equal(operation.executionPath, join(f.roots.primary, "a"));
		assert.ok(f.seen.every(({ options }) => options.env.GIT_DIR === undefined));
	} finally {
		f.cleanup();
	}
});

test("Codex observes native identity separately from cwd and ignores the unobserved workdir", () => {
	const f = fixture({ nativeLock: false });
	try {
		const payload = {
			tool_name: "exec_command",
			cwd: f.roots.own,
			session_id: "session",
			tool_input: {
				cmd: `git -C ${f.roots.native} add a`,
				workdir: f.roots.primary,
			},
		};
		const shell = readShell(payload.tool_input.cmd);
		const facts = collectAgentOperationEnvironment(payload, {
			hookRoot: f.root,
			shell,
			environment: {},
			parentPid: 999,
			probeGit: f.probeGit,
			probeProcess: f.probeProcess,
			readMetadata: f.readMetadata,
		});
		assert.equal(facts.sessionRoot, f.roots.own);
		const operation = classifyAgentOperations(payload, facts).operations[0];
		assert.equal(operation.target, "own");
		assert.equal(operation.executionPath, f.roots.native);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.unowned).ownership
				.ownerId,
			"other",
		);
		assert.equal(
			facts.worktrees.find(({ root }) => root === f.roots.unowned).ownership
				.live,
			false,
		);
	} finally {
		f.cleanup();
	}
});

test("GitHub capabilities have no checkout and unknown capabilities remain unresolved", () => {
	const payload = {
		tool_name: "mcp__plugin_github_github__merge_pull_request",
		tool_input: {},
	};
	const facts = collectAgentOperationEnvironment(payload, {
		hookRoot: "/fixture/hook",
		environment: {},
		probeGit: () => {
			throw new Error("remote operation must not probe a checkout");
		},
	});
	assert.deepEqual(
		classifyAgentOperations(payload, facts).operations[0].classes,
		["O", "P"],
	);
	assert.deepEqual(
		classifyAgentOperations(
			{ ...payload, tool_name: "mcp__github__future_operation" },
			facts,
		).operations[0].classes,
		["U"],
	);
});

test("patch deletion observes its own directory entry rather than the symlink's foreign contents", () => {
	const f = fixture();
	try {
		const path = join(f.roots.own, "file-link");
		const payload = {
			tool_name: "apply_patch",
			cwd: f.roots.own,
			session_id: "session",
			agent_id: "child",
			tool_input: {
				command: `*** Begin Patch\n*** Delete File: ${path}\n*** End Patch`,
			},
		};
		const facts = collectAgentOperationEnvironment(payload, {
			hookRoot: f.root,
			environment: {},
			probeGit: f.probeGit,
			probeProcess: f.probeProcess,
			readMetadata: f.readMetadata,
		});
		const operation = classifyAgentOperations(payload, facts).operations[0];
		assert.equal(operation.target, "own");
		assert.equal(operation.executionPath, path);
		assert.equal(facts.physicalEntryPaths[path], path);
		assert.equal(facts.physicalPaths[path], undefined);
	} finally {
		f.cleanup();
	}
});

function delegatedFacts(
	f,
	payload,
	{
		connected = true,
		ownerPid = 123,
		start = "Mon Oct 12 00:00:00 2026",
		ownerStart = start,
	} = {},
) {
	return collectAgentOperationEnvironment(payload, {
		hookRoot: f.root,
		environment: { CLAUDECODE: "1" },
		parentPid: 10,
		shell: payload.tool_input?.command
			? readShell(payload.tool_input.command)
			: undefined,
		probeGit: f.probeGit,
		probeProcess: (_command, args) => {
			if (args[1] === "lstart=") return { ok: connected, out: start };
			const rows = {
				10: "10 20 Mon Oct 12 00:00:01 2026 /Applications/codex",
				20: `20 ${ownerPid} Mon Oct 12 00:00:01 2026 /bin/zsh`,
				[ownerPid]: `${ownerPid} 1 ${ownerStart} /Applications/Claude Code/claude`,
			};
			return { ok: connected, out: rows[args.at(-1)] ?? "" };
		},
		readMetadata: f.readMetadata,
	});
}

test("Claude-delegated Codex is a child without agent_id and may patch only its live owner's tree", () => {
	const f = fixture();
	try {
		for (const [target, expected] of [
			["native", "allow"],
			["live", "deny"],
			["unowned", "deny"],
			["primary", "deny"],
			["foreign", "deny"],
		]) {
			const payload = {
				tool_name: "apply_patch",
				cwd: f.roots.native,
				session_id: "session",
				tool_input: {
					command: `*** Begin Patch\n*** Add File: ${f.roots[target]}/new.txt\n+hello\n*** End Patch`,
				},
			};
			const facts = delegatedFacts(f, payload);
			assert.equal(
				classifyAgentOperations(payload, facts).subject,
				"codex-child",
			);
			assert.equal(
				evaluateAgentOperationPolicy(payload, facts).decision,
				expected,
				target,
			);
		}
	} finally {
		f.cleanup();
	}
});

test("delegation never authorizes Git metadata, Git mutation, remote writes, wrappers or mixed calls", () => {
	const f = fixture();
	try {
		for (const command of [
			`git -C ${f.roots.native} add a`,
			`git -C ${f.roots.native} commit -m x`,
			`git -C ${f.roots.native} push origin HEAD`,
			`git -C ${f.roots.native} config user.name x`,
			`git -C ${f.roots.native} branch topic`,
			`git -C ${f.roots.native} status && gh issue comment 1 --body x`,
			"gh pr create --title x --body x",
			`node /fixture/.codex/bin/codex-git-routine.mjs commit ${f.roots.native} topic x`,
		]) {
			const payload = {
				tool_name: "Bash",
				cwd: f.roots.native,
				session_id: "session",
				tool_input: { command },
			};
			const facts = delegatedFacts(f, payload);
			assert.equal(
				classifyAgentOperations(payload, facts).subject,
				"codex-child",
			);
			assert.equal(
				evaluateAgentOperationPolicy(payload, facts).decision,
				"deny",
				command,
			);
		}
		for (const payload of [
			{ tool_name: "mcp__github__create_issue", tool_input: {} },
			{
				tool_name: "apply_patch",
				cwd: f.roots.native,
				tool_input: {
					command: `*** Begin Patch\n*** Add File: ${f.commonDir}/new-metadata\n+x\n*** End Patch`,
				},
			},
			{
				tool_name: "Write",
				cwd: f.roots.native,
				tool_input: { file_path: `${f.commonDir}/config`, content: "x" },
			},
		]) {
			const facts = delegatedFacts(f, payload);
			assert.equal(
				classifyAgentOperations(payload, facts).subject,
				"codex-child",
			);
			assert.equal(
				evaluateAgentOperationPolicy(payload, facts).decision,
				"deny",
			);
		}
	} finally {
		f.cleanup();
	}
});

test("missing chain, wrong owner, PID reuse and missing lock deny file writes without parent fallback", () => {
	for (const [fixtureOptions, options] of [
		[{}, { connected: false }],
		[{}, { ownerPid: 999 }],
		[{}, { start: "Mon Oct 12 01:00:00 2026" }],
		[{ nativeLock: false }, {}],
	]) {
		const f = fixture(fixtureOptions);
		try {
			const payload = {
				tool_name: "Write",
				cwd: f.roots.native,
				session_id: "session",
				tool_input: { file_path: `${f.roots.native}/a`, content: "x" },
			};
			const facts = delegatedFacts(f, payload, options);
			assert.equal(
				classifyAgentOperations(payload, facts).subject,
				"codex-child",
			);
			assert.equal(
				evaluateAgentOperationPolicy(payload, facts).decision,
				"deny",
			);
		} finally {
			f.cleanup();
		}
	}
});

test("a live owner lock is not enough: the chain's Claude start and the session worktree must match", () => {
	for (const [fixtureOptions, options, expected] of [
		// The chain's Claude and the lock's ps disagree on the start of the same PID.
		[{}, { ownerStart: "Mon Oct 12 01:00:00 2026" }, { native: "deny" }],
		// The delegating Claude also owns a worktree outside this session.
		[{ extraLocks: { own: 123 } }, {}, { native: "allow", own: "deny" }],
	]) {
		const f = fixture(fixtureOptions);
		try {
			for (const [target, decision] of Object.entries(expected)) {
				const payload = {
					tool_name: "Write",
					cwd: f.roots.native,
					session_id: "session",
					tool_input: { file_path: `${f.roots[target]}/a`, content: "x" },
				};
				assert.equal(
					evaluateAgentOperationPolicy(
						payload,
						delegatedFacts(f, payload, options),
					).decision,
					decision,
					target,
				);
			}
		} finally {
			f.cleanup();
		}
	}
});

test("a lost delegation still permits reads without inspecting native ownership", () => {
	const payload = {
		tool_name: "Bash",
		cwd: "/no/repo",
		tool_input: { command: "git status" },
	};
	const facts = collectAgentOperationEnvironment(payload, {
		environment: { CLAUDECODE: "1" },
		parentPid: 10,
		shell: readShell("git status"),
		probeProcess: () => ({ ok: false, out: "" }),
		probeGit: () => {
			throw new Error("read must not probe Git");
		},
	});
	assert.equal(classifyAgentOperations(payload, facts).subject, "codex-child");
	assert.equal(evaluateAgentOperationPolicy(payload, facts).decision, "allow");
});
