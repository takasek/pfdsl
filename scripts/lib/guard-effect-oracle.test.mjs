// Uses Git and gh themselves as the oracle for the guard classifiers: each
// command form runs against a disposable fixture and the observed effect,
// not a description of the parser, decides what the guards must return.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	splitSegments,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";
import { findMergeCommand } from "./external-operation-policy.mjs";
import {
	cross,
	observeForms,
	optionSpellings,
	parentDecision,
	quote,
} from "./guard-effect-oracle-harness.mjs";

// Read forms a Codex child must be able to run (each is also checked against
// the oracle for being free of effects).
const CHILD_READS = [
	...[
		[],
		["--list"],
		["-a"],
		["-r"],
		["-v"],
		["-vv"],
		["--show-current"],
		["--format=%(refname:short)"],
		["--format", "%(refname:short)"],
		["--sort=refname"],
		["--sort", "refname"],
		["--merged"],
		["--merged", "HEAD"],
		["--no-merged", "HEAD"],
		["--contains", "HEAD"],
		["--points-at", "HEAD"],
		["--sort=-committerdate", "--format=%(refname:short)"],
	].map((rest) => ({ args: ["branch", ...rest] })),
	...[["get", "user.name"], ["list"], ["--get", "user.name"], ["--list"]].map(
		(rest) => ({ args: ["config", ...rest] }),
	),
	...[
		["reflog"],
		["reflog", "show"],
		["-c", "color.ui=never", "log", "-1"],
	].map((args) => ({ args })),
];

// Ordinary parent work: reads that carry `-c`, and isolated creation spelled
// with long options. The parent must not ask about or deny any of these.
const ORDINARY = [
	["-c", "color.ui=never", "grep", "one"],
	["-c", "color.ui=never", "blame", "file.txt"],
	["-c", "color.ui=never", "shortlog", "-sn", "HEAD"],
	["-c", "color.ui=never", "ls-remote", "origin"],
	["-c", "color.ui=never", "log", "-1"],
	["branch", "-q", "newb"],
	["branch", "--quiet", "newb"],
	["branch", "--create-reflog", "newb"],
	["switch", "-c", "newb"],
	["checkout", "-b", "newb"],
	["fetch", "origin"],
	["push", "origin", "topic"],
	["reflog"],
	["reflog", "show"],
	// Git's reflog verbs are a closed set; any other first word is a ref to show.
	["reflog", "HEAD"],
	["reflog", "main"],
	["reflog", "refs/stash"],
	// These move only remote-tracking refs, which the contract leaves out.
	["remote", "update"],
	["remote", "prune", "origin"],
	["remote", "prune", "-n", "origin"],
	["fetch", "--prune", "origin"],
	["tag"],
	["tag", "-l"],
	["notes", "list"],
	["-c", "pager.tag=false", "tag", "-l"],
	["-c", "color.ui=never", "notes", "list"],
].map((args) => ({ args, parentAllows: true }));

const BRANCH_OPTIONS = [
	[],
	["--list"],
	["-l"],
	["-a"],
	["-r"],
	["-v"],
	["-vv"],
	["-q"],
	["--format=%(refname)"],
	["--format", "%(refname)"],
	["--sort=refname"],
	["--sort", "refname"],
	["--column"],
	["--no-column"],
	["--merged"],
	["--merged", "HEAD"],
	["--no-merged", "HEAD"],
	["--contains", "HEAD"],
	["--points-at", "HEAD"],
	["--track"],
	["--no-track"],
	["-f"],
	["--force"],
	// parse-options accepts any unique prefix of a long option.
	["--forc"],
	["--del"],
	["--mov"],
	["--cop"],
	["--unset-up"],
	["--edit-d"],
	["--set-u=main"],
	["--cont", "HEAD"],
	["--form=%(refname)"],
];
const BRANCH_OPERANDS = [
	[],
	["newb"],
	["newb", "HEAD"],
	["other"],
	["other", "HEAD"],
	["other", "renamed"],
	["main", "HEAD"],
	["main", "topic"],
];

