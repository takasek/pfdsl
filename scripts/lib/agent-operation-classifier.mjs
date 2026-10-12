// Pure stage-one adapter: callers parse shell and observe Git/fs outside here.
// Injected ownership records must already be validated native evidence.
import { basename, isAbsolute, resolve } from "node:path";

const GIT_READ = new Set([
	"status",
	"log",
	"diff",
	"show",
	"rev-parse",
	"ls-files",
	"ls-tree",
	"show-ref",
	"merge-base",
	"cat-file",
	"describe",
	"blame",
	"grep",
	"help",
	"version",
]);
const GIT_WRITE = new Set([
	"add",
	"commit",
	"restore",
	"reset",
	"rebase",
	"merge",
	"cherry-pick",
	"revert",
	"clean",
	"am",
	"apply",
	"rm",
	"mv",
]);
const VALUE_FLAGS = new Set([
	"-m",
	"--message",
	"-F",
	"--file",
	"--author",
	"--date",
	"--body",
	"--body-file",
	"--title",
	"-R",
	"--repo",
	"--input",
	"--type",
	"-t",
	"--default",
	"--comment",
	"-X",
	"--method",
	"-f",
	"--raw-field",
	"--field",
	"--hostname",
	"-H",
	"--header",
]);
const CONFIG_READ = new Set([
	"get",
	"list",
	"--get",
	"--get-all",
	"--get-regexp",
	"--get-urlmatch",
	"--list",
	"-l",
]);
const GH_READ = {
	pr: ["view", "list", "status", "checks", "diff"],
	issue: ["view", "list", "status"],
	run: ["view", "list", "watch", "download"],
	repo: ["view", "list"],
	auth: ["status"],
	search: ["code", "commits", "issues", "prs", "repos"],
};
const GH_WRITE = {
	pr: ["create", "edit", "comment", "close", "reopen", "review", "merge"],
	issue: ["create", "edit", "comment", "close", "reopen"],
	repo: ["create", "edit", "delete"],
	release: ["create", "edit", "delete"],
};
const under = (path, root) =>
	path === root || path.startsWith(`${root.replace(/\/$/, "")}/`);

function physicalPath(path, facts) {
	const entries = Object.entries(facts.physicalPaths ?? {})
		.filter(([from]) => under(path, from))
		.sort((a, b) => b[0].length - a[0].length);
	const mapped = entries[0];
	return mapped ? `${mapped[1]}${path.slice(mapped[0].length)}` : path;
}

function pathFacts(path, facts) {
	if (!path || !isAbsolute(path))
		return { target: "unresolved", executionPath: null };
	const executionPath = physicalPath(resolve(path), facts);
	const tree = (facts.worktrees ?? [])
		.filter(({ root }) => under(executionPath, root))
		.sort((a, b) => b.root.length - a.root.length)[0];
	if (!tree) return { target: "scratch", executionPath };
	const checks = [
		[tree.commonDir !== facts.commonDir, "foreign"],
		[tree.primary, "primary"],
		[
			tree.ownership?.live && tree.ownership.ownerId !== facts.sessionId,
			"other-live",
		],
		[
			tree.root === facts.sessionRoot ||
				tree.ownership?.ownerId === facts.sessionId,
			"own",
		],
		[true, "other-unowned"],
	];
	return {
		target: checks.find(([matches]) => matches)[1],
		executionPath,
		tree,
	};
}

function scan(tokens, valueFlags = VALUE_FLAGS) {
	const operands = [];
	const flags = new Set();
	const values = [];
	let afterDash = false;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!afterDash && token.value === "--") {
			afterDash = true;
			continue;
		}
		if (!afterDash && token.value.startsWith("-")) {
			const equal = token.value.indexOf("=");
			const flag = equal > 0 ? token.value.slice(0, equal) : token.value;
			flags.add(flag);
			if (valueFlags.has(flag)) {
				const value =
					equal > 0
						? { ...token, value: token.value.slice(equal + 1) }
						: tokens[++i];
				if (value) values.push({ flag, ...value });
			}
		} else operands.push(token);
	}
	return { operands, flags, values };
}

function operation(classes, kind, location, extra = {}) {
	return {
		classes: [...new Set(classes)],
		kind,
		scope: "repository",
		executionPath: location?.executionPath ?? null,
		target: location?.target ?? "unresolved",
		...extra,
	};
}
const unresolved = (kind = "git", location) => operation(["U"], kind, location);
const defaultRef = (value, facts) =>
	value === facts.defaultBranch ||
	value === `refs/heads/${facts.defaultBranch}`;

