import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	classifyGitCommand,
	classifyTargetRepository,
	evaluateMainCommitGuard,
	resolveCommandCwd,
	runMainCommitGuard,
} from "./main-commit-guard.mjs";

function payload({ toolName = "Bash", command, cwd }) {
	const value = {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { command },
	};
	if (cwd !== undefined) value.cwd = cwd;
	return value;
}

it("resolves attached literal -C targets without consuming other option values", () => {
	for (const [command, cwd, decision] of [
		["git -C/fixture/main commit -m x", "/fixture/topic", "deny"],
		["git -C/fixture/topic commit -m x", "/fixture/main", "allow"],
		["git -C '' commit -m x", "/fixture/topic", "allow"],
		["git --namespace -C/fixture/topic commit -m x", "/fixture/main", "deny"],
	]) {
		const result = runMainCommitGuard(
			JSON.stringify(payload({ command, cwd })),
			{
				supportsAsk: false,
				resolveBranches: (_, target) => ({
					currentBranch: target === "/fixture/main" ? "main" : "topic",
					mainBranch: "main",
					targetRelation: "own",
				}),
			},
		);
		assert.equal(
			result.output?.hookSpecificOutput.permissionDecision ?? "allow",
			decision,
			command,
		);
	}
});

it("resolves symlink/.. targets in filesystem order for Git and env chdir", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "pfdsl-git-path-")));
	try {
		const main = join(root, "main"),
			own = join(root, "own");
		mkdirSync(join(main, "dir"), { recursive: true });
		mkdirSync(own);
		symlinkSync(join(main, "dir"), join(own, "alias"));
		const target = `${own}/alias/..`;
		assert.equal(
			execFileSync("pwd", ["-P"], { cwd: target, encoding: "utf8" }).trim(),
			main,
		);
		for (const command of [
			`git -C ${target} commit -m x`,
			`git -C${target} commit -m x`,
			`env -C ${target} git commit -m x`,
		]) {
			const result = runMainCommitGuard(
				JSON.stringify(payload({ command, cwd: own })),
				{
					supportsAsk: false,
					resolveBranches: (_, path) => ({
						currentBranch: path === main ? "main" : "topic",
						mainBranch: "main",
						targetRelation: "own",
					}),
				},
			);
			assert.equal(
				result.output?.hookSpecificOutput.permissionDecision,
				"deny",
				command,
			);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("classifyGitCommand", () => {
	it("denies subcommands that create new state on the branch", () => {
		for (const sub of ["commit", "add", "rm", "mv", "apply", "am"]) {
			assert.deepEqual(
				classifyGitCommand(`git ${sub} x`),
				{ subcommand: sub, decision: "deny" },
				sub,
			);
		}
	});

	it("asks for subcommands that destroy or restore existing state (#777)", () => {
		for (const sub of [
			"reset",
			"restore",
			"checkout",
			"switch",
			"stash",
			"clean",
			"merge",
			"rebase",
			"cherry-pick",
			"revert",
		]) {
			assert.deepEqual(
				classifyGitCommand(`git ${sub} x`),
				{
					subcommand: sub,
					decision: "ask",
					...(["checkout", "switch"].includes(sub)
						? { effect: { kind: "enter-branch", ref: "x" } }
						: {}),
				},
				sub,
			);
		}
	});

	it("classifies a subcommand behind global git flags", () => {
		assert.deepEqual(classifyGitCommand("git -C /repo commit -m 'x'"), {
			subcommand: "commit",
			decision: "deny",
		});
	});

	it("does not read --attr-source's value as the subcommand (#1232)", () => {
		// --attr-source takes a separate value the way -C does; before
		// GIT_GLOBAL_FLAGS_WITH_VALUE knew that, gitSubcommandIndex misread
		// "HEAD" as the subcommand and this whole command went unclassified.
		assert.deepEqual(classifyGitCommand("git --attr-source HEAD commit -m x"), {
			subcommand: "commit",
			decision: "deny",
		});
	});

	it("classifies quoted executables and subcommands as the argv Git receives", () => {
		for (const command of ['git "add" -A', '"git" commit -m x']) {
			assert.deepEqual(
				classifyGitCommand(command),
				{
					subcommand: command.includes("add") ? "add" : "commit",
					decision: "deny",
				},
				command,
			);
		}
	});

	it("classifies Git behind executable shell prefixes with options", () => {
		for (const command of [
			"env -i git add -A",
			"env -- git commit -m x",
			"/usr/bin/git add -A",
			"/usr/bin/env -P /usr/bin /usr/bin/git add -A",
		]) {
			assert.deepEqual(
				classifyGitCommand(command),
				{
					subcommand: command.includes("add") ? "add" : "commit",
					decision: "deny",
				},
				command,
			);
		}
	});

	it("classifies the targeted Codex routine wrapper as its Git mutation", () => {
		for (const [command, subcommand] of [
			[
				"/opt/codex/bin/codex-git-routine.mjs stage-all /repo/worktree topic",
				"add",
			],
			[
				"/opt/codex/bin/codex-git-routine.mjs commit /repo/worktree topic message",
				"commit",
			],
			[
				"/opt/codex/bin/codex-git-routine.mjs branch-rename /repo/worktree old new",
				"branch",
			],
		]) {
			assert.deepEqual(
				classifyGitCommand(command),
				{ subcommand, decision: "deny" },
				command,
			);
		}
	});

	it("classifies the node-launched Codex routine wrapper the same way", () => {
		for (const [command, subcommand] of [
			[
				"node /opt/codex/bin/codex-git-routine.mjs stage-all /repo/worktree topic",
				"add",
			],
			[
				"/usr/bin/node /opt/codex/bin/codex-git-routine.mjs commit /repo/worktree topic message",
				"commit",
			],
			[
				"node --no-warnings /opt/codex/bin/codex-git-routine.mjs stage-all /repo/worktree topic",
				"add",
			],
			[
				"node -- /opt/codex/bin/codex-git-routine.mjs commit /repo/worktree topic message",
				"commit",
			],
			[
				"node /opt/codex/bin/codex-git-routine.mjs branch-rename /repo/worktree old new",
				"branch",
			],
		]) {
			assert.deepEqual(
				classifyGitCommand(command),
				{ subcommand, decision: "deny" },
				command,
			);
		}
	});

	it("leaves routine verbs and node scripts that are not Git mutations unclassified", () => {
		for (const command of [
			"/opt/codex/bin/codex-git-routine.mjs test /repo/worktree topic",
			"node /opt/codex/bin/codex-git-routine.mjs node-test /repo/worktree topic a.test.mjs",
			"node /opt/codex/bin/other-script.mjs commit /repo/worktree topic message",
			"node scripts/check.mjs stage-all",
		])
			assert.equal(classifyGitCommand(command), null, command);
	});

	it("prefers the denied subcommand over an asked one in a compound", () => {
		assert.deepEqual(classifyGitCommand("git checkout main && git add -A"), {
			subcommand: "add",
			decision: "deny",
		});
	});

	it("leaves read-only git commands alone", () => {
		assert.equal(classifyGitCommand("git status --short"), null);
		assert.equal(classifyGitCommand("git log --oneline -5"), null);
		assert.equal(classifyGitCommand("git fetch origin"), null);
		assert.deepEqual(classifyGitCommand("git worktree add ../w -b topic"), {
			subcommand: "worktree",
			decision: "ask",
			effect: { kind: "shared" },
		});
	});

	it("leaves the read-only stash forms alone, since they diagnose a loss", () => {
		assert.equal(classifyGitCommand("git stash list"), null);
		assert.equal(classifyGitCommand("git stash show -p"), null);
	});

	it("leaves the read-only apply forms alone, since they only report", () => {
		assert.equal(classifyGitCommand("git apply --check patch.diff"), null);
		assert.equal(classifyGitCommand("git apply --stat patch.diff"), null);
	});

	it("still denies an apply that writes", () => {
		assert.deepEqual(classifyGitCommand("git apply patch.diff"), {
			subcommand: "apply",
			decision: "deny",
		});
	});

	it("treats a bare `git stash` as the push it is", () => {
		assert.deepEqual(classifyGitCommand("git stash"), {
			subcommand: "stash",
			decision: "ask",
		});
	});

	it("does not classify a subcommand inside a quoted string", () => {
		assert.equal(classifyGitCommand('echo "git commit"'), null);
		assert.equal(classifyGitCommand("echo 'git add -A'"), null);
	});

	it("does not classify a subcommand appearing as a flag value", () => {
		assert.equal(classifyGitCommand("git log --grep commit"), null);
	});

	it("ignores a non-string command", () => {
		assert.equal(classifyGitCommand(undefined), null);
	});
});

describe("classifyGitCommand bypass detection (#1232)", () => {
	it("denies every form that skips the pre-commit checks", () => {
		for (const command of [
			"git -c core.hooksPath=/nonexistent commit -m x",
			"git commit --no-verify -m x",
			"git commit -nm x",
			"git commit --no-veri -m x",
			"git push --no-verify",
			"git -c CORE.HOOKSPATH=x commit",
			"git --config-env=core.hooksPath=X commit",
			"git --config-env core.hooksPath=X commit",
			"git config core.hooksPath /tmp/x",
			"git config set core.hooksPath /tmp/x",
			"git config --add core.hooksPath /tmp/x",
			"git config --local core.hooksPath /tmp/x",
			"git config --type path core.hooksPath /tmp/x",
			"git config set --comment note core.hooksPath /tmp/x",
			"git config -t path core.hooksPath /tmp/x",
			"git am -n",
			"git merge --no-verify x",
			"git rebase --no-verify",
			"git pull --no-verify",
		]) {
			const result = classifyGitCommand(command);
			assert.equal(result?.decision, "deny", command);
			assert.equal(result?.bypass, true, command);
		}
	});

	it("does not treat these lookalikes as a bypass", () => {
		for (const command of [
			"git commit -m -n",
			"git commit -mn",
			"git push -n",
			"git merge --no-verify-signatures x",
			"git commit --no-verify --verify -m x",
			"git config --unset core.hooksPath",
			"git config --get core.hooksPath",
			"git config core.hooksPath",
			"git config --default /x core.hooksPath",
			"git commit -m x",
		]) {
			const result = classifyGitCommand(command);
			assert.notEqual(result?.bypass, true, command);
		}
	});
});

// The `git config` parser has produced a defect three rounds running — first
// --type's value read as the key, then abbreviated flags going unrecognized,
// then a mutation-testing gap: a variant that treats "key followed only by
// dash-prefixed tokens" as a read passed the self-referential invariant that
// used to live here, because that invariant computed its own expectation
// from the implementation's rule instead of from git. This replaces it with
// an oracle: every generated combination is run through the *real* installed
// git, in an isolated repo/global/system/file set, and the classifier is
// graded against what git actually did — not against what this file assumes
// git does (#1232).
describe("git config bypass oracle (#1232)", () => {
	// Set up synchronously, inline, rather than in a before() hook: the
	// combos below are graded during this describe callback's own
	// synchronous run (so each combo's expected outcome is known before its
	// `it()` is created), and a before() hook is not guaranteed to have run
	// by then — node:test may re-invoke a nested describe's callback during
	// a separate collection pass, ahead of the outer suite's before() hook.
	const root = mkdtempSync(join(tmpdir(), "gitconfig-oracle-"));
	const repo = join(root, "repo");
	mkdirSync(repo, { recursive: true });
	execFileSync("git", ["init", "-q", "-b", "main", repo]);
	const globalFile = join(root, "global.gitconfig");
	const systemFile = join(root, "system.gitconfig");
	const customFile = join(root, "custom.gitconfig");
	// Keep test identities stable across isolated oracle runs. The real command
	// and its assertion diagnostics still use the actual temporary file path.
	const displayCommand = (command) =>
		command.replaceAll(customFile, "<custom-file>");
	writeFileSync(globalFile, "");
	writeFileSync(systemFile, "");
	writeFileSync(customFile, "");
	const baselineRepoConfig = readFileSync(join(repo, ".git", "config"), "utf8");
	const env = {
		...process.env,
		HOME: root,
		GIT_CONFIG_GLOBAL: globalFile,
		GIT_CONFIG_SYSTEM: systemFile,
	};

	after(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function resetAll() {
		writeFileSync(join(repo, ".git", "config"), baselineRepoConfig);
		writeFileSync(globalFile, "");
		writeFileSync(systemFile, "");
		writeFileSync(customFile, "");
	}

	/** Whether `path` (repo config, global, system, or the shared --file target) mentions core.hooksPath at all, in any case. */
	function fileHasHooksPath(path) {
		if (!existsSync(path)) return false;
		return readFileSync(path, "utf8").toLowerCase().includes("hookspath");
	}

	/**
	 * Runs `git config <args>` for real, in an isolated repo/global/system/file
	 * set reset before this call, and reports what actually happened.
	 * `gitRejected` is true only for a parse-level rejection (unrecognized or
	 * ambiguous option, wrong argument count) — git's own exit code 129 for
	 * this command — not for an ordinary "no such key" miss from `get`/`unset`
	 * (exit 1/5), which is a legitimate, gradable non-bypass outcome.
	 */
	function observe(args) {
		resetAll();
		let exit = 0;
		try {
			execFileSync("git", ["config", ...args], {
				cwd: repo,
				encoding: "utf8",
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (e) {
			exit = e.status ?? 1;
		}
		const setOutside =
			fileHasHooksPath(globalFile) ||
			fileHasHooksPath(systemFile) ||
			fileHasHooksPath(customFile);
		const setAnywhere =
			setOutside || fileHasHooksPath(join(repo, ".git", "config"));
		return { gitRejected: exit === 129, setAnywhere, setOutside };
	}

	// ---- combo generation ----
	//
	// The full cross product of every dimension below is tens of thousands of
	// combinations. Instead of that, or a pure one-factor-at-a-time sweep, this
	// builds: (1) a full cross of the four small dimensions (mode x key x
	// value-presence x scope/file/value-opt/marker each individually against
	// that base, one dimension varying at a time — catching every individual
	// form against every mode/key/value combination); plus (2) a restricted
	// pairwise cross between (scope/file x marker) and (value-opt x marker),
	// using small representative subsets of each, to catch interaction defects
	// like a marker token being consumed as a *different* flag's value
	// (`--comment --list core.hooksPath /x`); plus (3) the specific literal
	// examples from the design record for "option after the key" and
	// "key-/marker-like token in a flag's value position". This stays well
	// under the ~800 target while still exercising every individual form and
	// the specific interactions this round's defects came from.

	const customFileToken = () => customFile;

	/** [tokens] for each scope/file form, "" first (none). */
	const SCOPE_FILE_FORMS = [
		{ name: "", tokens: [] },
		{ name: "--global", tokens: ["--global"] },
		{ name: "--system", tokens: ["--system"] },
		{ name: "--local", tokens: ["--local"] },
		{ name: "--worktree", tokens: ["--worktree"] },
		{ name: "-f (separate)", tokens: () => ["-f", customFileToken()] },
		{ name: "--file (separate)", tokens: () => ["--file", customFileToken()] },
		{ name: "-f (attached)", tokens: () => [`-f${customFileToken()}`] },
		{
			name: "--file= (attached)",
			tokens: () => [`--file=${customFileToken()}`],
		},
		{
			name: "--fil (abbrev, separate)",
			tokens: () => ["--fil", customFileToken()],
		},
		{
			name: "--fil= (abbrev, attached)",
			tokens: () => [`--fil=${customFileToken()}`],
		},
		{ name: "--glob (abbrev)", tokens: ["--glob"] },
		{ name: "--sys (abbrev)", tokens: ["--sys"] },
		{ name: "--loc (abbrev)", tokens: ["--loc"] },
	];

	/** [tokens] for each value-taking-option form, "" first (none). */
	const VALUE_OPT_FORMS = [
		{ name: "", tokens: [] },
		{ name: "--type (separate)", tokens: ["--type", "path"] },
		{ name: "--type= (attached)", tokens: ["--type=path"] },
		{ name: "--typ (abbrev)", tokens: ["--typ", "path"] },
		{ name: "--comment (separate)", tokens: ["--comment", "note"] },
		{ name: "--comment= (attached)", tokens: ["--comment=note"] },
		{ name: "--comm (abbrev)", tokens: ["--comm", "note"] },
		{ name: "--default (separate)", tokens: ["--default", "orig"] },
		{ name: "--default= (attached)", tokens: ["--default=orig"] },
		{ name: "--value (separate)", tokens: ["--value", "pat"] },
		{ name: "--value= (attached)", tokens: ["--value=pat"] },
	];

	/** [tokens] for each read/unset marker, "" first (none). `bare` markers must be the very first token overall to dispatch as a verb. */
	const MARKER_FORMS = [
		{ name: "", tokens: [], bare: false },
		{ name: "--get", tokens: ["--get"], bare: false },
		{ name: "--get-all", tokens: ["--get-all"], bare: false },
		{ name: "--unset", tokens: ["--unset"], bare: false },
		{ name: "--unse (ambiguous abbrev)", tokens: ["--unse"], bare: false },
		{ name: "--unset-all", tokens: ["--unset-all"], bare: false },
		{ name: "-l", tokens: ["-l"], bare: false },
		{ name: "get (bare verb)", tokens: ["get"], bare: true },
		{ name: "unset (bare verb)", tokens: ["unset"], bare: true },
		{ name: "list (bare verb)", tokens: ["list"], bare: true },
	];

	const MODES = ["legacy", "set"];
	const KEYS = ["core.hooksPath", "CORE.HOOKSPATH"];
	const VALUE_PRESENCE = [true, false];

	function tokensOf(form) {
		return typeof form.tokens === "function" ? form.tokens() : form.tokens;
	}

	/**
	 * Builds one full argv (as a flat token array) for a combo. A bare marker
	 * (git's git-2.46+ subcommand words used as a marker rather than the
	 * `set` mode) must be the absolute first token to dispatch as a verb, so
	 * it goes ahead of everything else; otherwise `set` (if this combo's mode
	 * is `set`) leads, then scope/file, then value-opt, then the marker flag,
	 * then the key and optional value.
	 */
	function buildArgs({ mode, scope, valueOpt, marker, key, hasValue }) {
		const scopeTokens = tokensOf(scope);
		const valueOptTokens = tokensOf(valueOpt);
		const markerTokens = tokensOf(marker);
		const tail = [key, ...(hasValue ? ["/x"] : [])];
		if (marker.bare)
			return [...markerTokens, ...scopeTokens, ...valueOptTokens, ...tail];
		const modeTokens = mode === "set" ? ["set"] : [];
		return [
			...modeTokens,
			...scopeTokens,
			...valueOptTokens,
			...markerTokens,
			...tail,
		];
	}

	/** A bare marker is a second verb slot; `set` already claimed the first. */
	function isValidCombo({ mode, marker }) {
		return !(mode === "set" && marker.bare);
	}

	const NONE_SCOPE = SCOPE_FILE_FORMS[0];
	const NONE_VALUE_OPT = VALUE_OPT_FORMS[0];
	const NONE_MARKER = MARKER_FORMS[0];

	const combos = new Map(); // command string -> combo (dedup identical argvs)

	function addCombo(combo) {
		if (!isValidCombo(combo)) return;
		const args = buildArgs(combo);
		const command = `git config ${args.join(" ")}`;
		if (!combos.has(command)) combos.set(command, { combo, args, command });
	}

	// (1) Every individual form of each large dimension, crossed with the full
	// small-dimension base (mode x key x value-presence).
	for (const mode of MODES) {
		for (const key of KEYS) {
			for (const hasValue of VALUE_PRESENCE) {
				for (const scope of SCOPE_FILE_FORMS) {
					addCombo({
						mode,
						key,
						hasValue,
						scope,
						valueOpt: NONE_VALUE_OPT,
						marker: NONE_MARKER,
					});
				}
				for (const valueOpt of VALUE_OPT_FORMS) {
					addCombo({
						mode,
						key,
						hasValue,
						scope: NONE_SCOPE,
						valueOpt,
						marker: NONE_MARKER,
					});
				}
				for (const marker of MARKER_FORMS) {
					addCombo({
						mode,
						key,
						hasValue,
						scope: NONE_SCOPE,
						valueOpt: NONE_VALUE_OPT,
						marker,
					});
				}
			}
		}
	}

	// (2) Restricted pairwise cross: a small representative subset of
	// scope/file forms and value-opt forms, each against every marker, to
	// catch a marker consumed as a *different* flag's own value (or vice
	// versa) — the class of defect `--comment --list core.hooksPath /x` is
	// an instance of. Held at mode=legacy, key=core.hooksPath, both value
	// presences.
	const SCOPE_SUBSET = [
		NONE_SCOPE,
		SCOPE_FILE_FORMS.find((f) => f.name === "--global"),
		SCOPE_FILE_FORMS.find((f) => f.name === "-f (separate)"),
		SCOPE_FILE_FORMS.find((f) => f.name === "--fil= (abbrev, attached)"),
	];
	const VALUE_OPT_SUBSET = [
		NONE_VALUE_OPT,
		VALUE_OPT_FORMS.find((f) => f.name === "--comment (separate)"),
		VALUE_OPT_FORMS.find((f) => f.name === "--type= (attached)"),
	];
	for (const hasValue of VALUE_PRESENCE) {
		for (const scope of SCOPE_SUBSET) {
			for (const marker of MARKER_FORMS) {
				addCombo({
					mode: "legacy",
					key: "core.hooksPath",
					hasValue,
					scope,
					valueOpt: NONE_VALUE_OPT,
					marker,
				});
			}
		}
		for (const valueOpt of VALUE_OPT_SUBSET) {
			for (const marker of MARKER_FORMS) {
				addCombo({
					mode: "legacy",
					key: "core.hooksPath",
					hasValue,
					scope: NONE_SCOPE,
					valueOpt,
					marker,
				});
			}
		}
	}

	// (3) The design record's specific examples: an option placed after the
	// key, and a key-/marker-like token sitting in a *different* flag's value
	// position. Also review findings from round 4: a short prefix that
	// resolves differently depending on which mode it is scoped to (`--g`/
	// `--l`/`--e` under `set`, where `set`'s own narrower option table has no
	// `--get*`/`--list` to be ambiguous with, unlike the shared table); and
	// short-option clusters (`f`/`t` take a value, `l`/`e` are read markers,
	// `z` takes nothing), including one stacked with `-t`'s attached form.
	const LITERAL_EXAMPLES = [
		["core.hooksPath", "--show-origin"],
		["core.hooksPath", "--type=path"],
		["--comment", "--list", "core.hooksPath", "/x"],
		["--file", customFile, "user.name", "x"],
		["set", "--g", "core.hooksPath", "/x"],
		["set", "--l", "core.hooksPath", "/x"],
		["set", "--e", "core.hooksPath", "/x"],
		["-zf", customFile, "core.hooksPath", "/x"],
		["-zt", "path", "core.hooksPath", "/x"],
		["-zl", "core.hooksPath", "/x"],
		["-tpath", "core.hooksPath", "/x"],
	];

	console.log(
		`git config bypass oracle: ${combos.size} generated combinations`,
	);

	let rejectedCount = 0;
	for (const { args, command } of combos.values()) {
		const { gitRejected, setAnywhere, setOutside } = observe(args);
		if (gitRejected) {
			rejectedCount++;
			continue;
		}
		it(`${setAnywhere ? "denies" : "allows"} '${displayCommand(command)}'`, () => {
			const result = classifyGitCommand(command);
			assert.equal(result?.bypass === true, setAnywhere, command);
			if (setAnywhere) {
				assert.equal(result?.outsideTarget === true, setOutside, command);
			}
		});
	}
	console.log(
		`git config bypass oracle: excludes ${rejectedCount} combo(s) git itself rejected (ambiguous option/wrong arg count) from grading`,
	);

	// Literal examples from the design record (kept flat, not in a nested
	// describe — see the setup comment above for why).
	for (const args of LITERAL_EXAMPLES) {
		const command = `git config ${args.join(" ")}`;
		const { gitRejected, setAnywhere, setOutside } = observe(args);
		if (gitRejected) continue;
		it(`example: ${setAnywhere ? "denies" : "allows"} '${displayCommand(command)}'`, () => {
			const result = classifyGitCommand(command);
			assert.equal(result?.bypass === true, setAnywhere, command);
			if (setAnywhere) {
				assert.equal(result?.outsideTarget === true, setOutside, command);
			}
		});
	}
});

// The `-n` cluster parser and the `--no-verify`/`--verify` last-wins scan
// each depend on correctly skipping *other* flags — commit's long
// value-taking options, global options ahead of the subcommand — that carry
// no bypass meaning of their own. This invariant checks the combination
// directly instead of one global prefix at a time (#1232).
describe("git global-option bypass invariant (#1232)", () => {
	const GLOBAL_PREFIXES = [
		[],
		["-C", "."],
		["--no-pager"],
		["--attr-source", "HEAD"],
		["--config-env", "core.editor=E"],
		["-c", "user.name=x"],
		["--literal-pathspecs"],
	];
	const BYPASS_FORMS = [
		"commit --no-verify -m x",
		"commit -nm x",
		"-c core.hooksPath=/x commit -m x",
		"--config-env=core.hooksPath=E commit -m x",
		"push --no-verify",
	];
	const NON_BYPASS_FORMS = [
		"commit -m x",
		"push -n",
		"commit -m -n",
		"commit --no-verify --verif -m x",
		"commit --message -n",
	];

	for (const prefix of GLOBAL_PREFIXES) {
		for (const form of BYPASS_FORMS) {
			const command = `git ${[...prefix, form].join(" ")}`;
			it(`denies '${command}'`, () => {
				assert.equal(classifyGitCommand(command)?.bypass, true, command);
			});
		}
		for (const form of NON_BYPASS_FORMS) {
			const command = `git ${[...prefix, form].join(" ")}`;
			it(`does not treat '${command}' as bypass`, () => {
				assert.notEqual(classifyGitCommand(command)?.bypass, true, command);
			});
		}
	}
});

describe("resolveCommandCwd", () => {
	const HOOK_CWD = "/repo";
	it("resolves literal per-command targets without interpreting shell cwd", () => {
		for (const [command, expected] of [
			["git commit -m x", HOOK_CWD],
			["git -C /elsewhere/w commit -m x", "/elsewhere/w"],
			["git -C /worktrees/session -C ../sibling add -A", "/worktrees/sibling"],
			["cd /a && git -C /b commit -m x", "/b"],
			["echo 'cd /a' && git commit -m x", HOOK_CWD],
			["cd /a && git add -A", null],
			["cd '$SIBLING' && git commit -m x", null],
			["cd $WORKTREE && git commit -m x", null],
			["cd -- /a >/dev/null && git add -A", null],
			["cd && git commit -m x", null],
		])
			assert.equal(resolveCommandCwd(command, HOOK_CWD), expected, command);
	});
	it("resolves the routine wrapper's explicit target behind supported launchers", () => {
		for (const launcher of ["", "node ", "node --no-warnings ", "node -- "])
			assert.equal(
				resolveCommandCwd(
					`${launcher}/opt/codex/bin/codex-git-routine.mjs stage-all /repo/sibling sibling`,
					HOOK_CWD,
				),
				"/repo/sibling",
				launcher,
			);
	});
});

describe("evaluateMainCommitGuard", () => {
	it("tells the session's own worktree, a sibling, an unrelated repository and an unresolved target apart (#1221)", () => {
		const session = {
			worktreeRoot: "/repo/.claude/worktrees/a",
			commonDir: "/repo/.git",
			mainRoot: "/repo",
		};
		assert.equal(
			classifyTargetRepository(session, {
				...session,
				worktreeRoot: "/repo/.claude/worktrees/b",
			}),
			"sibling",
		);
		assert.equal(classifyTargetRepository(session, session), "own");
		assert.equal(
			classifyTargetRepository(session, {
				worktreeRoot: "/other/worktree",
				commonDir: "/other/.git",
				mainRoot: "/other",
			}),
			"foreign",
		);
		assert.equal(classifyTargetRepository(session, null), "unknown");
		assert.equal(classifyTargetRepository(null, session), "unknown");
	});

	it("allows a state-creating command on an unrelated repository's default branch (#1221)", () => {
		for (const command of [
			"git add -A",
			"git commit -m 'x'",
			"git restore f",
		]) {
			const result = evaluateMainCommitGuard(payload({ command }), {
				currentBranch: "main",
				targetRelation: "foreign",
			});
			assert.equal(result.decision, "allow");
		}
	});

	it("keeps guarding the default branch when the target roots cannot be resolved (#1221)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "main",
			targetRelation: "unknown",
		});
		assert.equal(result.decision, "deny");
	});

	it("ignores tools other than Bash", () => {
		const result = evaluateMainCommitGuard(
			{
				hook_event_name: "PreToolUse",
				tool_name: "Read",
				tool_input: { file_path: "/tmp/x" },
			},
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a read-only command on main", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git status" }), {
			currentBranch: "main",
		});
		assert.equal(result.decision, "allow");
	});

	it("denies staging on main, the index the whole repo shares (#777)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "main",
		});
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /git add/);
	});

	it("asks before a restore on main, which is also the recovery path (#777)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git checkout -- src/x.ts" }),
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /git checkout/);
	});

	it("allows staging on a feature branch", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "feature/x",
		});
		assert.equal(result.decision, "allow");
	});

	it("asks before staging when a feature-branch session targets another worktree (#1201)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "feature/other",
			targetRelation: "sibling",
		});
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /worktree/);
		assert.doesNotMatch(
			result.reason,
			/starting or reopening a session whose project root is that worktree/,
		);
	});

	it("still denies staging on the default branch of another worktree (#1201)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "main",
			targetRelation: "sibling",
		});
		assert.equal(result.decision, "deny");
	});

	it("asks before restoring files in another worktree (#784)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git restore src/x.ts" }),
			{
				currentBranch: "feature/other",
				targetRelation: "sibling",
			},
		);
		assert.equal(result.decision, "ask");
		assert.match(result.reason, /worktree other than the one this session/);
	});

	it("allows a commit on a feature branch", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{
				currentBranch: "feature/x",
			},
		);
		assert.equal(result.decision, "allow");
	});

	it("denies a commit on main", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{ currentBranch: "main" },
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /main/);
		assert.match(
			result.reason,
			/shared by processes and sessions targeting that checkout/,
		);
	});

	it("respects a configured default branch other than main", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{
				currentBranch: "trunk",
				mainBranch: "trunk",
			},
		);
		assert.equal(result.decision, "deny");
	});

	it("treats a checkout sitting on MAIN as on the default branch (case-insensitive filesystems)", () => {
		for (const currentBranch of ["MAIN", "Main"]) {
			const result = evaluateMainCommitGuard(
				payload({ command: "git commit -m 'x'" }),
				{ currentBranch, mainBranch: "main" },
			);
			assert.equal(result.decision, "deny", currentBranch);
		}
	});

	it("keeps the default-branch deny when a config override rides on the commit", () => {
		for (const command of [
			"git -c user.name=x commit -m 'x'",
			"GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=a.b GIT_CONFIG_VALUE_0=c git commit -m 'x'",
		]) {
			const result = evaluateMainCommitGuard(payload({ command }), {
				currentBranch: "main",
			});
			assert.equal(result.decision, "deny", command);
			assert.match(result.reason, /Blocked 'git commit' on 'main'/, command);
		}
	});

	it("asks for a config override on a feature branch, but not for a read or a foreign target", () => {
		for (const command of [
			"git -c user.name=x commit -m 'x'",
			"git --config-env=a.b=ENV fetch origin",
			"GIT_CONFIG_PARAMETERS=x git fetch origin",
		]) {
			const result = evaluateMainCommitGuard(payload({ command }), {
				currentBranch: "topic",
			});
			assert.equal(result.decision, "ask", command);
			assert.equal(
				evaluateMainCommitGuard(payload({ command }), {
					currentBranch: "topic",
					targetRelation: "foreign",
				}).decision,
				"allow",
				command,
			);
		}
		assert.equal(
			evaluateMainCommitGuard(payload({ command: "git -c k=v log -1" }), {
				currentBranch: "topic",
			}).decision,
			"allow",
		);
	});

	it("classifies visible config setters conservatively without unset recovery", () => {
		for (const command of [
			"export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=a.b GIT_CONFIG_VALUE_0=c; git fetch origin",
			"GIT_CONFIG_PARAMETERS=x; git fetch origin",
		])
			assert.equal(
				evaluateMainCommitGuard(payload({ command }), {
					currentBranch: "topic",
				}).decision,
				"ask",
				command,
			);
		assert.equal(
			evaluateMainCommitGuard(
				payload({
					command:
						"export GIT_CONFIG_COUNT=1; unset GIT_CONFIG_COUNT; git fetch origin",
				}),
				{ currentBranch: "topic" },
			).decision,
			"ask",
		);
	});

	it("allows when currentBranch is unknown (detached HEAD, detection failure)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m 'x'" }),
			{ currentBranch: undefined },
		);
		assert.equal(result.decision, "allow");
	});
});