const FETCH_OPTIONS = [
	[],
	["-n"],
	["-qn"],
	["--no-tags"],
	["--dry-run"],
	["--dry"],
	["-u"],
	["--update-head-ok"],
	["--update-h"],
	["-q", "--update-head-ok"],
	["--refm=+refs/heads/*:refs/heads/*"],
];
const FETCH_TARGETS = [
	["origin"],
	["origin", "main"],
	["origin", "main:main"],
	["origin", "+main:main"],
	["origin", "main:refs/heads/main"],
	["origin", "main:other"],
	["origin", "main:newb"],
	["origin", "main:refs/remotes/origin/x"],
	[".", "+topic:main"],
	[".", "+topic:refs/heads/main"],
];
const STDIN_REFSPECS = [
	"main:main",
	"+refs/heads/main:refs/heads/main",
	"+refs/heads/topic:refs/heads/main",
	"main:refs/remotes/origin/x",
];

const CHECKOUT_OPTIONS = [
	[],
	["-q"],
	["-f"],
	["--ignore-other-worktrees"],
	["--ignore-oth"],
];
// Resetting a branch nobody has checked out (`-B other`) is deliberately
// outside these forms: the guard treats it as isolated creation.
const CHECKOUT_OPERANDS = [
	["sib"],
	["sib", "--"],
	["-B", "sib"],
	["-C", "sib"],
	["--force-c", "sib"],
	["--force-c=main", "HEAD"],
	["--force-c", "main", "HEAD"],
	["--force-create=main", "HEAD"],
	["--det", "main"],
	["main"],
	["main", "--"],
	["--", "main"],
	["main", "--", "file.txt"],
	["--", "file.txt"],
	["other"],
	["other", "--"],
	["--", "other"],
	["--detach", "main"],
	["--detach", "main", "--"],
];

const FORMS = [
	...cross([["branch"]], BRANCH_OPTIONS, BRANCH_OPERANDS).map((args) => ({
		args,
	})),
	...cross([["fetch"]], FETCH_OPTIONS, FETCH_TARGETS).map((args) => ({ args })),
	...cross([["--stdin"], ["--std"]], FETCH_OPTIONS, [
		["origin"],
		["."],
	]).flatMap((rest) =>
		STDIN_REFSPECS.map((input) => ({
			args: ["fetch", ...rest],
			input: `${input}\n`,
		})),
	),
	...cross([["checkout"], ["switch"]], CHECKOUT_OPTIONS, CHECKOUT_OPERANDS).map(
		(args) => ({ args }),
	),
	...[
		["get", "user.name"],
		["list"],
		["--get", "user.name"],
		["--list"],
		["-l"],
		["set", "x.y", "1"],
		["x.y", "1"],
		["--add", "x.y", "1"],
		["--ad", "x.y", "1"],
		["unset", "user.name"],
		["--unset", "user.name"],
		["--unset-a", "user.name"],
		["remote.origin.fetch", "+refs/heads/main:refs/heads/main"],
	].map((rest) => ({ args: ["config", ...rest] })),
	...[
		["list"],
		["add", "-h"],
		["add", "../wt-new"],
		["add", "--detach", "../wt-detach", "HEAD"],
		["add", "-b", "wt-branch", "../wt-branch", "HEAD"],
		["prune"],
		["prune", "-n"],
		["lock", "../sibling"],
	].map((rest) => ({ args: ["worktree", ...rest] })),
	...[["list"], ["show"], ["push", "-q"], ["drop", "-q"], ["clear"]].map(
		(rest) => ({ args: ["stash", ...rest] }),
	),
	...[
		["update-ref", "refs/heads/main", "HEAD"],
		["update-ref", "refs/heads/newb", "HEAD"],
		["symbolic-ref", "HEAD"],
		["symbolic-ref", "HEAD", "refs/heads/main"],
		["status", "--short"],
		["log", "-1", "--oneline"],
	].map((args) => ({ args })),
	...CHILD_READS,
	...ORDINARY,
];

