// Pure operation adapter: callers parse shell and observe Git/fs outside here.
// Injected ownership records must already be validated native evidence.
import { basename, isAbsolute, resolve } from "node:path";
import {
	AGENT_OPERATION_INPUT_FORMS,
	decisionArgumentIssues,
	parseInputForm,
} from "./agent-operation-input-forms.mjs";
import { hasGitTargetEnvironment } from "./git-environment.mjs";

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
	"rev-list",
	"for-each-ref",
	"ls-remote",
	"check-ignore",
	"check-attr",
	"diff-tree",
	"shortlog",
	"range-diff",
	"patch-id",
	"count-objects",
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
// Recognize the caller's personal routine by filename only; it is not imported
// or executed here. Parent calls retain the routine's own policy boundary.
const ROUTINE_CHECKS = new Set([
	"build",
	"test",
	"typecheck",
	"node-test",
	"node-script",
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
	run: ["view", "list", "watch"],
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

function physicalPath(path, facts, followFinalSymlink = true) {
	const entries = Object.entries(
		(followFinalSymlink ? facts.physicalPaths : facts.physicalEntryPaths) ??
			facts.physicalPaths ??
			{},
	)
		.filter(([from]) => under(path, from))
		.sort((a, b) => b[0].length - a[0].length);
	const mapped = entries[0];
	return mapped ? `${mapped[1]}${path.slice(mapped[0].length)}` : path;
}

function pathFacts(path, facts, followFinalSymlink = true) {
	if (!path || !isAbsolute(path))
		return { target: "unresolved", executionPath: null };
	const executionPath = resolve(physicalPath(path, facts, followFinalSymlink));
	const tree = (facts.worktrees ?? [])
		.filter(({ root }) => under(executionPath, root))
		.sort((a, b) => b.root.length - a.root.length)[0];
	if (!tree) return { target: "scratch", executionPath, executionInput: path };
	const origin = facts.sessionRoot
		? resolve(physicalPath(facts.sessionRoot, facts))
		: null;
	const sessionTree = origin
		? (facts.worktrees ?? [])
				.filter(({ root }) => under(origin, root))
				.sort((a, b) => b.root.length - a.root.length)[0]
		: null;
	const checks = [
		[tree.commonDir !== facts.commonDir, "foreign"],
		[tree.primary, "primary"],
		[
			tree.ownership?.live && tree.ownership.ownerId !== facts.sessionId,
			"other-live",
		],
		[
			tree.root === sessionTree?.root ||
				(typeof facts.sessionId === "string" &&
					facts.sessionId.length > 0 &&
					tree.ownership?.ownerId === facts.sessionId),
			"own",
		],
		[true, "other-unowned"],
	];
	return {
		target: checks.find(([matches]) => matches)[1],
		executionPath,
		executionInput: path,
		tree,
	};
}

function scan(tokens, valueFlags = VALUE_FLAGS, legacyConfig = false) {
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
			const attached =
				!token.value.startsWith("--") &&
				token.value.length > 2 &&
				valueFlags.has(token.value.slice(0, 2));
			const flag = attached
				? token.value.slice(0, 2)
				: equal > 0
					? token.value.slice(0, equal)
					: token.value;
			flags.add(flag);
			if (valueFlags.has(flag)) {
				const value = attached
					? { ...token, value: token.value.slice(2) }
					: equal > 0
						? { ...token, value: token.value.slice(equal + 1) }
						: tokens[++i];
				if (value) values.push({ flag, ...value });
			}
		} else {
			if (legacyConfig && operands.length === 0 && token.value.includes("."))
				afterDash = true;
			operands.push(token);
		}
	}
	return { operands, flags, values };
}

function operation(classes, kind, location, extra = {}) {
	return {
		classes: [...new Set(classes)],
		kind,
		scope: "repository",
		executionPath: location?.executionPath ?? null,
		executionInput: location?.executionInput ?? null,
		target: location?.target ?? "unresolved",
		...extra,
	};
}
const unresolved = (kind = "git", location) => operation(["U"], kind, location);
const defaultRef = (value, facts) =>
	value === facts.defaultBranch ||
	value === `refs/heads/${facts.defaultBranch}`;

