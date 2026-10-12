import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { AGENT_OPERATION_INPUT_FORMS } from "./agent-operation-input-forms.mjs";
import { withoutGitTargetEnvironment } from "./git-environment.mjs";
import { createGuardProbe } from "./guard-probe.mjs";

const REASONS = new Set([
	"unknown-option",
	"missing-option-value",
	"dynamic-argument",
	"indirect-file",
	"indirect-stdin",
	"unresolved-target-or-command",
]);
const SUBJECTS = new Set([
	"claude-parent",
	"claude-subagent",
	"codex-parent",
	"codex-child",
]);
const safeOption = (value) =>
	typeof value === "string" && /^--?[A-Za-z0-9][A-Za-z0-9-]*$/.test(value);

export function recordUnresolvedDecision(
	classified,
	decision,
	facts,
	{
		probeGit = createGuardProbe(),
		environment = process.env,
		now = () => new Date(),
		append = appendFileSync,
		makeDirectory = mkdirSync,
	} = {},
) {
	if (decision.decision !== "deny" || decision.operationClass !== "U") return;
	try {
		if (!SUBJECTS.has(classified.subject)) return;
		let commonDir = facts.commonDir;
		if (!commonDir) {
			if (!facts.sessionRoot) return;
			const observed = probeGit(["rev-parse", "--git-common-dir"], {
				cwd: facts.sessionRoot,
				env: withoutGitTargetEnvironment(environment),
			});
			if (!observed.ok || !observed.out.trim()) return;
			commonDir = resolve(facts.sessionRoot, observed.out.trim());
		}
		const directory = join(commonDir, "pfdsl");
		const records = new Map();
		for (const operation of classified.operations.filter(({ classes }) =>
			classes.includes("U"),
		)) {
			const subcommand = Object.hasOwn(
				AGENT_OPERATION_INPUT_FORMS,
				operation.subcommand ?? "",
			)
				? operation.subcommand
				: operation.kind === "remote"
					? "remote"
					: "git";
			const record = {
				at: now().toISOString(),
				subject: classified.subject,
				subcommand,
				reasons: [
					...new Set(
						(
							operation.unresolvedReasons ?? ["unresolved-target-or-command"]
						).map((reason) =>
							REASONS.has(reason) ? reason : "unresolved-target-or-command",
						),
					),
				],
				unknownOptions: [
					...new Set((operation.unknownOptions ?? []).filter(safeOption)),
				],
			};
			records.set(JSON.stringify(record), record);
		}
		if (!records.size) return;
		makeDirectory(directory, { recursive: true });
		append(
			join(directory, "agent-operation-unresolved.jsonl"),
			[...records.values()].map((record) => JSON.stringify(record)).join("\n") +
				"\n",
		);
	} catch {
		/* Recording never changes the operation decision. */
	}
}

export function summarizeUnresolvedRecords(text) {
	const result = { total: 0, invalid: 0, reasons: {}, options: {} };
	for (const line of text.split("\n").filter(Boolean)) {
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			result.invalid++;
			continue;
		}
		if (
			!Array.isArray(record.reasons) ||
			!Array.isArray(record.unknownOptions)
		) {
			result.invalid++;
			continue;
		}
		result.total++;
		for (const reason of record.reasons.filter((value) => REASONS.has(value)))
			result.reasons[reason] = (result.reasons[reason] ?? 0) + 1;
		for (const option of record.unknownOptions.filter(safeOption))
			result.options[option] = (result.options[option] ?? 0) + 1;
	}
	return result;
}
