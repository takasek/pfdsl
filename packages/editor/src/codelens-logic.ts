import { analyzeSource } from "@pfdsl/core";

export interface RunHintAnchor {
	line: number;
	column: number;
	command: string;
}

export function declaredCommands(
	process: Record<string, { command?: string } | undefined> | undefined,
): Set<string> {
	return new Set(
		Object.values(process ?? {}).flatMap((meta) =>
			meta?.command ? [meta.command] : [],
		),
	);
}

export function runHintsFromAnalysis(
	model: ReturnType<typeof analyzeSource>,
	lines: readonly string[],
): RunHintAnchor[] {
	if (!model.frontmatter?.process) return [];
	return model.sourceMap.declarations.flatMap((d) => {
		if (d.section !== "process") return [];
		const field = d.fields.get("command");
		const command = model.frontmatter?.process?.[d.id]?.command;
		if (!field || !command) return [];
		const line = field.keyRange.start.line - 1;
		return [
			{ line, column: (lines[line] ?? "").replace(/\r$/, "").length, command },
		];
	});
}

/** Compatibility adapter for callers with document lines. */
export function runHintAnchors(
	lines: readonly string[],
	bodyStartLine: number,
	commands: ReadonlySet<string>,
): RunHintAnchor[] {
	if (commands.size === 0) return [];
	return runHintsFromAnalysis(
		analyzeSource(lines.slice(0, bodyStartLine - 1).join("\n")),
		lines,
	).filter((hint) => commands.has(hint.command));
}