function withInputIssues(
	result,
	subcommand,
	parsed,
	sensitive = [],
	indirectFlags = [],
) {
	const issues = decisionArgumentIssues(parsed, sensitive, indirectFlags);
	if (issues.length)
		result.classes = [
			...new Set([
				...result.classes.filter((klass) =>
					["P", "X", "D", "S"].includes(klass),
				),
				"U",
			]),
		];
	if (result.classes.includes("U")) {
		result.subcommand = subcommand;
		result.unresolvedReasons = issues.length
			? issues
			: ["unresolved-target-or-command"];
		result.unknownOptions = parsed.unknownOptions;
	}
	return result;
}

function gitDecisionArguments(sub, parsed, classes) {
	const { operands, values } = parsed;
	const optionOperands = Object.values(
		AGENT_OPERATION_INPUT_FORMS[`git ${sub}`] ?? {},
	).some((option) => option.role === "decision")
		? operands.filter((token) => token.dynamic && !token.positionalOnly)
		: [];
	const at = (...indices) => indices.map((index) => operands[index]);
	const option = (...flags) =>
		values.filter(({ flag }) => flags.includes(flag));
	if (["branch", "switch", "checkout"].includes(sub))
		return classes.includes("R") || classes.includes("W")
			? []
			: [
					...operands,
					...option(
						"-b",
						"-B",
						"-c",
						"-C",
						"--create",
						"--force-create",
						"--set-upstream-to",
						"-u",
					),
				];
	if (["fetch", "pull"].includes(sub)) return operands.slice(1);
	if (sub === "update-ref") return at(0);
	if (
		["remote", "stash", "sparse-checkout", "submodule", "bisect"].includes(sub)
	)
		return at(0);
	if (sub === "config")
		return [
			operands[["get", "set", "unset"].includes(operands[0]?.value) ? 1 : 0],
		];
	if (sub === "symbolic-ref")
		return classes.includes("R") ? optionOperands : operands;
	if (sub === "init") return at(0);
	if (sub === "clone") return at(1);
	if (["archive", "format-patch"].includes(sub)) return option("-o");
	if (sub === "bundle")
		return operands[0]?.value === "create" ? at(0, 1) : at(0);
	if (sub === "worktree")
		return [
			...at(0),
			...(["add", "remove"].includes(operands[0]?.value) ? at(1) : []),
			...(operands[0]?.value === "add"
				? [...at(2), ...option("-b", "-B")]
				: []),
		];
	return optionOperands;
}

