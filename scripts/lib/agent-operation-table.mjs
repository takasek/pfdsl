// Finite policy data shared by the hook entry and acceptance tests.
export const AGENT_OPERATION_AXES = Object.freeze({
	subject: ["claude-parent", "claude-subagent", "codex-parent", "codex-child"],
	health: ["healthy", "failed"],
	target: [
		"own",
		"primary",
		"other-live",
		"other-unowned",
		"foreign",
		"scratch",
		"unresolved",
	],
	operationClass: ["R", "W", "B", "D", "S", "C", "X", "O", "P", "U"],
	kind: ["file", "git", "remote"],
	scope: ["repository", "external"],
});

// Columns: own, primary, other-live, other-unowned, foreign, scratch, unresolved.
// A = allow, Q = ask, D = deny, U = deny with a rewrite destination.
export const AGENT_OPERATION_TABLE = Object.freeze(
	Object.fromEntries(
		Object.entries({
			R: ["A", "A", "A", "A", "A", "A", "A"],
			W: ["A", "D", "D", "D", "A", "A", "U"],
			B: ["A", "D", "D", "D", "A", "A", "U"],
			D: ["D", "D", "D", "D", "A", "A", "U"],
			S: ["D", "D", "D", "D", "A", "A", "U"],
			C: ["Q", "D", "D", "D", "A", "A", "U"],
			X: ["D", "D", "D", "D", "A", "A", "D"],
			O: ["A", "D", "D", "D", "A", "A", "U"],
			P: ["D", "D", "D", "D", "D", "D", "D"],
			U: ["U", "U", "U", "U", "U", "U", "U"],
		}).map(([key, row]) => [
			key,
			Object.freeze(
				Object.fromEntries(
					AGENT_OPERATION_AXES.target.map((target, i) => [target, row[i]]),
				),
			),
		]),
	),
);

export const DEFAULT_ALLOWED_AGENTS = Object.freeze(["issue-worker"]);

const SUBJECTS = {
	"claude-parent": { ask: "ask" },
	"claude-subagent": {
		ask: "deny",
		recovery: "parent",
		outwardAgents: DEFAULT_ALLOWED_AGENTS,
	},
	"codex-parent": { ask: "deny", recovery: "terminal" },
	"codex-child": { ask: "deny", recovery: "parent", fileOnly: true },
};
const REASONS = {
	R: "Read operation.",
	W: "Write only in your assigned linked worktree. Use native worktree creation for work; run git merge-tree --write-tree from your assigned worktree for a merge trial.",
	B: "Operate on free feature branches from your assigned linked worktree.",
	D: "The local default branch is protected. Use a feature branch or ask a human to run this in a terminal.",
	S: "Clearing the shared stash is reserved for a human terminal.",
	C: "Repository configuration changes require the parent or a human terminal.",
	X: "Verification bypass and external configuration writes require a human terminal.",
	O: "Return outward writes to the responsible parent in its assigned worktree.",
	P: "PR integration is reserved for a human terminal.",
	U: "Rewrite with a literal executable and an explicit absolute target; Codex Git writes require git -C <absolute-path>.",
};
const CLASS_PRIORITY = {
	P: 100,
	X: 90,
	D: 80,
	S: 70,
	U: 60,
	C: 50,
	O: 40,
	W: 30,
	B: 20,
	R: 10,
};
const SEVERITY = { allow: 0, ask: 1, deny: 2 };

// These are operation details of the two explicitly decided remove exceptions,
// not additional subjects, targets or operation classes.
const EXCEPTIONS = [
	{ match: { operationClass: "X", scope: "external" }, value: "D" },
	{
		match: { operationClass: "W", action: "worktree-remove", force: true },
		targets: [
			"primary",
			"other-live",
			"other-unowned",
			"foreign",
			"scratch",
			"unresolved",
		],
		value: "D",
		reason:
			"Do not force removal outside your assigned worktree. Retry without --force to clean up an other-unowned trial; Git will refuse remaining changes. A live owner's worktree still requires its owner or a human terminal.",
	},
	{
		match: {
			operationClass: "W",
			action: "worktree-remove",
			force: false,
			target: "other-unowned",
		},
		value: "A",
	},
];