function gitOperation(command, context, facts) {
	const tokens = command.tokens.slice(command.executableIndex ?? 0);
	let i = 1;
	let path = command.unresolvedCwd ? null : context.cwd;
	for (const cd of command.leadingCd ?? [])
		path = path ? resolve(path, cd) : null;
	let explicitAbsolute = false;
	let dynamicTarget = false;
	let bypass = false;
	while (i < tokens.length && tokens[i].value.startsWith("-")) {
		const value = tokens[i].value;
		if (["--help", "--version"].includes(value))
			return operation(["R"], "git", pathFacts(path, facts));
		if (value === "-C") {
			const target = tokens[++i];
			dynamicTarget ||= !target || Boolean(target.dynamic);
			explicitAbsolute = Boolean(
				target && !target.dynamic && isAbsolute(target.value),
			);
			path =
				!dynamicTarget && target
					? isAbsolute(target.value)
						? resolve(target.value)
						: path
							? resolve(path, target.value)
							: null
					: null;
		} else if (
			value === "-c" ||
			value === "--config-env" ||
			value.startsWith("--config-env=")
		) {
			const setting = value.startsWith("--config-env=")
				? value.slice("--config-env=".length)
				: tokens[++i]?.value;
			bypass ||= setting?.split("=")[0].toLowerCase() === "core.hookspath";
		} else if (
			![
				"--no-pager",
				"--paginate",
				"--literal-pathspecs",
				"--no-optional-locks",
			].includes(value)
		)
			return unresolved("git");
		i++;
	}
	const sub = tokens[i];
	if (!sub || sub.dynamic) return unresolved("git");
	const args = tokens.slice(i + 1);
	// -f is force for branches/worktrees, but a value flag for config and gh.
	const flagsWithValues = new Set(VALUE_FLAGS);
	if (sub.value !== "config") flagsWithValues.delete("-f");
	if (sub.value === "branch") flagsWithValues.delete("-m");
	if (["switch", "checkout"].includes(sub.value))
		for (const flag of ["-c", "-C", "--create", "--force-create", "-b", "-B"])
			flagsWithValues.add(flag);
	if (sub.value === "worktree")
		for (const flag of ["-b", "-B"]) flagsWithValues.add(flag);
	const parsed = scan(args, flagsWithValues);
	const { operands, flags } = parsed;
	const location = pathFacts(path, facts);
	if (flags.has("--help") || flags.has("--version") || flags.has("-h"))
		return operation(["R"], "git", location);
	let classes;
	let scope = "repository";
	let action;
	let force;
	let effective = location;
	if (GIT_READ.has(sub.value)) classes = ["R"];
	else if (GIT_WRITE.has(sub.value)) {
		classes = ["W"];
		if (
			[
				"commit",
				"rebase",
				"merge",
				"cherry-pick",
				"revert",
				"reset",
				"am",
			].includes(sub.value) &&
			location.tree?.branch === facts.defaultBranch
		)
			classes = ["D"];
	} else if (sub.value === "push") classes = ["O"];
	else if (sub.value === "stash")
		classes = [
			operands[0]?.value === "clear"
				? "S"
				: ["list", "show"].includes(operands[0]?.value)
					? "R"
					: "W",
		];
	else if (sub.value === "fetch") {
		const refs = operands.slice(1);
		classes = [refs.some(({ value }) => value.includes(":")) ? "B" : "R"];
		if (refs.some(({ value }) => defaultRef(value.split(":")[1], facts)))
			classes = ["D"];
		if (refs.some(({ dynamic }) => dynamic)) classes.push("U");
	} else if (
		["branch", "switch", "checkout", "update-ref"].includes(sub.value)
	) {
		const branchMutation = [...flags].some((flag) =>
			[
				"-m",
				"-M",
				"--move",
				"-c",
				"-C",
				"--copy",
				"-d",
				"-D",
				"--delete",
				"-f",
				"--force",
			].includes(flag),
		);
		classes = [
			sub.value === "branch" &&
			((!operands.length && !branchMutation) ||
				flags.has("--list") ||
				flags.has("-l"))
				? "R"
				: "B",
		];
		// Ref destinations differ from readable startpoints and pathspecs.
		// These are the ordinary branch forms in the finite acceptance corpus.
		let changedRefs = operands.slice(0, 1);
		if (sub.value === "branch") {
			if (["-m", "-M", "--move"].some((flag) => flags.has(flag)))
				changedRefs = [
					...(operands.length < 2 && location.tree?.branch
						? [{ value: location.tree.branch }]
						: []),
					...operands,
				];
			else if (["-d", "-D", "--delete"].some((flag) => flags.has(flag)))
				changedRefs = operands;
			else if (["-c", "-C", "--copy"].some((flag) => flags.has(flag)))
				changedRefs = operands.slice(-1);
		} else if (["switch", "checkout"].includes(sub.value)) {
			const created = parsed.values.find(({ flag }) =>
				["-c", "-C", "--create", "--force-create", "-b", "-B"].includes(flag),
			);
			if (created) changedRefs = [created];
		}
		if (
			(sub.value === "switch" || sub.value === "checkout") &&
			flags.has("--detach")
		) {
			classes = ["W"];
			changedRefs = [];
		}
		if (sub.value === "checkout" && args.some(({ value }) => value === "--")) {
			classes = ["W"];
			changedRefs = [];
		}
		if (
			changedRefs.some(({ value }) => defaultRef(value, facts)) &&
			!classes.includes("R")
		)
			classes = ["D"];
		if (changedRefs.some(({ dynamic }) => dynamic)) classes.push("U");
		const busy = changedRefs
			.map(({ value }) => facts.branches?.[value]?.checkedOutAt)
			.find((root) => root && root !== location.tree?.root);
		if (busy && !classes.includes("R") && !classes.includes("D"))
			effective = pathFacts(busy, facts);
	} else if (sub.value === "worktree") {
		const verb = operands[0]?.value;
		if (verb === "add") {
			const created = parsed.values.find(({ flag }) =>
				["-b", "-B"].includes(flag),
			);
			classes = [created && defaultRef(created.value, facts) ? "D" : "B"];
			if (created?.dynamic) classes.push("U");
		} else if (verb === "remove") {
			classes = ["W"];
			action = "worktree-remove";
			force = ["--force", "-f", "-ff"].some((flag) => flags.has(flag));
			const target = operands[1];
			effective = pathFacts(
				target && !target.dynamic && path ? resolve(path, target.value) : null,
				facts,
			);
		} else classes = [verb === "list" ? "R" : "U"];
	} else if (sub.value === "config") {
		scope =
			flags.has("--global") ||
			flags.has("--system") ||
			flags.has("--file") ||
			flags.has("-f")
				? "external"
				: "repository";
		const verb = operands[0]?.value;
		const read =
			CONFIG_READ.has(verb) ||
			[...flags].some((flag) => CONFIG_READ.has(flag)) ||
			(operands.length === 1 &&
				verb?.includes(".") &&
				!flags.has("--unset") &&
				!flags.has("--unset-all"));
		classes = [read ? "R" : "C"];
		if (
			!read &&
			(scope === "external" ||
				operands.some(({ value }) => value.toLowerCase() === "core.hookspath"))
		)
			classes.push("X");
	} else if (sub.value === "remote")
		classes = [
			["add", "set-url", "set-head", "remove", "rename"].includes(
				operands[0]?.value,
			)
				? "C"
				: ["show", "get-url", "-v"].includes(operands[0]?.value) ||
						!operands.length
					? "R"
					: "U",
		];
	else classes = ["U"];
	if (!classes.includes("R")) {
		if (
			bypass ||
			flags.has("--no-verify") ||
			((sub.value === "commit" || sub.value === "push") && flags.has("-n"))
		)
			classes.push("X");
		if (
			dynamicTarget ||
			effective.target === "unresolved" ||
			(context.subject.startsWith("codex-") && !explicitAbsolute)
		)
			classes.push("U");
		if (context.subject.startsWith("codex-") && !explicitAbsolute)
			effective = pathFacts(null, facts);
	}
	// U describes an operation whose ordinary class cannot be established at
	// an execution target. Keep independently established prohibitions only.
	if (classes.includes("U"))
		classes = classes.filter((klass) =>
			["U", "P", "X", "D", "S"].includes(klass),
		);
	return operation(classes, "git", effective, {
		scope,
		...(action ? { action, force } : {}),
	});
}

