// Uses Git itself as the oracle for the guard classifiers: each command form
// runs against a disposable fixture, and the observed effect, not a
// description of the parser, decides what the guards must return.
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { evaluateDelegationGuard } from "./delegation-guard.mjs";
import { runMainCommitGuard } from "./main-commit-guard.mjs";

// Inherited GIT_DIR, GIT_INDEX_FILE and the like would point the fixture's
// destructive forms at whatever repository the test runner was started for.
const GIT_ENV = {
	...Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
	),
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.test",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.test",
	GIT_TERMINAL_PROMPT: "0",
	GIT_EDITOR: "true",
};

function runSync(cwd, args) {
	return spawnSync("git", args, {
		cwd,
		env: GIT_ENV,
		encoding: "utf8",
		input: "",
	});
}

function must(cwd, ...args) {
	const result = runSync(cwd, args);
	if (result.status !== 0)
		throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}

function runGit(cwd, args, input = "", env = {}) {
	return new Promise((resolve) => {
		const child = spawn("git", args, { cwd, env: { ...GIT_ENV, ...env } });
		let stdout = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.resume();
		const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
		child.on("close", (status, signal) => {
			clearTimeout(timer);
			resolve({ status: signal ? signal : status, stdout });
		});
		child.stdin.on("error", () => {});
		child.stdin.end(input);
	});
}

// By default `main` is free (not checked out anywhere), so a command that
// enters or rewrites it is observable instead of failing on Git's own
// checked-out-elsewhere refusal, and the feature checkout's previous branch is
// main, so `-` and `@{-1}` name it. With `mainCheckedOut` the primary holds
// main as in a real clone, which is where options that lift Git's own
// protection (`fetch -u`, `pull`) matter. `inc.cfg` beside the checkouts is a
// config file for `-c include.path=` forms.
export function buildFixture(root, { mainCheckedOut = false } = {}) {
	const origin = join(root, "origin.git");
	const primary = join(root, "primary");
	mkdirSync(root, { recursive: true });
	must(root, "init", "-q", "--bare", "-b", "main", origin);
	must(root, "init", "-q", "-b", "main", primary);
	writeFileSync(join(primary, "file.txt"), "one\n");
	writeFileSync(join(primary, "main"), "path named like the branch\n");
	must(primary, "add", "-A");
	must(primary, "commit", "-qm", "one");
	must(primary, "tag", "v1");
	must(primary, "remote", "add", "origin", origin);
	must(primary, "push", "-q", "origin", "main", "v1");
	// Origin's main changes file contents, so a forced update of a checked-out
	// main leaves its index and files out of step and is observable there too.
	writeFileSync(join(primary, "file.txt"), "origin\n");
	must(primary, "commit", "-qam", "origin-only");
	must(primary, "push", "-q", "origin", "main");
	must(primary, "reset", "-q", "--hard", "HEAD~1");
	must(primary, "fetch", "-q", "origin");
	must(primary, "branch", "other");
	must(primary, "branch", "sib");
	if (!mainCheckedOut) must(primary, "switch", "-q", "-c", "home");
	must(primary, "worktree", "add", "-q", "-b", "topic", "../feature");
	must(primary, "worktree", "add", "-q", "../sibling", "sib");
	// Stale metadata for `worktree prune`, and a symbolic ref for
	// `symbolic-ref --delete`, so their forms have something to remove.
	must(primary, "worktree", "add", "-q", "--detach", "../gone");
	rmSync(join(root, "gone"), { recursive: true, force: true });
	must(primary, "symbolic-ref", "refs/heads/alias", "refs/heads/other");
	writeFileSync(
		join(root, "inc.cfg"),
		'[remote "origin"]\n\tfetch = +refs/heads/*:refs/heads/*\n',
	);
	const feature = join(root, "feature");
	if (!mainCheckedOut) {
		must(feature, "switch", "-q", "main");
		must(feature, "switch", "-q", "topic");
	}
	must(feature, "commit", "-q", "--allow-empty", "-m", "topic work");
	writeFileSync(join(feature, "file.txt"), "stashed\n");
	must(feature, "stash", "push", "-q");
	writeFileSync(join(feature, "file.txt"), "dirty\n");
	return { primary, feature, sibling: join(root, "sibling") };
}

function readIf(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		// Missing, or a directory such as a slash-separated branch's parent.
		return null;
	}
}

