import type { analyzeSource } from "@pfdsl/core";

export interface RunHintAnchor {
	line: number;
	column: number;
	command: string;
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
