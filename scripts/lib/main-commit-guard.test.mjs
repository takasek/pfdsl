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

function payload({ toolName = "Bash", command, cwd = "/repo" }) {
	const value = {
		hook_event_name: "PreToolUse",
		tool_name: toolName,
		tool_input: { command },
	};
	if (cwd !== undefined) value.cwd = cwd;
	return value;
}

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
				{ subcommand: sub, decision: "ask" },
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
				"/Users/example/.codex/bin/codex-git-routine.mjs stage-all /repo/worktree topic",
				"add",
			],
			[
				"/Users/example/.codex/bin/codex-git-routine.mjs commit /repo/worktree topic message",
				"commit",
			],
			[
				"/Users/example/.codex/bin/codex-git-routine.mjs branch-rename /repo/worktree old new",
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
		assert.equal(classifyGitCommand("git worktree add ../w -b topic"), null);
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

	it("keeps the hook's cwd for a plain commit", () => {
		assert.equal(resolveCommandCwd("git commit -m 'x'", HOOK_CWD), HOOK_CWD);
	});

	it("follows a leading cd into the tree the commit lands in (#751)", () => {
		assert.equal(
			resolveCommandCwd(
				"cd .claude/worktrees/w && git commit -m 'x'",
				HOOK_CWD,
			),
			"/repo/.claude/worktrees/w",
		);
	});

	it("follows an absolute cd", () => {
		assert.equal(
			resolveCommandCwd("cd /elsewhere/w && git commit -m 'x'", HOOK_CWD),
			"/elsewhere/w",
		);
	});

	it("reads git -C, which used to bypass the guard entirely (#751)", () => {
		assert.equal(
			resolveCommandCwd("git -C /elsewhere/w commit -m 'x'", HOOK_CWD),
			"/elsewhere/w",
		);
	});

	it("reads the explicit target carried by the Codex routine wrapper", () => {
		assert.equal(
			resolveCommandCwd(
				"/Users/example/.codex/bin/codex-git-routine.mjs stage-all /repo/sibling sibling",
				HOOK_CWD,
			),
			"/repo/sibling",
		);
	});

	it("applies repeated git -C options from left to right (#784)", () => {
		assert.equal(
			resolveCommandCwd(
				"git -C /worktrees/session -C ../sibling add -A",
				HOOK_CWD,
			),
			"/worktrees/session/../sibling",
		);
	});

	it("resolves the tree for guarded subcommands other than commit (#777)", () => {
		assert.equal(resolveCommandCwd("cd /a && git add -A", HOOK_CWD), "/a");
		assert.equal(resolveCommandCwd("git -C /b stash push", HOOK_CWD), "/b");
	});

	it("stops at the first guarded subcommand, not a later one", () => {
		assert.equal(
			resolveCommandCwd(
				"cd /a && git add -A && cd /b && git commit -m 'x'",
				HOOK_CWD,
			),
			"/a",
		);
	});

	it("lets git -C win over an earlier cd, since git resolves last", () => {
		assert.equal(
			resolveCommandCwd("cd /a && git -C /b commit -m 'x'", HOOK_CWD),
			"/b",
		);
	});

	it("uses the cd in effect where the commit runs, not a later one", () => {
		assert.equal(
			resolveCommandCwd("cd /a && git commit -m 'x' && cd /b", HOOK_CWD),
			"/a",
		);
	});

	it("strips quotes around a cd path", () => {
		assert.equal(
			resolveCommandCwd("cd '/a b/w' && git commit -m 'x'", HOOK_CWD),
			"/a b/w",
		);
	});

	it("keeps shell syntax literal inside single-quoted cd paths", () => {
		assert.equal(
			resolveCommandCwd("cd '$SIBLING' && git commit -m 'x'", HOOK_CWD),
			"/repo/$SIBLING",
		);
		assert.equal(
			resolveCommandCwd("cd -- '/tmp/`literal`' && git add -A", HOOK_CWD),
			"/tmp/`literal`",
		);
	});

	it("leaves the cwd unresolved when the path is not statically known", () => {
		assert.equal(
			resolveCommandCwd("cd $WORKTREE && git commit -m 'x'", HOOK_CWD),
			null,
		);
		assert.equal(
			resolveCommandCwd("cd ~/works/x && git commit -m 'x'", HOOK_CWD),
			null,
		);
		assert.equal(
			resolveCommandCwd("cd \"$WORKTREE\" && git commit -m 'x'", HOOK_CWD),
			null,
		);
	});

	it("follows cd with an end-of-options marker or a redirection", () => {
		assert.equal(
			resolveCommandCwd("cd -- /elsewhere/w && git add -A", HOOK_CWD),
			"/elsewhere/w",
		);
		assert.equal(
			resolveCommandCwd("cd /elsewhere/w >/dev/null && git add -A", HOOK_CWD),
			"/elsewhere/w",
		);
	});

	it("leaves the cwd unresolved for a bare cd, which means the home directory", () => {
		assert.equal(resolveCommandCwd("cd && git commit -m 'x'", HOOK_CWD), null);
	});

	it("ignores a cd inside a quoted string", () => {
		assert.equal(
			resolveCommandCwd("echo 'cd /a' && git commit -m 'x'", HOOK_CWD),
			HOOK_CWD,
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
			"same",
		);
		assert.equal(classifyTargetRepository(session, session), "same");
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

	it("allows add -A in an explicitly addressed feature checkout without inferring ownership", () => {
		assert.deepEqual(
			evaluateMainCommitGuard(payload({ command: "git add -A" }), {
				currentBranch: "feature/other",
				targetRelation: "same",
			}),
			{ decision: "allow" },
		);
	});

	it("still denies staging on the default branch of another worktree (#1201)", () => {
		const result = evaluateMainCommitGuard(payload({ command: "git add -A" }), {
			currentBranch: "main",
			targetRelation: "sibling",
		});
		assert.equal(result.decision, "deny");
	});

	it("allows restore src/x.ts in an explicitly addressed feature checkout without inferring ownership", () => {
		assert.deepEqual(
			evaluateMainCommitGuard(payload({ command: "git restore src/x.ts" }), {
				currentBranch: "feature/other",
				targetRelation: "same",
			}),
			{ decision: "allow" },
		);
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
	it("requires unmodeled wrappers to use the direct operation form", () => {
		for (const [command, expected] of [
			["rtk git -C /feature add -- file.txt", "deny"],
			["rtk git -C /repo add -- file.txt", "deny"],
			["rtk git -C /feature commit --no-verify -m message", "deny"],
			[
				"rtk git -C /feature -c core.hooksPath=/tmp/hooks commit -m message",
				"deny",
			],
			["rtk git add -- file.txt", "deny"],
			["rtk --unknown git -C /feature add -- file.txt", "deny"],
		]) {
			const result = runMainCommitGuard(
				JSON.stringify(payload({ command, cwd: "/repo" })),
				{
					supportsAsk: false,
					payloadCwdIsExecutionCwd: false,
					resolveBranches: (_payload, cwd) => ({
						currentBranch: cwd === "/repo" ? "main" : "feature",
						targetRelation: "sibling",
					}),
				},
			);
			assert.equal(
				result.output?.hookSpecificOutput.permissionDecision ?? "allow",
				expected,
				command,
			);
		}
	});
	it("uses explicit Git targets rather than Codex's starting root", () => {
		const resolveBranches = (_payload, cwd) => ({
			currentBranch: cwd === "/repo" ? "main" : "feature",
			targetRelation: cwd === "/repo" ? "own" : "sibling",
		});
		for (const command of [
			"git -C /worktrees/feature add -A",
			"cd /worktrees/feature && git add -A",
			"env -C /worktrees/feature git add -A",
		]) {
			assert.deepEqual(
				runMainCommitGuard(JSON.stringify(payload({ command, cwd: "/repo" })), {
					resolveBranches,
					supportsAsk: false,
					payloadCwdIsExecutionCwd: false,
				}),
				{ shouldOutput: false },
				command,
			);
		}
		for (const command of ["git add -A", "git -C . add -A"]) {
			const result = runMainCommitGuard(
				JSON.stringify(payload({ command, cwd: "/worktrees/feature" })),
				{
					resolveBranches,
					supportsAsk: false,
					payloadCwdIsExecutionCwd: false,
				},
			);
			assert.equal(
				result.output?.hookSpecificOutput.permissionDecision,
				"deny",
				command,
			);
			assert.match(
				result.output.hookSpecificOutput.permissionDecisionReason,
				/absolute/i,
			);
		}
	});

	it("checks every explicit target and refuses a later main mutation", () => {
		const visited = [];
		const result = runMainCommitGuard(
			JSON.stringify(
				payload({
					command: "git -C /worktrees/feature add -A && cd /repo && git add -A",
					cwd: "/repo",
				}),
			),
			{
				supportsAsk: false,
				payloadCwdIsExecutionCwd: false,
				resolveBranches: (_payload, cwd) => {
					visited.push(cwd);
					return {
						currentBranch: cwd === "/repo" ? "main" : "feature",
						targetRelation: "sibling",
					};
				},
			},
		);
		assert.deepEqual(visited, ["/worktrees/feature", "/repo"]);
		assert.equal(result.output.hookSpecificOutput.permissionDecision, "deny");
	});
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
			"git add -A && cd /worktrees/sibling && git add -A",
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
			assert.equal(shouldOutput, false);
			assert.equal(output, undefined);
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
				command: "git add -A && git -C /repo restore tracked.txt",
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
			payloadCwdIsExecutionCwd: false,
		});
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
	});

	it("names the bypass flag too when the cwd is unresolved, so one retry fixes both (#1232)", () => {
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
		assert.match(reason, /cwd cannot be resolved/);
		assert.match(reason, /--no-verify/);
		assert.match(reason, /drop/i);
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
		{ payloadCwd = session, claudeProjectDir = session, environment = {} } = {},
	) {
		const env = { ...process.env, ...environment };
		if (claudeProjectDir === null) delete env.CLAUDE_PROJECT_DIR;
		else env.CLAUDE_PROJECT_DIR = claudeProjectDir;
		return execFileSync(process.execPath, [script], {
			encoding: "utf8",
			env,
			input: JSON.stringify(payload({ command, cwd: payloadCwd })),
		}).trim();
	}

	const decision = (output) =>
		output ? JSON.parse(output).hookSpecificOutput.permissionDecision : "allow";
	it("checks explicit feature, main, foreign and bypass targets in both harness adapters", () => {
		for (const claudeProjectDir of [session, null]) {
			for (const [target, expected] of [
				[session, "allow"],
				[sibling, "allow"],
				[repo, "deny"],
				[unrelated, "allow"],
			]) {
				assert.equal(
					decision(runWrapper(`git -C ${target} add -A`, { claudeProjectDir })),
					expected,
				);
			}
			assert.equal(
				decision(
					runWrapper(`git -C ${sibling} commit --no-verify -m x`, {
						claudeProjectDir,
					}),
				),
				"deny",
			);
			assert.equal(
				decision(
					runWrapper(`git -C ${repo} restore tracked.txt`, {
						claudeProjectDir,
					}),
				),
				claudeProjectDir === null ? "deny" : "ask",
			);
		}
	});
	it("resolves Claude execution cwd independently from its project root", () => {
		assert.equal(runWrapper("git add -A", { payloadCwd: sibling }), "");
		assert.equal(
			decision(runWrapper("git add -A", { claudeProjectDir: null })),
			"deny",
		);
	});
	it("retains the installed routine's explicit target during migration", () => {
		const command = `/Users/example/.codex/bin/codex-git-routine.mjs stage-all ${sibling} sibling`;
		assert.equal(runWrapper(command, { claudeProjectDir: null }), "");
	});
	it("rejects state setters and clears without simulating success or shell mode", () => {
		for (const setup of [
			"set -a; GIT_CONFIG_COUNT=1 :",
			"set -o posix; GIT_DIR=/override :",
			"readonly GIT_DIR=/override; unset GIT_DIR",
			"source setup.sh; unset GIT_DIR",
			"unset GIT_DIR",
			"export FOO=x",
			"read -r REPLY",
		]) {
			assert.equal(
				decision(runWrapper(`${setup}; git -C ${session} add -A`)),
				"deny",
				setup,
			);
		}
	});
	it("rejects ambient redirection and configuration overrides", () => {
		for (const variable of [
			"GIT_DIR",
			"GIT_INDEX_FILE",
			"GIT_CONFIG_COUNT",
			"GIT_CONFIG_PARAMETERS",
			"GIT_CONFIG_GLOBAL",
			"GIT_CONFIG_SYSTEM",
		]) {
			assert.equal(
				decision(
					runWrapper(`git -C ${session} add -A`, {
						environment: { [variable]: "/override" },
					}),
				),
				"deny",
				variable,
			);
		}
	});
	it("preserves physical symlink traversal when Git applies repeated chdir", () => {
		const alias = join(root, "alias");
		symlinkSync(session, alias);
		assert.equal(
			decision(runWrapper(`git -C ${alias}/../repo add -A`)),
			"deny",
		);
	});
	it("requires branch changes to precede protected operations in a separate call", () => {
		assert.equal(
			decision(
				runWrapper(`git -C ${session} switch main && git -C ${session} add -A`),
			),
			"deny",
		);
		assert.equal(
			decision(
				runWrapper(
					`git -C ${session} branch -m main && git -C ${session} add -A`,
				),
			),
			"deny",
		);
	});
});