describe("evaluateMainCommitGuard bypass axis (#1232)", () => {
	it("denies a bypass on a feature branch in the session's own worktree", () => {
		for (const command of [
			"git -c core.hooksPath=/nonexistent commit -m x",
			"git commit --no-verify -m x",
		]) {
			const result = evaluateMainCommitGuard(payload({ command }), {
				currentBranch: "feature/x",
			});
			assert.equal(result.decision, "deny", command);
			assert.match(result.reason, /pre-commit/);
		}
	});

	it("still allows a plain commit on a feature branch (no blanket deny)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit -m x" }),
			{ currentBranch: "feature/x" },
		);
		assert.equal(result.decision, "allow");
	});

	it("allows a bypass targeting a foreign repository", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit --no-verify -m x" }),
			{ currentBranch: "main", targetRelation: "foreign" },
		);
		assert.equal(result.decision, "allow");
	});

	it("denies rather than asks for a bypass targeting a sibling worktree", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git commit --no-verify -m x" }),
			{ currentBranch: "feature/x", targetRelation: "sibling" },
		);
		assert.equal(result.decision, "deny");
	});

	it("names git hooks rather than pre-commit for a non-commit subcommand", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git push --no-verify" }),
			{ currentBranch: "feature/x" },
		);
		assert.equal(result.decision, "deny");
		// "this skips git hooks" up front, not "this skips pre-commit" — the
		// shim-guidance sentence still names scripts/pre-commit regardless.
		assert.match(result.reason, /this skips git hooks/);
		assert.doesNotMatch(result.reason, /this skips pre-commit/);
	});

	it("denies a git config bypass that writes outside a foreign target (#1232)", () => {
		// The oracle (describe "git config bypass oracle") already confirms
		// classifyGitCommand's outsideTarget is correct for each of these
		// forms; this checks the other half — that evaluateMainCommitGuard's
		// foreign-target exemption actually stays narrowed for each of them,
		// not just for the two forms it happened to be written against.
		for (const command of [
			"git -C /tmp/sbx config --global core.hooksPath /x",
			"git -C /tmp/sbx config --system core.hooksPath /x",
			"git -C /tmp/sbx config --glob core.hooksPath /x",
			"git -C /tmp/sbx config --sys core.hooksPath /x",
			"git -C /tmp/sbx config --file /abs/.git/config core.hooksPath /x",
			"git -C /tmp/sbx config -f/abs/.git/config core.hooksPath /x",
			"git -C /tmp/sbx config --fil=/abs/.git/config core.hooksPath /x",
		]) {
			const result = evaluateMainCommitGuard(payload({ command }), {
				currentBranch: "main",
				targetRelation: "foreign",
			});
			assert.equal(result.decision, "deny", command);
		}
	});

	it("still allows a plain git config bypass in a foreign target", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git config core.hooksPath /x" }),
			{ currentBranch: "main", targetRelation: "foreign" },
		);
		assert.equal(result.decision, "allow");
	});

	it("names the scope/file flag and suggests local config or a terminal for an outsideTarget deny against a foreign target (#1232)", () => {
		const result = evaluateMainCommitGuard(
			payload({ command: "git config --global core.hooksPath /x" }),
			{ currentBranch: "main", targetRelation: "foreign" },
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /'--global'/);
		assert.match(result.reason, /--local|--worktree/);
		assert.match(result.reason, /own terminal/);
	});

	it("says 'may write' rather than asserting it for a --file outsideTarget deny", () => {
		const result = evaluateMainCommitGuard(
			payload({
				command: "git config --file /abs/.git/config core.hooksPath /x",
			}),
			{ currentBranch: "main", targetRelation: "foreign" },
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /may write/);
	});

	it("uses the general bypass message, not the outsideTarget one, for an own-target outsideTarget bypass (#1232)", () => {
		// Against the session's own worktree (or a sibling, or an unknown
		// target), dropping just the scope flag still leaves a bypass that
		// skips hooks and still denies — "drop the scope flag" would be
		// incomplete advice, so the general message applies instead.
		const result = evaluateMainCommitGuard(
			payload({ command: "git config --global core.hooksPath /x" }),
			{ currentBranch: "feature/x" },
		);
		assert.equal(result.decision, "deny");
		assert.match(result.reason, /this skips git hooks/);
		assert.doesNotMatch(
			result.reason,
			/Write to the target's own local config/,
		);
	});
});