export function parserRecoveryCommand(hookRoot) {
	if (typeof hookRoot !== "string" || !hookRoot.startsWith("/")) return null;
	const script = `${hookRoot.replace(/\/$/, "")}/scripts/setup-shell-parser.mjs`;
	return `node '${script.replaceAll("'", "'\\''")}'`;
}

function stopped(reason, recovery, operationClass = "U", decision = "deny") {
	return { decision, reason, recovery, operationClass };
}

export function combineDecisions(decisions) {
	return (
		[...decisions].sort(
			(a, b) =>
				SEVERITY[b.decision] - SEVERITY[a.decision] ||
				(CLASS_PRIORITY[b.operationClass] ?? 0) -
					(CLASS_PRIORITY[a.operationClass] ?? 0),
		)[0] ?? { decision: "allow" }
	);
}

/** Pure evaluation of the finite axes and the specification's overrides. */
export function decideOperation(input) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new TypeError(
			"An operation must be an object with finite table inputs.",
		);
	const cell = {
		health: "healthy",
		kind: "git",
		scope: "repository",
		...input,
	};
	const hasClasses = cell.classes !== undefined;
	for (const [key, values] of Object.entries(AGENT_OPERATION_AXES)) {
		if (key === "operationClass" && hasClasses && cell[key] === undefined)
			continue;
		if (!values.includes(cell[key]))
			throw new TypeError(`Invalid finite table input: ${key}.`);
	}
	if (
		hasClasses &&
		(!Array.isArray(cell.classes) ||
			cell.classes.length === 0 ||
			!cell.classes.every((value) =>
				AGENT_OPERATION_AXES.operationClass.includes(value),
			))
	)
		throw new TypeError(
			"classes must be a nonempty array of finite operation classes.",
		);
	if (cell.health === "failed") {
		const repair = parserRecoveryCommand(cell.hookRoot);
		if (cell.failure === "parser-missing" && repair && cell.command === repair)
			return { decision: "allow" };
		return stopped(
			cell.failure === "parser-missing"
				? `The pinned parser is missing. Run exactly: ${repair ?? "the fixed-root parser installer in a human terminal"}. Retry after the parser health check succeeds.`
				: "Policy or parser loading failed. Repair the installed helpers in a human terminal and retry.",
			cell.failure === "parser-missing" && repair ? "rewrite" : "terminal",
		);
	}
	if (hasClasses)
		return combineDecisions(
			cell.classes.map((operationClass) =>
				decideOperation({ ...cell, classes: undefined, operationClass }),
			),
		);
	if (cell.kind === "remote") cell.target = "own";
	const subject = SUBJECTS[cell.subject];
	if (
		cell.operationClass === "O" &&
		subject.outwardAgents &&
		!subject.outwardAgents.includes(cell.agentType)
	)
		return stopped(
			"Return outward writes to the parent. Publishing is the caller's responsibility.",
			"parent",
			"O",
		);
	const exception = EXCEPTIONS.find(
		({ match, targets }) =>
			Object.entries(match).every(([key, value]) => cell[key] === value) &&
			(!targets || targets.includes(cell.target)),
	);
	const value =
		exception?.value ?? AGENT_OPERATION_TABLE[cell.operationClass][cell.target];
	const permittedChild =
		cell.operationClass === "R" ||
		(cell.kind === "file" &&
			cell.operationClass === "W" &&
			cell.target === "own" &&
			!cell.gitMetadata);
	if (subject.fileOnly && !permittedChild)
		return stopped(
			"Return this operation to the parent. A Codex child may read or write ordinary files in its own worktree only.",
			"parent",
			cell.operationClass,
		);
	const outcomes = {
		A: { decision: "allow", operationClass: cell.operationClass },
		D: stopped(
			exception?.reason ?? REASONS[cell.operationClass],
			"terminal",
			cell.operationClass,
		),
		U: stopped(REASONS.U, "rewrite", cell.operationClass),
		Q: stopped(
			REASONS[cell.operationClass],
			subject.recovery ?? "terminal",
			cell.operationClass,
			subject.ask,
		),
	};
	return outcomes[value];
}
