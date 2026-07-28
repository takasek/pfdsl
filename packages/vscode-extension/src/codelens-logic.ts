/**
 * Which frontmatter lines get a "▶ run" hint, and for which command.
 *
 * codelens.ts reads the lines from a vscode document and builds InlayHints
 * from them, but deciding *which* lines qualify is a text rule: a `command:`
 * entry inside the frontmatter whose value is one a process actually declares.
 * That rule sat behind the coverage exclusions with the rest of the file
 * (#634).
 */

const COMMAND_LINE_RE = /^\s+command:\s+(.+)$/;

/** A line that should carry a run hint, and the command it would run. */
export interface RunHintAnchor {
	/** Zero-based line index, as vscode counts them. */
	line: number;
	/** Column to anchor at: the end of the line. */
	column: number;
	/** The command string, unquoted. */
	command: string;
}

/** The distinct command strings the processes declare. */
export function declaredCommands(
	process: Record<string, { command?: string } | undefined> | undefined,
): Set<string> {
	const commands = new Set<string>();
	for (const meta of Object.values(process ?? {})) {
		if (meta?.command) commands.add(meta.command);
	}
	return commands;
}

/**
 * The hints to place, given the document's lines and where its frontmatter
 * ends. Only frontmatter lines are considered — a body line that happens to
 * read `command: x` is not a declaration. A `command:` whose value no process
 * declares is skipped too, so an edited-but-not-saved value does not offer to
 * run something the document does not define.
 */
export function runHintAnchors(
	lines: readonly string[],
	bodyStartLine: number,
	commands: ReadonlySet<string>,
): RunHintAnchor[] {
	if (commands.size === 0) return [];
	const anchors: RunHintAnchor[] = [];
	for (let i = 0; i < bodyStartLine - 1 && i < lines.length; i++) {
		const lineText = lines[i];
		if (lineText === undefined) continue;
		const match = COMMAND_LINE_RE.exec(lineText);
		if (!match) continue;
		const command = match[1]!.trim().replace(/^["']|["']$/g, "");
		if (!commands.has(command)) continue;
		anchors.push({ line: i, column: lineText.length, command });
	}
	return anchors;
}