function ghOperation(tokens) {
	const args = tokens.slice(1);
	const parsed = scan(args);
	const { operands, flags, values } = parsed;
	const group = operands[0]?.value;
	const verb = operands[1]?.value;
	if (
		group === "help" ||
		flags.has("--help") ||
		flags.has("--version") ||
		flags.has("-h")
	)
		return operation(["R"], "remote", { target: "own" });
	if (group === "pr" && verb === "merge")
		return operation(["O", "P"], "remote", { target: "own" });
	if (group === "api") {
		const endpoint = operands[1]?.value;
		const method = values.find(
			({ flag }) => flag === "-X" || flag === "--method",
		)?.value;
		const fields = values.filter(({ flag }) =>
			["-f", "-F", "--field", "--raw-field", "--input"].includes(flag),
		);
		const query = fields
			.find(({ value }) => value.startsWith("query="))
			?.value.slice(6);
		const read = method
			? ["GET", "HEAD"].includes(method.toUpperCase())
			: !fields.length;
		const endpointPath = endpoint?.split("?")[0];
		const merge =
			(!read &&
				/(?:^|\/)repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/merge(?:-async)?\/?$/.test(
					endpointPath ?? "",
				)) ||
			/\b(?:mergePullRequest|enqueuePullRequest)\s*\(/.test(query ?? "");
		if (merge) return operation(["O", "P"], "remote", { target: "own" });
		if (endpoint === "graphql")
			return operation(
				[query && /^\s*(?:query\b|\{)/.test(query) ? "R" : "O"],
				"remote",
				{ target: "own" },
			);
		return operation([read ? "R" : "O"], "remote", { target: "own" });
	}
	if (GH_READ[group]?.includes(verb))
		return operation(["R"], "remote", { target: "own" });
	if (GH_WRITE[group]?.includes(verb))
		return operation(["O"], "remote", { target: "own" });
	return unresolved("remote");
}

function fileOperations(payload, context, facts) {
	const input = payload.tool_input;
	const tool = payload.tool_name;
	const read = tool === "Read";
	const patch =
		typeof input === "string" ? input : (input?.patch ?? input?.input);
	const paths =
		tool === "apply_patch"
			? typeof patch === "string"
				? [
						...patch.matchAll(
							/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm,
						),
					].map((match) => match[1])
				: []
			: [input?.file_path ?? input?.path];
	if (!paths.length) return [unresolved("file")];
	return paths.map((path) => {
		const missingAbsolute =
			tool === "apply_patch" &&
			context.subject.startsWith("codex-") &&
			!isAbsolute(path ?? "");
		const location = pathFacts(
			typeof path === "string" && !missingAbsolute
				? isAbsolute(path)
					? resolve(path)
					: context.cwd
						? resolve(context.cwd, path)
						: null
				: null,
			facts,
		);
		const gitMetadata = Boolean(
			location.executionPath?.split("/").includes(".git") ||
				(facts.gitMetadataPaths ?? []).some((root) =>
					under(location.executionPath ?? "", root),
				),
		);
		return operation(
			[read ? "R" : location.target === "unresolved" ? "U" : "W"],
			"file",
			location,
			{ gitMetadata },
		);
	});
}

/**
 * Classify a hook payload from injected shell, physical paths, worktrees,
 * validated native ownership and branch facts. Performs no IO and no expansion.
 * Codex's tool_input.workdir is deliberately not an observed execution target.
 */
export function classifyAgentOperations(payload, facts) {
	const subject = `${facts.harness === "codex" ? "codex" : "claude"}-${payload.agent_id ? (facts.harness === "codex" ? "child" : "subagent") : "parent"}`;
	const command = payload.tool_input?.command ?? payload.tool_input?.cmd;
	const failure =
		facts.failure ??
		(facts.shell?.failure === "syntax" ? null : facts.shell?.failure);
	const health = facts.health === "failed" || failure ? "failed" : "healthy";
	const context = {
		subject,
		health,
		failure,
		hookRoot: facts.hookRoot,
		command,
		cwd: payload.cwd ?? null,
	};
	let operations;
	if (["Read", "Edit", "Write", "apply_patch"].includes(payload.tool_name))
		operations = fileOperations(payload, context, facts);
	else if (payload.tool_name?.startsWith("mcp__")) {
		const klass = facts.mcpTools?.[payload.tool_name] ?? "U";
		operations = [
			operation(klass === "P" ? ["O", "P"] : [klass], "remote", {
				target: "own",
			}),
		];
	} else if (["Bash", "exec_command"].includes(payload.tool_name)) {
		operations = (facts.shell?.commands ?? [])
			.filter((node) => !node.isLeadingCd)
			.map((node) => {
				const executableIndex = node.executableIndex ?? 0;
				const head = node.tokens[executableIndex];
				if (head?.dynamic) return unresolved();
				const name = basename(head?.value ?? "");
				if (name === "git") return gitOperation(node, context, facts);
				if (name === "gh")
					return ghOperation(node.tokens.slice(executableIndex));
				if (name === "cd" && node.unresolvedCwd) return unresolved();
				// Other programs' contents and side effects are outside this policy.
				return null;
			})
			.filter(Boolean);
		if (
			!facts.shell ||
			facts.shell.error ||
			(health === "failed" && operations.length === 0)
		)
			operations.push(unresolved());
	} else operations = [unresolved("remote")];
	return { ...context, operations };
}
