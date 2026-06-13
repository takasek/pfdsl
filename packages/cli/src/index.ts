import { readFileSync, writeFileSync } from "node:fs";
import {
	analyze,
	auditGraph,
	diffGraphs as coreDiffGraphs,
	type Diagnostic,
	type DiffReport,
	format,
	formatEdges,
	hasErrors,
	sortEdges,
} from "@pfdsl/core";
import { type RenderFormat, renderGraph } from "@pfdsl/preview-engine";

export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

function ok(stdout = "", stderr = ""): CommandResult {
	return { stdout, stderr, exitCode: 0 };
}
function fail(stderr: string, exitCode = 1, stdout = ""): CommandResult {
	return { stdout, stderr, exitCode };
}

function formatDiagnostic(d: Diagnostic, file: string): string {
	const r = d.range;
	const loc = r ? `${file}:${r.start.line}:${r.start.column}` : file;
	return `${loc}: ${d.severity}: ${d.message}`;
}

function readSource(file: string): string {
	return readFileSync(file, "utf-8");
}

function diagText(diags: Diagnostic[], file: string): string {
	return `${diags.map((d) => formatDiagnostic(d, file)).join("\n")}\n`;
}

function failIfErrors(diags: Diagnostic[], file: string): CommandResult | null {
	if (!hasErrors(diags)) return null;
	const errs = diags.filter((d) => d.severity === "error");
	return fail(diagText(errs, file));
}

export interface CheckOptions {
	audit?: boolean;
	summary?: boolean;
}

export function runCheck(file: string, opts: CheckOptions = {}): CommandResult {
	const { diagnostics, edges, nodeKinds } = analyze(readSource(file));
	const lines = diagnostics.map((d) => formatDiagnostic(d, file));
	if (hasErrors(diagnostics)) {
		return { stdout: "", stderr: `${lines.join("\n")}\n`, exitCode: 1 };
	}

	const extraLines: string[] = [];

	if (opts.audit) {
		const { terminals, externalInputs } = auditGraph(edges, nodeKinds);
		extraLines.push(`terminal artifacts: ${terminals.join(", ")}`);
		extraLines.push(`external inputs: ${externalInputs.join(", ")}`);
	}

	if (opts.summary) {
		const artifactCount = [...nodeKinds.values()].filter(
			(k) => k === "artifact",
		).length;
		const processCount = [...nodeKinds.values()].filter(
			(k) => k === "process",
		).length;
		const primaryEdgeCount = edges.filter(
			(e) => e.kind === "input" || e.kind === "output",
		).length;
		const { terminals, externalInputs } = auditGraph(edges, nodeKinds);
		extraLines.push(
			`artifacts: ${artifactCount}, processes: ${processCount}, edges: ${primaryEdgeCount}, external_inputs: ${externalInputs.length}, terminals: ${terminals.length}`,
		);
	}

	const allLines = [...lines, ...extraLines];
	return {
		stdout: allLines.length ? `${allLines.join("\n")}\n` : "OK\n",
		stderr: "",
		exitCode: 0,
	};
}

export interface FmtOptions {
	write?: boolean;
	mode?: "flat" | "flows";
}
export function runFmt(file: string, opts: FmtOptions = {}): CommandResult {
	const source = readSource(file);
	const { output, diagnostics } = format(source, {
		style: opts.mode ?? "flows",
	});
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	if (opts.write) {
		writeFileSync(file, output, "utf-8");
		return ok();
	}
	return ok(output);
}

export function runNormalize(file: string): CommandResult {
	const { edges, graph, diagnostics } = analyze(readSource(file));
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	return ok(formatEdges(sortEdges(edges, graph)));
}

export interface GraphOptions {
	format?: RenderFormat;
}
export async function runGraph(
	file: string,
	opts: GraphOptions = {},
): Promise<CommandResult> {
	const fmt = opts.format ?? "dot";
	const { graph, frontmatter, diagnostics } = analyze(readSource(file));
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	const out = await renderGraph(graph, frontmatter, { format: fmt });
	return ok(out.endsWith("\n") ? out : `${out}\n`);
}

export type { DiffReport };

function loadGraph(file: string) {
	return analyze(readSource(file)).graph;
}

export function diffGraphs(fileA: string, fileB: string): DiffReport {
	const a = loadGraph(fileA);
	const b = loadGraph(fileB);
	return coreDiffGraphs(a, b);
}

export function runDiff(fileA: string, fileB: string): CommandResult {
	const r = diffGraphs(fileA, fileB);
	const out: string[] = [];
	const section = (label: string, items: string[]) => {
		for (const i of items) out.push(`${label} ${i}`);
	};
	section("+ node", r.addedNodes);
	section("- node", r.removedNodes);
	section("+ edge", r.addedEdges);
	section("- edge", r.removedEdges);
	section("+ feedback", r.addedFeedback);
	section("- feedback", r.removedFeedback);
	if (out.length === 0) return ok("no structural differences\n");
	return ok(`${out.join("\n")}\n`);
}

export const HELP = `pfdsl <command> [options]

Commands:
  check <file>             Validate a .pfdsl file
  fmt <file> [--write] [--mode flat|flows]
                           Format a .pfdsl file; flows groups per-process (A >> P -> B)
  normalize <file>         Print canonical edge list
  graph <file> [--format dot|svg]
                           Print Graphviz DOT (default) or SVG
  diff <a> <b>             Print structural diff between two files
  help                     Show this help
`;

export interface CliArgs {
	command: string;
	positional: string[];
	flags: Record<string, string | boolean>;
}

export function parseArgs(argv: readonly string[]): CliArgs {
	const [command = "help", ...rest] = argv;
	const positional: string[] = [];
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i]!;
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = rest[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				flags[key] = next;
				i++;
			} else {
				flags[key] = true;
			}
		} else {
			positional.push(a);
		}
	}
	return { command, positional, flags };
}

export async function run(argv: readonly string[]): Promise<CommandResult> {
	const { command, positional, flags } = parseArgs(argv);
	switch (command) {
		case "help":
		case "--help":
		case "-h":
			return ok(HELP);
		case "check": {
			const f = positional[0];
			if (!f) return fail("usage: pfdsl check <file>\n", 2);
			return runCheck(f, {
				audit: flags.audit === true,
				summary: flags.summary === true,
			});
		}
		case "fmt": {
			const f = positional[0];
			if (!f)
				return fail(
					"usage: pfdsl fmt <file> [--write] [--mode flat|flows]\n",
					2,
				);
			const mode = flags.mode;
			if (mode !== undefined && mode !== "flat" && mode !== "flows") {
				return fail(`unknown mode: ${String(mode)}\n`, 2);
			}
			return runFmt(f, {
				write: flags.write === true,
				...(mode ? { mode } : {}),
			});
		}
		case "normalize": {
			const f = positional[0];
			if (!f) return fail("usage: pfdsl normalize <file>\n", 2);
			return runNormalize(f);
		}
		case "graph": {
			const f = positional[0];
			if (!f) return fail("usage: pfdsl graph <file> [--format dot|svg]\n", 2);
			const fmt = flags.format;
			if (fmt !== undefined && fmt !== "dot" && fmt !== "svg") {
				return fail(`unknown format: ${String(fmt)}\n`, 2);
			}
			return runGraph(f, fmt ? { format: fmt } : {});
		}
		case "diff": {
			const [a, b] = positional;
			if (!a || !b) return fail("usage: pfdsl diff <a> <b>\n", 2);
			return runDiff(a, b);
		}
		default:
			return fail(`unknown command: ${command}\n${HELP}`, 2);
	}
}