describe("runMainCommitGuard", () => {
	const commit = JSON.stringify(payload({ command: "git commit -m 'x'" }));

	it("denies a commit on the default branch", () => {
		const { shouldOutput, output } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "main", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("denies on a default branch that is not called main", () => {
		const { shouldOutput } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "trunk", mainBranch: "trunk" }),
		});
		assert.equal(shouldOutput, true);
	});

	it("allows a commit on a feature branch", () => {
		const { shouldOutput } = runMainCommitGuard(commit, {
			resolveBranches: () => ({ currentBranch: "topic", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, false);
	});

	it("evaluates every guarded segment in its own effective cwd (#784)", () => {
		for (const command of [
			"git -C /worktrees/session add -A && git -C /worktrees/sibling add -A",
			"git add -A && git -C /worktrees/sibling add -A",
		]) {
			const visited = [];
			const input = JSON.stringify(
				payload({ command, cwd: "/worktrees/session" }),
			);
			const { shouldOutput, output } = runMainCommitGuard(input, {
				resolveBranches: (_payload, targetCwd) => {
					visited.push(targetCwd);
					return {
						currentBranch: "topic",
						mainBranch: "main",
						targetRelation:
							targetCwd === "/worktrees/sibling" ? "sibling" : "own",
					};
				},
			});
			assert.deepEqual(visited, ["/worktrees/session", "/worktrees/sibling"]);
			assert.equal(shouldOutput, true);
			assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
		}
	});

	it("aggregates per-segment decisions with deny before ask (#784)", () => {
		const context = (_payload, targetCwd) => ({
			currentBranch: targetCwd === "/repo" ? "main" : "topic",
			mainBranch: "main",
			targetRelation: targetCwd === "/worktrees/session" ? "own" : "sibling",
		});
		const askInput = JSON.stringify(
			payload({
				command: "git add -A && git -C /worktrees/sibling restore tracked.txt",
				cwd: "/worktrees/session",
			}),
		);
		const asked = runMainCommitGuard(askInput, { resolveBranches: context });
		assert.equal(asked.output.hookSpecificOutput.permissionDecision, "ask");

		const denyInput = JSON.stringify(
			payload({
				command:
					"git -C /worktrees/sibling restore tracked.txt && git -C /repo add -A",
				cwd: "/worktrees/session",
			}),
		);
		const denied = runMainCommitGuard(denyInput, { resolveBranches: context });
		assert.equal(denied.output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("asks rather than denies for a state-restoring subcommand (#777)", () => {
		const input = JSON.stringify(payload({ command: "git reset --hard" }));
		const { shouldOutput, output } = runMainCommitGuard(input, {
			resolveBranches: () => ({ currentBranch: "main", mainBranch: "main" }),
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "ask");
	});

	it("never resolves branches for a command the guard does not cover", () => {
		let called = false;
		const input = JSON.stringify(payload({ command: "git status" }));
		const { shouldOutput } = runMainCommitGuard(input, {
			resolveBranches: () => {
				called = true;
				return { currentBranch: "main", mainBranch: "main" };
			},
		});
		assert.equal(shouldOutput, false);
		assert.equal(called, false);
	});

	it("silently allows malformed stdin JSON", () => {
		assert.deepEqual(
			runMainCommitGuard("not json{{{", { resolveBranches: () => ({}) }),
			{
				shouldOutput: false,
			},
		);
	});

	it("denies a bypass on a feature branch under Codex, where ask is unsupported (#1232)", () => {
		const input = JSON.stringify(
			payload({ command: "git commit --no-verify -m x" }),
		);
		const { shouldOutput, output } = runMainCommitGuard(input, {
			resolveBranches: () => ({ currentBranch: "topic", mainBranch: "main" }),
			supportsAsk: false,
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("rejects unquoted target expansion before any branch probe (#1232)", () => {
		const input = JSON.stringify(
			payload({ command: "git -C $W commit --no-verify -m x" }),
		);
		const { shouldOutput, output } = runMainCommitGuard(input, {
			resolveBranches: () => {
				throw new Error("must not resolve branches for an unresolved cwd");
			},
		});
		assert.equal(shouldOutput, true);
		const reason = output.hookSpecificOutput.permissionDecisionReason;
		assert.match(reason, /may change command words/);
		assert.match(reason, /quoted scalar/);
	});
});

describe("main-commit-guard wrapper", () => {
	const script = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../main-commit-guard.mjs",
	);
	let root;
	let repo;
	let session;
	let sibling;
	let unrelated;

	function git(cwd, args) {
		return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	}

	before(() => {
		// realpath: git reports worktree roots resolved, so a symlinked tmpdir
		// would make the fixture's session and target look like different repos.
		root = realpathSync(mkdtempSync(join(tmpdir(), "main-commit-guard-")));
		repo = join(root, "repo");
		session = join(root, "session");
		sibling = join(root, "sibling");
		mkdirSync(repo);
		git(root, ["init", "-b", "main", repo]);
		git(repo, ["config", "user.email", "guard-test@example.invalid"]);
		git(repo, ["config", "user.name", "Guard Test"]);
		writeFileSync(join(repo, "tracked.txt"), "fixture\n");
		git(repo, ["add", "tracked.txt"]);
		git(repo, ["commit", "-m", "fixture"]);
		git(repo, ["remote", "add", "origin", repo]);
		git(repo, [
			"symbolic-ref",
			"refs/remotes/origin/HEAD",
			"refs/remotes/origin/main",
		]);
		git(repo, ["worktree", "add", "-b", "session", session]);
		git(repo, ["worktree", "add", "-b", "sibling", sibling]);
		mkdirSync(join(session, "sibling"));
		writeFileSync(
			resolve(
				session,
				git(session, ["rev-parse", "--git-path", "codex-thread.json"]).trim(),
			),
			JSON.stringify({ version: 1, ownerThreadId: "fixture-session" }),
		);

		// A throwaway sandbox of the shape distribution-review's probes create:
		// its own .git, no remote, and the `main` that `git init` hands out
		// here (#1221).
		unrelated = join(root, "unrelated");
		mkdirSync(unrelated);
		git(root, ["init", "-b", "main", unrelated]);
	});

	after(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function runWrapper(
		command,
		{
			payloadCwd = session,
			claudeProjectDir = session,
			environment = {},
			expectFailure = false,
		} = {},
	) {
		const env = { ...process.env, ...environment };
		if (claudeProjectDir === null) delete env.CLAUDE_PROJECT_DIR;
		else env.CLAUDE_PROJECT_DIR = claudeProjectDir;
		try {
			return execFileSync(process.execPath, [script], {
				encoding: "utf8",
				env,
				input: JSON.stringify({
					...payload({ command, cwd: payloadCwd }),
					session_id: "fixture-session",
				}),
			}).trim();
		} catch (error) {
			if (!expectFailure) throw error;
			assert.equal(error.status, 2);
			assert.match(error.stdout, /"permissionDecision":"deny"/);
			return error.stdout.trim();
		}
	}

	it("stays silent on an unrelated repository's main while still guarding a sibling (#1221)", () => {
		assert.equal(runWrapper(`git -C ${unrelated} add -A`), "");
		// The pair matters: dropping the ownership check altogether would also
		// make the line above pass, and only the sibling case notices.
		assert.notEqual(runWrapper(`git -C ${sibling} add -A`), "");
	});

	it("denies the default branch when only the session root fails to resolve (#1221)", () => {
		// The one route by which `unknown` reaches a decision: the target
		// answers `main`, and the session root does not resolve at all. Pinning
		// it here keeps a later reader from folding `unknown` into `foreign` on
		// the grounds that nothing distinguishes it.
		const output = runWrapper(`git -C ${repo} add -A`, {
			claudeProjectDir: join(root, "no-such-session-dir"),
			expectFailure: true,
		});
		assert.match(output, /"permissionDecision":"deny"/);
	});

	it("denies when a mutation target cannot establish a repository (#1404)", () => {
		const notARepo = join(root, "not-a-repo");
		mkdirSync(notARepo, { recursive: true });
		assert.match(
			runWrapper(`git -C ${notARepo} add -A`, { expectFailure: true }),
			/"permissionDecision":"deny"/,
		);
	});

	it("uses the payload cwd as the session worktree in Codex (#784)", () => {
		const output = runWrapper(`git -C ${sibling} add -A`, {
			claudeProjectDir: null,
		});
		assert.notEqual(output, "");
		assert.equal(
			JSON.parse(output).hookSpecificOutput.permissionDecision,
			"deny",
		);
	});

	it("guards the explicit wrapper target instead of invisible exec workdir", () => {
		const routine = "/opt/codex/bin/codex-git-routine.mjs";
		for (const launcher of ["", "node ", "node --no-warnings ", "node -- "])
			for (const [target, branch, expected] of [
				[sibling, "sibling", "deny"],
				[repo, "main", "deny"],
				[session, "session", null],
			]) {
				const output = runWrapper(
					`${launcher}${routine} stage-all ${target} ${branch}`,
					{ claudeProjectDir: null },
				);
				if (expected === null) assert.equal(output, "");
				else
					assert.equal(
						JSON.parse(output).hookSpecificOutput.permissionDecision,
						expected,
						`${launcher}${target}`,
					);
			}
	});

	it("converts an unsupported Codex ask into a fail-closed deny", () => {
		const output = runWrapper(`git -C ${sibling} restore tracked.txt`, {
			claudeProjectDir: null,
		});
		const result = JSON.parse(output).hookSpecificOutput;
		assert.equal(result.permissionDecision, "deny");
		assert.match(result.permissionDecisionReason, /Codex.*ask.*unsupported/i);
	});

	it("keeps the Claude permission prompt for the same recovery command", () => {
		const output = runWrapper(`git -C ${sibling} restore tracked.txt`);
		assert.equal(
			JSON.parse(output).hookSpecificOutput.permissionDecision,
			"ask",
		);
	});

	it("asks instead of denying when a Claude session stages in the worktree it moved into (#1201)", () => {
		// The harness keeps reporting the root the session started with, so the
		// worktree the session actually works in reads as a sibling. The human
		// confirms ownership, which is the fact the guard cannot verify itself.
		const output = runWrapper(`git -C ${sibling} add -A`, {
			payloadCwd: repo,
			claudeProjectDir: repo,
		});
		const result = JSON.parse(output).hookSpecificOutput;
		assert.equal(result.permissionDecision, "ask");
		assert.doesNotMatch(
			result.permissionDecisionReason,
			/starting or reopening a session whose project root is that worktree/,
		);
	});

	it("keeps CLAUDE_PROJECT_DIR authoritative over the payload cwd", () => {
		const output = runWrapper(`git -C ${session} add -A`, {
			payloadCwd: sibling,
			claudeProjectDir: session,
		});
		assert.equal(output, "");
	});

	it("treats whitespace-only session roots as absent", () => {
		const fallbackToPayload = runWrapper(`git -C ${sibling} add -A`, {
			payloadCwd: session,
			claudeProjectDir: " \t ",
		});
		assert.notEqual(fallbackToPayload, "");
		assert.equal(
			JSON.parse(fallbackToPayload).hookSpecificOutput.permissionDecision,
			"deny",
		);

		const claudeStillWins = runWrapper(`git -C ${session} add -A`, {
			payloadCwd: " \n ",
			claudeProjectDir: session,
		});
		assert.equal(claudeStillWins, "");
	});

	it("denies a guarded mutation when ambient Git target variables point at a sibling", () => {
		const output = runWrapper("git add -A", {
			environment: {
				GIT_DIR: git(sibling, ["rev-parse", "--git-dir"]),
				GIT_WORK_TREE: sibling,
			},
		});
		assert.notEqual(output, "");
		assert.equal(
			JSON.parse(output).hookSpecificOutput.permissionDecision,
			"deny",
		);

		assert.equal(
			runWrapper("git status", {
				environment: { GIT_DIR: git(sibling, ["rev-parse", "--git-dir"]) },
			}),
			"",
		);
	});

	it("only treats reserved words in command position as compounds", () => {
		assert.equal(runWrapper("git commit -m if"), "");
		assert.equal(runWrapper("echo if; git add -A"), "");
	});

	it("removes unquoted backslash-newline continuations", () => {
		const command = `g\\${"\n"}it -C ${repo} add -A`;
		const output = runWrapper(command);
		assert.notEqual(output, "");
		assert.equal(
			JSON.parse(output).hookSpecificOutput.permissionDecision,
			"deny",
		);
	});

	it("removes double-quoted backslash-newline continuations", () => {
		const command = `"g\\${"\n"}it" -C ${repo} add -A`;
		const output = runWrapper(command);
		assert.notEqual(output, "");
		assert.equal(
			JSON.parse(output).hookSpecificOutput.permissionDecision,
			"deny",
		);
	});

	it("does not taint control flow without target-affecting commands", () => {
		for (const command of [
			"printf x | cat; git add -A",
			"test -f package.json && printf ok; git add -A",
			`printf x | cat; git -C ${session} add -A`,
		]) {
			assert.equal(runWrapper(command), "", command);
		}
	});
	it("catches compound and repeated-C sibling mutations end to end (#784)", () => {
		for (const command of [
			`git -C ${session} add -A && git -C ${sibling} add -A`,
			`git add -A && git -C ${sibling} add -A`,
			`git -C ${session} -C ../sibling add -A`,
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				"ask",
				command,
			);
		}
	});

	it("fails closed when cd requires shell expansion", () => {
		for (const [command, decision] of [
			[`SIBLING=${sibling}; cd "$SIBLING" && git add -A`, "deny"],
			[`SIBLING=${sibling}; cd "$SIBLING" && git restore tracked.txt`, "deny"],
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			const result = JSON.parse(output).hookSpecificOutput;
			assert.equal(result.permissionDecision, decision, command);
			assert.match(
				result.permissionDecisionReason,
				/absolute literal path.*separate invocation with harness workdir/,
				command,
			);
		}
	});

	it("fails closed for cwd-changing shell builtins the parser cannot model", () => {
		for (const [command, decision] of [
			[`builtin cd "${sibling}" && git add -A`, "deny"],
			// Cwd-changing builtins require an explicit target regardless of wrapper.
			[`command cd "${sibling}" && git add -A`, "deny"],
			[`pushd "${sibling}" && git add -A`, "deny"],
			["popd && git restore tracked.txt", "deny"],
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				decision,
				command,
			);
		}
	});

	it("tracks env chdir prefixes and fails closed for unresolved forms", () => {
		for (const [command, decision] of [
			[`env -C ${repo} git add -A`, "deny"],
			[`env --chdir=${sibling} git add -A`, "ask"],
			['WORKTREE=/somewhere; env -C "$WORKTREE" git add -A', "deny"],
			["env --chdir= git add -A", "deny"],
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				decision,
				command,
			);
		}
	});

	it("fails closed when Git environment variables override the target", () => {
		for (const variable of [
			"GIT_DIR",
			"GIT_WORK_TREE",
			"GIT_INDEX_FILE",
			"GIT_COMMON_DIR",
			"GIT_OBJECT_DIRECTORY",
			"GIT_ALTERNATE_OBJECT_DIRECTORIES",
			"GIT_NAMESPACE",
		]) {
			for (const command of [
				`${variable}=/override git add -A`,
				`env ${variable}=/override git add -A`,
			]) {
				const output = runWrapper(command);
				assert.notEqual(output, "", command);
				assert.equal(
					JSON.parse(output).hookSpecificOutput.permissionDecision,
					"deny",
					command,
				);
			}
		}
	});

	it("fails closed after a shell builtin persists a Git target override", () => {
		for (const command of [
			`export GIT_INDEX_FILE=${join(repo, ".git", "index")}; git add -A`,
			`export GIT_DIR=${join(repo, ".git")} GIT_WORK_TREE=${repo}; git add -A`,
			"readonly GIT_COMMON_DIR=/override; git add -A",
			"typeset GIT_OBJECT_DIRECTORY=/override; git add -A",
			"declare GIT_NAMESPACE=guard-test; git add -A",
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				"deny",
				command,
			);
		}

		assert.equal(runWrapper("export FOO=x; git add -A"), "");
		assert.equal(runWrapper("export GIT_INDEX_FILE=/override; git status"), "");
	});

	it("does not let Git repository-target flags or shell prefixes bypass sibling checks", () => {
		for (const [command, decision] of [
			[`git --git-dir=${join(repo, ".git")} add -A`, "deny"],
			[`git --work-tree=${repo} add -A`, "deny"],
			[`command -- git -C ${sibling} add -A`, "ask"],
			[`sudo -n git -C ${sibling} add -A`, "ask"],
			[`>/dev/null git -C ${sibling} add -A`, "ask"],
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				decision,
				command,
			);
		}
	});

	it("tracks env chdir after leading assignments and redirections", () => {
		for (const command of [
			`FOO=x env -C ${repo} git add -A`,
			`>/dev/null env -C ${repo} git add -A`,
			`< /dev/null env -C ${repo} git add -A`,
			`</dev/null env -C ${repo} git add -A`,
			`<& 0 env -C ${repo} git add -A`,
			`<&0 env -C ${repo} git add -A`,
			`<> /dev/null env -C ${repo} git add -A`,
			`<>/dev/null env -C ${repo} git add -A`,
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				"deny",
				command,
			);
		}
	});

	it("distinguishes command execution from command path queries", () => {
		const execution = runWrapper(`command -p git -C ${sibling} add -A`);
		assert.notEqual(execution, "");
		assert.equal(
			JSON.parse(execution).hookSpecificOutput.permissionDecision,
			"ask",
		);

		for (const query of [
			"command -v git -C /somewhere add -A",
			"command -V git -C /somewhere add -A",
		]) {
			assert.equal(runWrapper(query), "", query);
		}
	});

	it("skips value-taking sudo and time options before guarded Git", () => {
		for (const [command, decision] of [
			[`sudo -u root git -C ${sibling} add -A`, "ask"],
			[`sudo --user=root git -C ${sibling} add -A`, "ask"],
			["sudo -R /jail git add -A", "deny"],
			[`time -o /tmp/time-output git -C ${sibling} add -A`, "ask"],
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				decision,
				command,
			);
		}
	});

	it("fails closed when unknown shell-prefix options may hide guarded Git", () => {
		for (const command of [
			`sudo --unknown value git -C ${sibling} add -A`,
			`time --unknown value git -C ${sibling} add -A`,
		]) {
			const output = runWrapper(command);
			assert.notEqual(output, "", command);
			assert.equal(
				JSON.parse(output).hookSpecificOutput.permissionDecision,
				"deny",
				command,
			);
		}
	});
});