async function snapshot({ primary, feature, sibling }) {
	const gitDir = join(primary, ".git");
	const index = async (wt) =>
		existsSync(wt) ? (await runGit(wt, ["ls-files", "-s"])).stdout : null;
	const [refList, primaryIndex, siblingIndex, featureIndex] = await Promise.all(
		[
			runGit(primary, ["for-each-ref", "--format=%(refname) %(objectname)"]),
			index(primary),
			index(sibling),
			index(feature),
		],
	);
	const refs = new Map(
		refList.stdout
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
		// Any branch reflog, so a reflog-only write is still an effect.
		branchLogs: existsSync(join(gitDir, "logs", "refs", "heads"))
			? readdirSync(join(gitDir, "logs", "refs", "heads"), { recursive: true })
					.sort()
					.map((name) =>
						[name, readIf(join(gitDir, "logs", "refs", "heads", name))].join(
							"=",
						),
					)
					.join("|")
			: null,
		otherIndexes: [primaryIndex, siblingIndex].join("|"),
		featureIndex,
		featureFiles: existsSync(feature)
			? readdirSync(feature)
					.filter((name) => name !== ".git")
					.sort()
					.map((name) => `${name}=${readIf(join(feature, name))}`)
					.join("|")
			: null,
	};
}

const OWN = "refs/heads/topic";
// A case-insensitive filesystem resolves MAIN to the loose main ref file.
const SHARED_BRANCHES = ["main", "home", "sib"];