// The forms above are hand-picked; these come from Git's own option tables,
// so an option value read as the operand, a negation that cancels an
// exemption, or an option nobody listed is covered without being named.
const OPTION_FORMS = [
	...["checkout", "switch"].flatMap((subcommand) =>
		cross([[subcommand]], optionSpellings(subcommand), [
			["main"],
			["MAIN"],
			["-"],
			["@{-1}"],
			["main", "--"],
		]),
	),
	...cross([["fetch"]], [[], ["--dry-run"]], optionSpellings("fetch"), [
		["origin", "main:other"],
	]),
	...cross([["branch"]], optionSpellings("branch"), [
		["other", "HEAD"],
		["newb"],
	]),
	// A value that names a real program lets `--receive-pack`/`--exec` run.
	...cross([["push"]], optionSpellings("push", ["x", "git-receive-pack"]), [
		[".", "+HEAD:other"],
		["../primary", "+HEAD:other"],
	]),
	...cross([["symbolic-ref"]], optionSpellings("symbolic-ref"), [
		["refs/heads/alias"],
		["HEAD", "refs/heads/main"],
	]),
	...cross([["remote"]], optionSpellings("remote"), [
		["add", "newremote", "{root}/origin.git"],
		["set-url", "origin", "{root}/elsewhere.git"],
		["remove", "origin"],
	]),
	...cross([["worktree", "prune"]], optionSpellings(["worktree", "prune"]), [
		[],
	]),
].map((args) => ({ args }));

