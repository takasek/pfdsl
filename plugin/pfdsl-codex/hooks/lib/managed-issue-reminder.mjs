// DO NOT EDIT. Authoritative source: hooks/lib/managed-issue-reminder.mjs.
// Candidate-H decision logic for the PostToolUse managed-issue reminder.

const CREATED_ISSUE_URL = /https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/;
const LABEL_FLAGS = ["--label", "-l"];
const GLOBAL_FLAGS_WITH_VALUE = new Set(["-R", "--repo"]);

function splitCommandChain(command) {
	const segments = [];
	let current = "";
	let quote = null;
	const push = (separator) => {
		segments.push({ command: current, separator });
		current = "";
	};
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote) {
			if (ch === "\\" && quote === '"') {
				current += ch + (command[i + 1] ?? "");
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "\\") {
			current += ch + (command[i + 1] ?? "");
			i++;
			continue;
		}
		const two = command.slice(i, i + 2);
		if (two === "&&" || two === "||") {
			push(two);
			i++;
			continue;
		}
		if (ch === ";" || ch === "|" || ch === "&" || ch === "\n") {
			push(ch);
			continue;
		}
		if (ch === "(" || ch === ")") {
			push(ch);
			continue;
		}
		current += ch;
	}
	push(null);
	return segments;
}

function hasOutputRedirect(command) {
	let quote = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote) {
			if (ch === "\\" && quote === '"') {
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === ">") return true;
	}
	return false;
}

function tokenize(segment) {
	const tokens = [];
	let current = "";
	let quote = null;
	let quoted = false;
	const flush = () => {
		if (current !== "" || quoted) tokens.push({ value: current, quoted });
		current = "";
		quoted = false;
	};
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];
		if (quote) {
			if (ch === quote) {
				quote = null;
				continue;
			}
			current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			quoted = true;
			continue;
		}
		if (/\s/.test(ch)) {
			flush();
			continue;
		}
		current += ch;
	}
	flush();
	return tokens;
}

function stripLeadingNoise(tokens) {
	let index = 0;
	while (index < tokens.length) {
		const value = tokens[index].value;
		if (!tokens[index].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
			index++;
			continue;
		}
		if (["sudo", "command", "nohup", "time", "env"].includes(value)) {
			index++;
			continue;
		}
		break;
	}
	return tokens.slice(index);
}

function parseGhCommand(tokens) {
	if (tokens.length === 0) return null;
	const head = tokens[0];
	if (head.quoted || head.value !== "gh") return null;
	const args = tokens.slice(1).map((token) => token.value);
	const nextOperand = (from) => {
		for (let i = from; i < args.length; i++) {
			const value = args[i];
			if (!value.startsWith("-")) return i;
			if (GLOBAL_FLAGS_WITH_VALUE.has(value)) i++;
		}
		return -1;
	};
	const groupIndex = nextOperand(0);
	if (groupIndex === -1) return null;
	const verbIndex = nextOperand(groupIndex + 1);
	return {
		group: args[groupIndex],
		verb: verbIndex === -1 ? null : args[verbIndex],
		args,
	};
}

function flagValues(args, flags) {
	const values = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const inline = flags.find((flag) => arg.startsWith(`${flag}=`));
		if (inline) {
			values.push(arg.slice(inline.length + 1));
			continue;
		}
		const attachedShort = flags.find(
			(flag) =>
				flag.length === 2 &&
				arg.startsWith(flag) &&
				arg.length > flag.length,
		);
		if (attachedShort) {
			values.push(arg.slice(attachedShort.length));
			continue;
		}
		if (!flags.includes(arg)) continue;
		const next = args[i + 1];
		if (next === undefined || next.startsWith("-")) continue;
		values.push(next);
		i++;
	}
	return values;
}

export function createsManagedIssue(command) {
	if (typeof command !== "string" || command.trim() === "") return false;
	const segments = splitCommandChain(command);
	const [first, ...following] = segments;
	if (hasOutputRedirect(first.command)) return false;
	const parsed = parseGhCommand(stripLeadingNoise(tokenize(first.command)));
	if (!parsed || parsed.group !== "issue" || parsed.verb !== "create")
		return false;
	const labels = flagValues(parsed.args, LABEL_FLAGS).flatMap((value) =>
		value.split(","),
	);
	if (!labels.includes("flow:managed")) return false;

	for (let i = 0; i < following.length; i++) {
		const previous = segments[i];
		const next = following[i];
		if (next.command.trim() === "" && i === following.length - 1)
			return previous.separator === ";";
		if (previous.separator !== "&&") return false;
	}
	return true;
}

export function createdIssueNumber(toolResponse) {
	const text =
		typeof toolResponse === "string"
			? toolResponse
			: [toolResponse?.stdout, toolResponse?.output]
					.filter((part) => typeof part === "string")
					.join("\n");
	const match = CREATED_ISSUE_URL.exec(text ?? "");
	return match ? match[1] : null;
}

export function formatManagedIssueAdvisory(payload) {
	if (payload?.tool_name !== "Bash") return undefined;
	if (!createsManagedIssue(payload?.tool_input?.command)) return undefined;
	const number = createdIssueNumber(payload?.tool_response);
	if (!number) return undefined;
	return (
		`note: issue #${number} is labelled flow:managed, so it needs a matching artifact in .pfdsl/roadmap.pfdsl ` +
		"in this same cycle (see workflow.pfdsl's file_issues description for what the artifact carries). " +
		"audit-issues-flow.mjs only reports a missing entry at the next gate-check, when the cycle's context is gone."
	);
}

export function runManagedIssueReminder(inputText) {
	let payload;
	try {
		payload = JSON.parse(inputText);
	} catch {
		return { shouldOutput: false };
	}
	const advisory = formatManagedIssueAdvisory(payload);
	if (!advisory) return { shouldOutput: false };
	return {
		shouldOutput: true,
		output: {
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: advisory,
			},
		},
	};
}
