// Uses Git and gh themselves as the oracle for the guard classifiers: each
// command form runs against a disposable fixture and the observed effect,
// not a description of the parser, decides what the guards must return.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	evaluateDelegationGuard,
	splitSegments,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";
import { findMergeCommand } from "./external-operation-policy.mjs";
import { runMainCommitGuard } from "./main-commit-guard.mjs";

const GIT_ENV = {
	...process.env,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.test",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.test",
	GIT_TERMINAL_PROMPT: "0",
	GIT_EDITOR: "true",
};

function run(cwd, args, input) {
	return spawnSync("git", args, {
		cwd,
		env: GIT_ENV,
		encoding: "utf8",
		input: input ?? "",
	});
}

function must(cwd, ...args) {
	const result = run(cwd, args);
	assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

// The default branch `main` is free (not checked out anywhere), so a command
// that enters or rewrites it is observable instead of failing on Git's own
// checked-out-elsewhere refusal.
function buildFixture(root) {
	const origin = join(root, "origin.git");
	const primary = join(root, "primary");
	must(root, "init", "-q", "--bare", "-b", "main", origin);
	must(root, "init", "-q", "-b", "main", primary);
	writeFileSync(join(primary, "file.txt"), "one\n");
	writeFileSync(join(primary, "main"), "path named like the branch\n");
	must(primary, "add", "-A");
	must(primary, "commit", "-qm", "one");
	must(primary, "tag", "v1");
	must(primary, "remote", "add", "origin", origin);
	must(primary, "push", "-q", "origin", "main", "v1");
	must(primary, "commit", "-q", "--allow-empty", "-m", "origin-only");
	must(primary, "push", "-q", "origin", "main");
	must(primary, "reset", "-q", "--hard", "HEAD~1");
	must(primary, "fetch", "-q", "origin");
	must(primary, "branch", "other");
	must(primary, "branch", "sib");
	must(primary, "switch", "-q", "-c", "home");
	must(primary, "worktree", "add", "-q", "-b", "topic", "../feature");
	must(primary, "worktree", "add", "-q", "../sibling", "sib");
	const feature = join(root, "feature");
	must(feature, "commit", "-q", "--allow-empty", "-m", "topic work");
	writeFileSync(join(feature, "file.txt"), "stashed\n");
	must(feature, "stash", "push", "-q");
	writeFileSync(join(feature, "file.txt"), "dirty\n");
	return { primary, feature, sibling: join(root, "sibling") };
}

function readIf(path) {
	return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function snapshot({ primary, feature, sibling }) {
	const gitDir = join(primary, ".git");
	const refs = new Map(
		must(primary, "for-each-ref", "--format=%(refname) %(objectname)")
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split(" ")),
	);
	const worktreesDir = join(gitDir, "worktrees");
	const worktrees = existsSync(worktreesDir)
		? readdirSync(worktreesDir)
				.sort()
				.map((name) =>
					[
						name,
						readIf(join(worktreesDir, name, "gitdir")),
						readIf(join(worktreesDir, name, "locked")),
					].join("|"),
				)
		: [];
	const index = (wt) =>
		existsSync(wt) ? run(wt, ["ls-files", "-s"]).stdout : null;
	return {
		refs,
		featureHead: readIf(join(worktreesDir, "feature", "HEAD")),
		otherHeads: [
			readIf(join(gitDir, "HEAD")),
			readIf(join(worktreesDir, "sibling", "HEAD")),
		].join("|"),
		worktrees: worktrees.join("\n"),
		config: readIf(join(gitDir, "config")),
		stashLog: readIf(join(gitDir, "logs", "refs", "stash")),
		otherIndexes: [index(primary), index(sibling)].join("|"),
		featureIndex: index(feature),
		featureFiles: readdirSync(feature)
			.filter((name) => name !== ".git")
			.sort()
			.map((name) => `${name}=${readIf(join(feature, name))}`)
			.join("|"),
	};
}

const OWN = "refs/heads/topic";

// Shared state is what an own-feature executor must not change: existing
// local branches other than its own, other checkouts, worktree metadata,
// stash, and repository configuration beyond a branch it just created.
// Remote-tracking refs and tags are outside the guard's policy.
function compare(before, after) {
	const changes = [];
	const shared = [];
	for (const name of new Set([...before.refs.keys(), ...after.refs.keys()])) {
		if (before.refs.get(name) === after.refs.get(name)) continue;
		changes.push(name);
		if (!name.startsWith("refs/heads/") && name !== "refs/stash") continue;
		const created = !before.refs.has(name);
		if (name === OWN || (created && name !== "refs/heads/main")) continue;
		shared.push(name);
	}
	const createdBranches = [...after.refs.keys()]
		.filter((name) => name.startsWith("refs/heads/") && !before.refs.has(name))
		.map((name) => name.slice("refs/heads/".length));
	if (before.featureHead !== after.featureHead) {
		changes.push("feature HEAD");
		// Entering the default branch, or a branch another checkout holds, lets
		// later commits move a ref this executor does not own.
		const entered = after.featureHead
			?.trim()
			.replace(/^ref: refs\/heads\//, "");
		if (["main", "home", "sib"].includes(entered))
			shared.push(`feature HEAD entered ${entered}`);
	}
	if (before.featureIndex !== after.featureIndex) changes.push("feature index");
	if (before.featureFiles !== after.featureFiles) changes.push("feature files");
	for (const key of ["otherHeads", "worktrees", "stashLog", "otherIndexes"])
		if (before[key] !== after[key]) {
			changes.push(key);
			shared.push(key);
		}
	if (before.config !== after.config) {
		changes.push("config");
		const ownSection = (line) =>
			createdBranches.some((name) => line.startsWith(`[branch "${name}"]`));
		const strip = (text) => {
			// Drop the sections of branches this command created; they are own.
			const out = [];
			let skipping = false;
			for (const line of (text ?? "").split("\n")) {
				if (line.startsWith("[")) skipping = ownSection(line);
				if (!skipping && line.trim()) out.push(line);
			}
			return out.join("\n");
		};
		if (strip(before.config) !== strip(after.config)) shared.push("config");
	}
	return { changes, shared };
}

const quote = (arg) =>
	/^[A-Za-z0-9_./:=@%+,^~-]+$/.test(arg)
		? arg
		: `'${arg.replace(/'/g, `'\\''`)}'`;

function commandText(args, input) {
	const git = ["git", ...args].map(quote).join(" ");
	return input === undefined
		? git
		: `printf '%s\\n' ${quote(input.trimEnd())} | ${git}`;
}

function parentDecision(command, cwd) {
	const result = runMainCommitGuard(
		JSON.stringify({ tool_name: "Bash", cwd, tool_input: { command } }),
		{
			resolveBranches: () => ({
				currentBranch: "topic",
				mainBranch: "main",
				targetRelation: "own",
			}),
			supportsAsk: true,
		},
	);
	return result.output?.hookSpecificOutput.permissionDecision ?? "allow";
}

function childDecision(command) {
	return evaluateDelegationGuard(
		{
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			agent_id: "agent_child",
			agent_type: "worker",
			tool_input: { command },
		},
		{ supportsAsk: false },
	).decision;
}

const cross = (...lists) =>
	lists.reduce(
		(acc, list) => acc.flatMap((a) => list.map((b) => [...a, ...b])),
		[[]],
	);

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
];

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
];

test("guards agree with Git's observed effects for every command form", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-guard-oracle-"));
	const template = join(root, "template");
	const work = join(root, "work");
	try {
		mkdirSync(work);
		const paths = buildFixture(work);
		cpSync(work, template, { recursive: true });
		const pristine = snapshot(paths);
		const violations = [];
		const seen = new Set();
		let dirty = false;
		for (const { args, input } of FORMS) {
			const command = commandText(args, input);
			if (seen.has(command)) continue;
			seen.add(command);
			// Most forms fail or only read, so restore only after an observed change.
			if (dirty) {
				rmSync(work, { recursive: true, force: true });
				cpSync(template, work, { recursive: true });
			}
			const result = run(paths.feature, args, input);
			const { changes, shared } = compare(pristine, snapshot(paths));
			dirty = changes.length > 0;
			const parent = parentDecision(command, paths.feature);
			const child = childDecision(command);
			const observed = `exit ${result.status}; changed [${changes.join(", ")}]`;
			if (shared.length && parent === "allow")
				violations.push(
					`parent allows shared effect [${shared.join(", ")}]: ${command} (${observed})`,
				);
			if (changes.length && child === "allow")
				violations.push(`child allows effect: ${command} (${observed})`);
		}
		for (const { args } of CHILD_READS) {
			const command = commandText(args);
			if (childDecision(command) !== "allow")
				violations.push(`child denies read: ${command}`);
		}
		assert.deepEqual(violations, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
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