async function withRoot(run) {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-guard-oracle-"));
	try {
		return await run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

// Configuration supplied on the command line changes what this very call
// writes; an innocuous-looking key can pull in any setting through include.
const REFSPEC = "+refs/heads/*:refs/heads/*";
const INJECTIONS = [
	{ pre: [] },
	{ pre: ["-c", `remote.origin.fetch=${REFSPEC}`] },
	{ pre: ["-c", "include.path={root}/inc.cfg"] },
	{ pre: ["--config-env=remote.origin.fetch=RS"], env: { RS: REFSPEC } },
	...[false, true].map((exported) => ({
		pre: [],
		env: {
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "remote.origin.fetch",
			GIT_CONFIG_VALUE_0: REFSPEC,
		},
		exported,
	})),
];
const FETCHES = [
	["fetch", "origin"],
	["fetch", "-u", "origin"],
	["fetch", "-qu", "origin"],
	["fetch", "--update-head-ok", "origin"],
	["pull", "--no-rebase", "origin"],
	["pull", "--no-rebase", "origin", "main"],
];
// Representative spellings of this repository as a push destination from the
// feature checkout: its gitfile, relative and absolute paths, and a file URL.
const LOCAL_REPOSITORIES = [
	".",
	"./",
	".git",
	".git/",
	"./.git",
	"../primary",
	"../primary/.git",
	"{root}/primary",
	"file://{root}/primary",
];
// Writers of the protected refs other than the branch/checkout/fetch forms.
const LOCAL_WRITERS = [
	...cross(
		[["push"]],
		LOCAL_REPOSITORIES.map((repository) => [repository]),
		[["HEAD:other"], ["+HEAD:other"], [":other"], ["+HEAD:main"]],
	),
	["pull", "--no-rebase", "origin", "main:other"],
	["pull", "--no-rebase", ".", "topic:other"],
	["reflog", "expire", "--expire=now", "--all"],
	["reflog", "expire", "--expire=now", "refs/stash"],
	["reflog", "delete", "refs/stash@{0}"],
	["reflog", "write", "refs/stash", "{oid:stash}", "{oid:HEAD}", "injected"],
	["reflog", "write", "refs/heads/other", "{oid:other}", "{oid:HEAD}", "x"],
	// Display options can write directly to protected files, even on failure.
	...cross(
		[["reflog"]],
		[[], ["show"], ["HEAD"], ["main"], ["refs/stash"]],
		[
			["--output={root}/primary/.git/config"],
			["--output", "{root}/primary/.git/config"],
			["--output={root}/primary/.git/config", "--no-output"],
		],
	),
	// Remote settings written outside `git config` are repository config too.
	["remote", "add", "--mirror=fetch", "m", "{root}/origin.git"],
	["remote", "set-url", "origin", "{root}/elsewhere.git"],
	["remote", "rename", "origin", "renamed"],
	["remote", "remove", "origin"],
	["checkout", "-B", "other"],
	["checkout", "-B", "other", "HEAD"],
	["switch", "-C", "other"],
	["switch", "--force-create", "other"],
	// Outside the protected set for now, but a child must still not run them.
	["notes", "add", "-m", "x"],
	["replace", "HEAD", "HEAD~1"],
];
const LAYOUT_FORMS = [
	...INJECTIONS.flatMap(({ pre, env, exported }) =>
		FETCHES.map((rest) => ({ args: [...pre, ...rest], env, exported })),
	),
	...LOCAL_WRITERS.map((args) => ({ args })),
];

async function observe(forms, options) {
	return withRoot((root) => observeForms(root, forms, options));
}

// Each test also requires that its forms actually produced the shared effects
// it exists to guard, so a fixture that no longer exercises them fails.
function assertExercised(sharedObserved, required) {
	assert.deepEqual(
		required.filter((kind) => !sharedObserved.includes(kind)),
		[],
		`forms no longer produce these shared effects: observed ${sharedObserved.join(", ")}`,
	);
}

test("guards agree with Git's observed effects for every listed form", async () => {
	const { violations, sharedObserved } = await observe(FORMS, {
		childReads: CHILD_READS,
	});
	assert.deepEqual(violations, []);
	assertExercised(sharedObserved, [
		"refs/heads/main",
		"refs/heads/other",
		"refs/heads/sib",
		"refs/stash",
		"enter main",
		"enter sib",
		"worktrees",
		"stashLog",
		"config",
	]);
});

test("guards agree with Git's observed effects for every documented option", async () => {
	assert.ok(OPTION_FORMS.length > 500, "Git's option tables were not read");
	const { violations, sharedObserved } = await observe(OPTION_FORMS);
	assert.deepEqual(violations, []);
	assertExercised(sharedObserved, ["refs/heads/other", "enter main"]);
});

test("guards agree with Git's observed effects when main is free", async () => {
	const { violations, sharedObserved } = await observe(LAYOUT_FORMS);
	assert.deepEqual(violations, []);
	assertExercised(sharedObserved, [
		"refs/heads/main",
		"refs/heads/other",
		"stashLog",
	]);
});

test("guards agree with Git's observed effects when the primary holds main", async () => {
	const { violations, sharedObserved } = await observe(LAYOUT_FORMS, {
		mainCheckedOut: true,
	});
	assert.deepEqual(violations, []);
	assertExercised(sharedObserved, [
		"refs/heads/main",
		"refs/heads/other",
		"stashLog",
	]);
});

test("config tracking agrees with the shell's unset variable modes", () => {
	for (const options of [
		[],
		["-v"],
		["--"],
		["-v", "--"],
		["-f"],
		["-f", "--"],
	]) {
		const prefix = `export GIT_CONFIG_COUNT=1; unset ${options.join(" ")} GIT_CONFIG_COUNT; `;
		const actual = spawnSync(
			"bash",
			[
				"--noprofile",
				"--norc",
				"-c",
				`${prefix}printf '%s' "\${GIT_CONFIG_COUNT-unset}"`,
			],
			{
				env: Object.fromEntries(
					Object.entries(process.env).filter(
						([name]) => !name.startsWith("GIT_"),
					),
				),
				encoding: "utf8",
			},
		);
		assert.equal(actual.status, 0, actual.stderr);
		assert.equal(
			parentDecision(`${prefix}git fetch origin`, "/repo/feature"),
			actual.stdout === "unset" ? "allow" : "ask",
			prefix,
		);
	}
});

// gh decides by its own flag parser whether `--help` is a help request or an
// option's value. A help request prints usage and exits 0, while a real
// command stops at authentication. Every layer below keeps it from reaching
// GitHub even if one of them failed: no config or token, a host that does not
// resolve, a dead proxy, and a cwd outside any repository.
const GH_FORMS = [
	...[
		["--help"],
		["-h"],
		["1", "--help"],
		["1", "--body", "--help"],
		["1", "-b", "--help"],
		["1", "--body=--help"],
		["1", "--subject", "--help"],
		["1", "-t", "--help"],
		["1", "-A", "--help"],
		["1", "--author-email", "--help"],
		["1", "-F", "--help"],
		["1", "--match-head-commit", "--help"],
		["1", "-R", "invalid.example/o/r", "--help"],
		["1", "--repo", "--help"],
		["1", "--squash", "--help"],
		["1", "-s", "--body", "x", "--help"],
		["1", "--bod", "--help"],
		["1", "--unknown-flag", "--help"],
		["1", "--", "--help"],
	].map((rest) => ["pr", "merge", "-R", "invalid.example/o/r", ...rest]),
	...[
		["--help"],
		["-X", "PUT", "--help"],
		["-X", "--help"],
		["--method", "--help"],
		["-X", "PUT", "--jq", "--help"],
		["-X", "PUT", "-q", "--help"],
		["-X", "PUT", "-H", "--help"],
		["-X", "PUT", "-f", "--help"],
		["-X", "PUT", "--input", "--help"],
		["-X", "PUT", "--", "--help"],
	].map((rest) => [
		"api",
		"--hostname",
		"invalid.example",
		"repos/o/r/pulls/1/merge",
		...rest,
	]),
];

const ghAvailable = spawnSync("gh", ["--version"]).status === 0;

test("merge detection agrees with gh's own help parsing", {
	skip: !ghAvailable && "gh is not installed",
}, () => {
	const scratch = mkdtempSync(join(tmpdir(), "pfdsl-gh-oracle-"));
	const config = join(scratch, "config");
	mkdirSync(config);
	const env = {
		...process.env,
		GH_CONFIG_DIR: config,
		GH_HOST: "invalid.example",
		GH_PROMPT_DISABLED: "1",
		HTTPS_PROXY: "http://127.0.0.1:9",
		HTTP_PROXY: "http://127.0.0.1:9",
		https_proxy: "http://127.0.0.1:9",
		http_proxy: "http://127.0.0.1:9",
	};
	for (const name of [
		"GH_TOKEN",
		"GITHUB_TOKEN",
		"GH_ENTERPRISE_TOKEN",
		"GITHUB_ENTERPRISE_TOKEN",
		"GH_REPO",
		"NO_PROXY",
		"no_proxy",
	])
		delete env[name];
	const gh = (args) =>
		spawnSync("gh", args, { cwd: scratch, env, encoding: "utf8", input: "" });
	try {
		assert.notEqual(
			gh(["auth", "status"]).status,
			0,
			"gh must be unauthenticated in the oracle environment",
		);
		const violations = [];
		for (const args of GH_FORMS) {
			const result = gh(args);
			const help = result.status === 0 && /USAGE/.test(result.stdout);
			const command = ["gh", ...args].map(quote).join(" ");
			const detected = findMergeCommand(command, {
				splitSegments,
				tokenize,
				stripLeadingNoise,
			});
			if (!help && !detected)
				violations.push(
					`not detected as merge: ${command} (exit ${result.status})`,
				);
		}
		assert.deepEqual(violations, []);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