function gitOperation(command, context, facts) {
	const assignments = Object.fromEntries(
		command.tokens
			.slice(0, command.executableIndex ?? 0)
			.filter(({ value }) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value))
			.map(({ value }) => [
				value.slice(0, value.indexOf("=")),
				value.slice(value.indexOf("=") + 1),
			]),
	);
	const targetOverride =
		facts.gitTargetOverride ||
		command.unresolvedGitTarget ||
		hasGitTargetEnvironment(assignments);
	const tokens = command.tokens.slice(command.executableIndex ?? 0);
	let i = 1;
	let path = command.unresolvedCwd || targetOverride ? null : context.cwd;
	for (const cd of command.leadingCd ?? [])
		path = path
			? facts.cdPathOverride &&
				!isAbsolute(cd) &&
				!/^(?:\.\.?)(?:\/|$)/.test(cd)
				? null
				: isAbsolute(cd)
					? cd
					: `${path}/${cd}`
			: null;
	let explicitAbsolute = false;
	let dynamicTarget = Boolean(targetOverride);
	let bypass = false;
	const globalIssues = [];
	while (i < tokens.length && tokens[i].value.startsWith("-")) {
		const value = tokens[i].value;
		if (["--help", "--version"].includes(value))
			return operation(["R"], "git", pathFacts(path, facts));
		if (value === "-C") {
			const target = tokens[++i];
			globalIssues.push(
				...decisionArgumentIssues({ issues: [], flags: new Set() }, [target]),
			);
			dynamicTarget ||= !target || Boolean(target.dynamic);
			dynamicTarget ||= globalIssues.length > 0;
			explicitAbsolute = Boolean(
				target && !target.dynamic && isAbsolute(target.value),
			);
			path =
				!dynamicTarget && target
					? isAbsolute(target.value)
						? target.value
						: path
							? `${path}/${target.value}`
							: null
					: null;
		} else if (
			value === "-c" ||
			value === "--config-env" ||
			value.startsWith("--config-env=")
		) {
			const supplied = value.startsWith("--config-env=")
				? { ...tokens[i], value: value.slice("--config-env=".length) }
				: tokens[++i];
			const setting = supplied?.value;
			if (!supplied) globalIssues.push("missing-option-value");
			else {
				const key = setting.split("=")[0];
				globalIssues.push(
					...decisionArgumentIssues({ issues: [], flags: new Set() }, [
						{
							value: key,
							dynamic:
								supplied.dynamic && !/^[A-Za-z][A-Za-z0-9.-]*$/.test(key),
						},
					]),
				);
			}
			bypass ||= setting?.split("=")[0].toLowerCase() === "core.hookspath";
		} else if (
			![
				"--no-pager",
				"--paginate",
				"--literal-pathspecs",
				"--no-optional-locks",
			].includes(value)
		)
			return operation(bypass ? ["X", "U"] : ["U"], "git", null, {
				subcommand: "git",
				unresolvedReasons: ["unknown-option"],
				unknownOptions: /^--?[A-Za-z0-9][A-Za-z0-9-]*$/.test(
					value.split("=")[0],
				)
					? [value.split("=")[0]]
					: [],
			});
		i++;
	}
	const sub = tokens[i];
	if (!sub || sub.dynamic) return unresolved("git");
	const args = tokens.slice(i + 1);
	const parsed = parseInputForm(args, `git ${sub.value}`);
	parsed.issues.push(...globalIssues);
	const { operands, flags } = parsed;
	const location = pathFacts(path, facts);
	if (
		!parsed.issues.length &&
		(flags.has("--help") || flags.has("--version") || flags.has("-h"))
	)
		return operation(["R"], "git", location);
	let classes;
	let scope = "repository";
	let action;
	let force;
	let effective = location;
	let creation;
	let branchEffect;
	const destination = (token) =>
		pathFacts(
			token && !token.dynamic && path
				? isAbsolute(token.value)
					? token.value
					: `${path}/${token.value}`
				: null,
			facts,
		);
	if (
		["init", "clone", "archive", "bundle", "format-patch"].includes(sub.value)
	) {
		classes = ["W"];
		if (sub.value === "init")
			effective = operands.length ? destination(operands[0]) : location;
		else if (sub.value === "clone") effective = destination(operands[1]);
		else if (sub.value === "archive") {
			const output = parsed.values.find(({ flag }) =>
				["-o", "--output"].includes(flag),
			);
			if (output) effective = destination(output);
			else classes = ["R"];
		} else if (sub.value === "bundle") {
			if (operands[0]?.value === "create") effective = destination(operands[1]);
			else
				classes = [
					["list-heads", "verify"].includes(operands[0]?.value) ? "R" : "U",
				];
		} else {
			const output = parsed.values.find(({ flag }) =>
				["-o", "--output-directory"].includes(flag),
			);
			if (flags.has("--stdout")) classes = ["R"];
			else if (output) effective = destination(output);
		}
	} else if (sub.value === "reflog") {
		// Other literal operands are refs in Git's default show mode. Keep the
		// modifying modes unresolved; do not interpret any of their effects.
		const first = operands[0];
		classes = [
			first?.dynamic ||
			["expire", "delete", "drop", "write"].includes(first?.value)
				? "U"
				: "R",
		];
	} else if (sub.value === "symbolic-ref") {
		const writing =
			operands.length > 1 || flags.has("--delete") || flags.has("-d");
		classes = [
			!writing
				? "R"
				: operands.some(({ value }) => defaultRef(value, facts))
					? "D"
					: "U",
		];
	} else if (sub.value === "tag")
		classes = [
			flags.has("-l") || flags.has("--list") || !operands.length ? "R" : "B",
		];
	else if (sub.value === "hash-object") classes = [flags.has("-w") ? "W" : "R"];
	else if (sub.value === "commit-tree" || sub.value === "bisect")
		classes = ["W"];
	else if (sub.value === "sparse-checkout")
		classes = [
			operands[0]?.value === "list"
				? "R"
				: ["set", "add", "reapply", "disable", "init"].includes(
							operands[0]?.value,
						)
					? "W"
					: "U",
		];
	else if (sub.value === "submodule")
		classes = [
			!operands.length || ["status", "summary"].includes(operands[0]?.value)
				? "R"
				: operands[0]?.value === "update"
					? "W"
					: "U",
		];
	else if (sub.value === "pull") {
		const refs = operands.slice(1);
		classes = [
			location.tree?.branch === facts.defaultBranch ||
			refs.some(({ value }) => defaultRef(value.split(":")[1], facts))
				? "D"
				: "W",
		];
		if (refs.some(({ dynamic }) => dynamic)) classes.push("U");
	} else if (sub.value === "merge-tree")
		// The approved trial writes objects without changing a checkout or ref.
		// Keep that metadata write in W so Codex children return it to a parent.
		classes = [
			flags.has("--trivial-merge") && !flags.has("--write-tree") ? "R" : "W",
		];
	else if (GIT_READ.has(sub.value)) classes = ["R"];
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
				"--set-upstream-to",
				"-u",
				"--unset-upstream",
				"--edit-description",
			].includes(flag),
		);
		classes = [
			sub.value === "branch" &&
			((!operands.length && !branchMutation) ||
				[
					"--list",
					"-l",
					"-a",
					"-r",
					"--merged",
					"--no-merged",
					"--contains",
					"--no-contains",
					"--points-at",
				].some((flag) => flags.has(flag)))
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
			.map(
				({ value }) =>
					facts.branches?.[value.replace(/^refs\/heads\//, "")]?.checkedOutAt,
			)
			.find((root) => root && root !== location.tree?.root);
		if (busy && !classes.includes("R") && !classes.includes("D"))
			effective = pathFacts(busy, facts);
	} else if (sub.value === "worktree") {
		const verb = operands[0]?.value;
		if (verb === "add") {
			const created = parsed.values.find(({ flag }) =>
				["-b", "-B"].includes(flag),
			);
			const selected =
				created ??
				operands[2] ??
				(operands[1] && !operands[1].dynamic
					? { value: basename(operands[1].value) }
					: undefined);
			classes = [
				(created && defaultRef(created.value, facts)) ||
				(!created &&
					!flags.has("--detach") &&
					defaultRef(selected?.value, facts))
					? "D"
					: "B",
			];
			if (created?.dynamic) classes.push("U");
			const busy =
				!flags.has("--detach") && selected?.value
					? facts.branches?.[selected.value.replace(/^refs\/heads\//, "")]
							?.checkedOutAt
					: null;
			if (busy && busy !== location.tree?.root && !classes.includes("D"))
				branchEffect = operation(["B"], "git", pathFacts(busy, facts));
			const target = destination(operands[1]);
			const nested =
				["other-live", "other-unowned"].includes(target.target) &&
				target.executionPath !== target.tree?.root;
			creation = operation(
				[
					nested
						? "W"
						: target.target === "unresolved"
							? "U"
							: classes.includes("D")
								? "D"
								: "B",
				],
				"git",
				{
					...target,
					target:
						nested || target.target === "unresolved"
							? target.target
							: "scratch",
				},
			);
		} else if (verb === "remove") {
			classes = ["W"];
			action = "worktree-remove";
			force = ["--force", "-f", "-ff"].some((flag) => flags.has(flag));
			const target = operands[1];
			effective = pathFacts(
				target && !target.dynamic && path
					? isAbsolute(target.value)
						? target.value
						: `${path}/${target.value}`
					: null,
				facts,
			);
		} else classes = [verb === "list" ? "R" : verb === "prune" ? "W" : "U"];
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
			(["commit", "am"].includes(sub.value) && flags.has("-n"))
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
		if (targetOverride) effective = pathFacts(null, facts);
	}
	// U describes an operation whose ordinary class cannot be established at
	// an execution target. Keep independently established prohibitions only.
	if (classes.includes("U"))
		classes = classes.filter((klass) =>
			["U", "P", "X", "D", "S"].includes(klass),
		);
	const result = withInputIssues(
		operation(classes, "git", effective, {
			scope,
			...(action ? { action, force } : {}),
		}),
		`git ${sub.value}`,
		parsed,
		gitDecisionArguments(sub.value, parsed, classes),
		["fetch", "pull", "update-ref", "sparse-checkout"].includes(sub.value)
			? ["--stdin"]
			: [],
	);
	return creation
		? [
				result,
				...(branchEffect ? [branchEffect] : []),
				withInputIssues(
					creation,
					`git ${sub.value}`,
					parsed,
					gitDecisionArguments(sub.value, parsed, classes),
				),
			]
		: result;
}

function ghOperation(tokens) {
	const args = tokens.slice(1);
	const initial = scan(args);
	const initialGroup = initial.operands[0]?.value;
	const initialVerb = initial.operands[1]?.value;
	if (!initialGroup) {
		const root = parseInputForm(args, "gh");
		if (
			!root.issues.length &&
			["--help", "-h", "--version"].some((flag) => root.flags.has(flag))
		)
			return operation(["R"], "remote", { target: "own" });
		return withInputIssues(unresolved("remote"), "gh", root);
	}
	const valueFlags = new Set(VALUE_FLAGS);
	for (const flag of [
		"--description",
		"--color",
		"--name",
		"--notes",
		"--notes-file",
		"--add-label",
		"--reason",
		"--add-reviewer",
	])
		valueFlags.add(flag);
	if (initialGroup !== "api") valueFlags.delete("-f");
	if (["pr", "issue"].includes(initialGroup)) valueFlags.add("-b");
	if (initialGroup === "pr" && initialVerb === "merge") valueFlags.delete("-m");
	if (["repo", "label"].includes(initialGroup)) {
		valueFlags.add("-d");
		valueFlags.add("-n");
	}
	if (
		initialGroup === "repo" ||
		(initialGroup === "auth" && initialVerb === "logout")
	)
		valueFlags.add("-h");
	const name =
		initialGroup === "api" ? "gh api" : `gh ${initialGroup} ${initialVerb}`;
	const parsed = parseInputForm(args, name);
	const { operands, flags, values } = parsed;
	const group = operands[0]?.value;
	const verb = operands[1]?.value;
	if (!AGENT_OPERATION_INPUT_FORMS[name] && group !== "help")
		return unresolved("remote");
	const finish = (result, sensitive = [], indirectFlags = []) =>
		withInputIssues(result, name, parsed, sensitive, indirectFlags);
	if (
		group === "help" ||
		(!parsed.issues.length &&
			(flags.has("--help") ||
				flags.has("--version") ||
				(flags.has("-h") && !valueFlags.has("-h"))))
	)
		return operation(["R"], "remote", { target: "own" });
	if (group === "pr" && verb === "merge")
		return finish(operation(["O", "P"], "remote", { target: "own" }));
	if (group === "api") {
		const endpoint = operands[1]?.value;
		const method = values.findLast(
			({ flag }) => flag === "-X" || flag === "--method",
		)?.value;
		const fields = values.filter(({ flag }) =>
			["-f", "-F", "--field", "--raw-field", "--input"].includes(flag),
		);
		const query = fields
			.find(({ value }) => value.startsWith("query="))
			?.value.slice(6);
		const queryToken = fields.find(({ value }) => value.startsWith("query="));
		const sensitive = [
			operands[1],
			values.findLast(({ flag }) => ["-X", "--method"].includes(flag)),
			...fields.filter(
				(field) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(field.value),
			),
			...(queryToken
				? [{ ...queryToken, value: queryToken.value.slice(6) }]
				: []),
		];
		const read = method
			? ["GET", "HEAD"].includes(method.toUpperCase())
			: !fields.length;
		const endpointPath = endpoint?.split("?")[0];
		const merge =
			(!read &&
				/(?:^|\/)repos\/[^/]+\/[^/]+\/pulls\/[^/]+\/merge(?:-async)?\/?$/.test(
					endpointPath ?? "",
				)) ||
			/\b(?:mergePullRequest|enqueuePullRequest|enablePullRequestAutoMerge)\s*\(/.test(
				query ?? "",
			);
		if (merge)
			return finish(
				operation(["O", "P"], "remote", { target: "own" }),
				sensitive,
				["--input"],
			);
		if (endpoint === "graphql")
			return finish(
				operation(
					[query && /^\s*(?:query\b|\{)/.test(query) ? "R" : "O"],
					"remote",
					{ target: "own" },
				),
				sensitive,
				["--input"],
			);
		return finish(
			operation([read ? "R" : "O"], "remote", { target: "own" }),
			sensitive,
			["--input"],
		);
	}
	if (group === "run" && verb === "download")
		return finish(operation(["W"], "remote", { target: "own" }));
	if (GH_READ[group]?.includes(verb))
		return finish(operation(["R"], "remote", { target: "own" }));
	if (GH_WRITE[group]?.includes(verb))
		return finish(operation(["O"], "remote", { target: "own" }));
	return unresolved("remote");
}

function fileOperations(payload, context, facts) {
	const input = payload.tool_input;
	const tool = payload.tool_name;
	const read = tool === "Read";
	const patch =
		typeof input === "string"
			? input
			: (input?.patch ?? input?.input ?? input?.command);
	const paths =
		tool === "apply_patch"
			? typeof patch === "string"
				? [
						...patch.matchAll(
							/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm,
						),
					].map((match) => ({
						path: match[1],
						followFinalSymlink:
							!match[0].startsWith("*** Delete File:") &&
							!(
								match[0].startsWith("*** Update File:") &&
								patch
									.slice(match.index + match[0].length)
									.startsWith("\n*** Move to:")
							),
					}))
				: []
			: [{ path: input?.file_path ?? input?.path, followFinalSymlink: true }];
	if (!paths.length) return [unresolved("file")];
	return paths.map(({ path, followFinalSymlink }) => {
		const missingAbsolute =
			tool === "apply_patch" &&
			context.subject.startsWith("codex-") &&
			!isAbsolute(path ?? "");
		const location = pathFacts(
			typeof path === "string" && !missingAbsolute
				? isAbsolute(path)
					? path
					: context.cwd
						? `${context.cwd}/${path}`
						: null
				: null,
			facts,
			followFinalSymlink,
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
			{ gitMetadata, followFinalSymlink },
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
		agentType: payload.agent_type,
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
			.flatMap((node) => {
				if (node.unresolvedExecution) return unresolved();
				const executableIndex = node.executableIndex ?? 0;
				const head = node.tokens[executableIndex];
				if (head?.dynamic) return unresolved();
				const name = basename(head?.value ?? "");
				const args = node.tokens.slice(executableIndex + 1);
				const script = name === "node" && args[0]?.value === "--" ? 1 : 0;
				const routine =
					name === "codex-git-routine.mjs"
						? 0
						: name === "node" &&
								!args[script]?.dynamic &&
								basename(args[script]?.value ?? "") === "codex-git-routine.mjs"
							? script + 1
							: null;
				if (
					routine !== null &&
					subject === "codex-child" &&
					!ROUTINE_CHECKS.has(args[routine]?.value)
				)
					return operation(["W"], "git", { target: "own" });
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