// Shared state is what an own-feature executor must not change: existing
// local branches other than its own, other checkouts, worktree metadata,
// stash, and repository configuration beyond a branch it just created.
// Remote-tracking refs and tags are outside the guard's policy.
export function compare(before, after) {
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
			.replace(/^ref: refs\/heads\//, "")
			.toLowerCase();
		if (SHARED_BRANCHES.includes(entered))
			shared.push(`feature HEAD entered ${entered}`);
	}
	if (before.featureIndex !== after.featureIndex) changes.push("feature index");
	if (before.featureFiles !== after.featureFiles) changes.push("feature files");
	if (before.branchLogs !== after.branchLogs) changes.push("branch reflogs");
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

export const quote = (arg) =>
	/^[A-Za-z0-9_./:=@%+,^~-]+$/.test(arg)
		? arg
		: `'${arg.replace(/'/g, `'\\''`)}'`;

// `env` is written as a prefix assignment, or with `exported` as an earlier
// `export` statement in the same command line.
export function commandText(args, input, env = {}, exported = false) {
	const assignments = Object.entries(env).map(
		([name, value]) => `${name}=${quote(value)}`,
	);
	const call = ["git", ...args].map(quote).join(" ");
	const git =
		exported && assignments.length
			? `export ${assignments.join(" ")}; ${call}`
			: [...assignments, call].join(" ");
	return input === undefined
		? git
		: `printf '%s\\n' ${quote(input.trimEnd())} | ${git}`;
}

// Forms name the fixture root as `{root}` and an object as `{oid:<rev>}`;
// each worker substitutes its own.
function substitute(value, root, primary) {
	return value
		.replaceAll("{root}", root)
		.replace(/\{oid:([^}]+)\}/g, (_, rev) => must(primary, "rev-parse", rev));
}

export function parentDecision(command, cwd) {
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

export function childDecision(command) {
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

export const cross = (...lists) =>
	lists.reduce(
		(acc, list) => acc.flatMap((a) => list.map((b) => [...a, ...b])),
		[[]],
	);

/**
 * Every option `git <subcommand> -h` documents, with its arity, read from Git
 * itself so the forms cover options nobody thought to list.
 * @returns {{long?: string, short?: string, negatable: boolean, arity: "none" | "required" | "optional"}[]}
 */
export function gitOptions(subcommand) {
	const help = runSync(process.cwd(), [...[subcommand].flat(), "-h"]).stdout;
	const options = [];
	for (const line of help.split("\n")) {
		const match = line.match(
			/^ {4}(?:-([A-Za-z0-9]))?(?:, )?(?:--(\[no-\])?([a-z0-9][a-z0-9-]*))?(.*)$/,
		);
		if (!match || (!match[1] && !match[3])) continue;
		const rest = match[4];
		options.push({
			short: match[1] ? `-${match[1]}` : undefined,
			long: match[3] ? `--${match[3]}` : undefined,
			negatable: Boolean(match[2]),
			arity: /^\[=/.test(rest)
				? "optional"
				: /^ </.test(rest)
					? "required"
					: "none",
		});
	}
	return options;
}

/**
 * Each documented option spelled every way Git accepts it, placed before the
 * operands: alone, consuming the next token as its value, attached, and
 * negated, and followed by its own negation, since the last occurrence wins
 * and cancels any exemption granted for the first. Values are plain words the
 * guard might mistake for an operand, one free-form, one numeric and one enum
 * value (`--conflict merge`) so that Git accepts the option instead of
 * rejecting the whole command.
 */
export function optionSpellings(subcommand, values = ["x", "1", "merge"]) {
	const spellings = [];
	const options = gitOptions(subcommand);
	const longs = options.flatMap(({ long, negatable }) =>
		long ? [long, ...(negatable ? [`--no-${long.slice(2)}`] : [])] : [],
	);
	// Short options without a value combine into one cluster, in either order.
	const flags = options
		.filter(({ short, arity }) => short && arity === "none")
		.map(({ short }) => short.slice(1));
	for (const a of flags)
		for (const b of flags) if (a !== b) spellings.push([`-${a}${b}`]);
	for (const { short, long, negatable, arity } of options) {
		// parse-options accepts the shortest prefix no other long option shares.
		const prefix = long
			? Array.from({ length: long.length - 3 }, (_, i) =>
					long.slice(0, i + 3),
				).find(
					(candidate) =>
						longs.filter((name) => name.startsWith(candidate)).length === 1,
				)
			: undefined;
		if (prefix)
			spellings.push(arity === "required" ? [prefix, values[0]] : [prefix]);
		if (negatable && long && arity !== "required") {
			const negation = `--no-${long.slice(2)}`;
			spellings.push([long, negation]);
			if (short) spellings.push([short, negation]);
		}
		if (arity === "required") {
			for (const value of values) {
				if (long) spellings.push([long, value], [`${long}=${value}`]);
				if (short) spellings.push([short, value], [`${short}${value}`]);
			}
		} else {
			if (long) spellings.push([long]);
			if (short) spellings.push([short]);
			if (arity === "optional" && long)
				for (const value of values) spellings.push([`${long}=${value}`]);
		}
		if (negatable && long) spellings.push([`--no-${long.slice(2)}`]);
	}
	return spellings;
}

/**
 * Runs every form in a fresh-state fixture and returns the invariant
 * violations: a shared effect the parent allows, any effect the child allows,
 * a listed read the child denies, and a form Git did not finish (a timeout
 * observes nothing, so it must not count as safe). `sharedObserved` lists the
 * kinds of shared effect some form actually produced, so a caller can require
 * that its forms exercised what they claim to protect. A form marked
 * `parentAllows` is ordinary work the parent must not ask about or deny.
 */
export async function observeForms(
	root,
	forms,
	{ childReads = [], mainCheckedOut = false } = {},
) {
	const unique = [];
	const seen = new Set();
	for (const form of forms) {
		const command = commandText(form.args, form.input, form.env, form.exported);
		if (seen.has(command)) continue;
		seen.add(command);
		unique.push({ ...form, command });
	}
	const workers = Math.max(1, Math.min(8, unique.length));
	const violations = [];
	const sharedObserved = new Set();
	let next = 0;
	await Promise.all(
		Array.from({ length: workers }, async (_, id) => {
			const base = join(root, `w${id}`);
			const work = join(base, "work");
			const template = join(base, "template");
			const paths = buildFixture(work, { mainCheckedOut });
			await cp(work, template, { recursive: true });
			const pristine = await snapshot(paths);
			let dirty = false;
			while (next < unique.length) {
				const form = unique[next++];
				// Most forms fail or only read, so restore only after a change.
				if (dirty) {
					await rm(work, { recursive: true, force: true });
					await cp(template, work, { recursive: true });
				}
				const args = form.args.map((arg) =>
					substitute(arg, work, paths.primary),
				);
				const env = Object.fromEntries(
					Object.entries(form.env ?? {}).map(([name, value]) => [
						name,
						substitute(value, work, paths.primary),
					]),
				);
				const command = commandText(args, form.input, env, form.exported);
				const result = await runGit(paths.feature, args, form.input, env);
				const { changes, shared } = compare(pristine, await snapshot(paths));
				dirty = changes.length > 0;
				for (const kind of shared)
					sharedObserved.add(kind.replace(/^feature HEAD entered /, "enter "));
				const parent = parentDecision(command, paths.feature);
				const child = childDecision(command);
				const observed = `exit ${result.status}; changed [${changes.join(", ")}]`;
				if (typeof result.status !== "number")
					violations.push(`Git did not finish: ${form.command} (${observed})`);
				if (form.parentAllows && parent !== "allow")
					violations.push(
						`parent ${parent}s ordinary work: ${form.command} (${observed})`,
					);
				if (shared.length && parent === "allow")
					violations.push(
						`parent allows shared effect [${shared.join(", ")}]: ${form.command} (${observed})`,
					);
				if (changes.length && child === "allow")
					violations.push(`child allows effect: ${form.command} (${observed})`);
			}
		}),
	);
	for (const { args } of childReads) {
		const command = commandText(args);
		if (childDecision(command) !== "allow")
			violations.push(`child denies read: ${command}`);
	}
	return { violations: violations.sort(), sharedObserved: [...sharedObserved] };
}
