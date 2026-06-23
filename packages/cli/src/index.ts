import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	analyze,
	auditGraph,
	computeOpenInputs,
	computeTerminals,
	diffGraphs as coreDiffGraphs,
	type Diagnostic,
	type DiffReport,
	format,
	formatEdges,
	hasErrors,
	loadExtendsChain,
	loadSubflowGraph,
	resolveRefPath,
	sortEdges,
	validatePresetKeys,
	validateSubflowBoundary,
} from "@pfdsl/core";
import { type BinaryFormat, svgToBinary } from "@pfdsl/graphviz-exporter";
import {
	type RenderFormat,
	renderDiff,
	renderGraph,
} from "@pfdsl/preview-engine";
import { runSkillSync } from "./skill-sync.js";

export interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	binaryOutput?: Buffer;
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
	const code = d.code ? ` [${d.code}]` : "";
	return `${loc}: ${d.severity}${code}: ${d.message}`;
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
	strict?: boolean;
}

export function runCheck(file: string, opts: CheckOptions = {}): CommandResult {
	const { diagnostics, edges, nodeKinds, frontmatter } = analyze(
		readSource(file),
		opts.strict ? { strict: true } : undefined,
	);
	const lines = diagnostics.map((d) => formatDiagnostic(d, file));
	if (hasErrors(diagnostics)) {
		return { stdout: "", stderr: `${lines.join("\n")}\n`, exitCode: 1 };
	}

	// Multi-file checks (subflow + extends) — only run when single-file is clean
	const absFile = resolve(file);
	const loader = (path: string) => {
		try {
			let src = readFileSync(path, "utf-8");
			// Plain YAML preset files (e.g. .yaml) have no --- delimiters;
			// wrap them so loadFrontmatter picks up their content as frontmatter.
			if (
				!src.startsWith("---") &&
				(path.endsWith(".yaml") || path.endsWith(".yml"))
			) {
				src = `---\n${src}\n---\n`;
			}
			return analyze(src);
		} catch {
			return null;
		}
	};

	const multiDiags: Diagnostic[] = [];

	// --- Subflow checks ---
	const subflowGraph = loadSubflowGraph(absFile, loader);
	multiDiags.push(...subflowGraph.diagnostics);

	for (const [pid, pmeta] of Object.entries(frontmatter?.process ?? {})) {
		if (typeof pmeta.subflow !== "string") continue;
		const resolved = resolveRefPath(absFile, pmeta.subflow);
		if (!resolved.ok) continue; // already in subflowGraph.diagnostics
		const childDoc = subflowGraph.docs.get(resolved.path);
		if (!childDoc) continue; // missing file — already in diagnostics
		const childEdges = childDoc.edges;
		const childOpenInputs = computeOpenInputs(childEdges);
		const childTerminals = computeTerminals(childEdges);
		const parentNormalInputs = new Set(
			edges
				.filter((e) => e.kind === "input" && e.process === pid)
				.map((e) => e.artifact),
		);
		const parentOutputs = new Set(
			edges
				.filter((e) => e.kind === "output" && e.process === pid)
				.map((e) => e.artifact),
		);
		multiDiags.push(
			...validateSubflowBoundary({
				processId: pid,
				parentNormalInputs,
				parentOutputs,
				boundaryMap: (pmeta.boundary as Record<string, string>) ?? {},
				childOpenInputs,
				childTerminals,
			}),
		);
	}

	// --- Extends checks ---
	const extendsChain = loadExtendsChain(absFile, loader);
	multiDiags.push(...extendsChain.diagnostics);

	for (const [path, doc] of extendsChain.docs) {
		if (path === absFile) continue; // skip entry file itself
		multiDiags.push(...validatePresetKeys(path, doc.frontmatter));
	}

	if (hasErrors(multiDiags)) {
		const errs = multiDiags.filter((d) => d.severity === "error");
		return fail(`${errs.map((d) => formatDiagnostic(d, file)).join("\n")}\n`);
	}

	const extraLines: string[] = [];
	const artifactMeta = frontmatter?.artifact ?? undefined;

	if (opts.audit) {
		const { terminals, externalInputs } = auditGraph(
			edges,
			nodeKinds,
			artifactMeta,
		);
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
		const { terminals, externalInputs } = auditGraph(
			edges,
			nodeKinds,
			artifactMeta,
		);
		extraLines.push(
			`artifacts: ${artifactCount}, processes: ${processCount}, edges: ${primaryEdgeCount}, external_inputs: ${externalInputs.length}, terminals: ${terminals.length}`,
		);
	}

	const allLines = [
		...lines,
		...multiDiags.map((d) => formatDiagnostic(d, file)),
		...extraLines,
	];
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

export type { BinaryFormat };
export { svgToBinary };
export type CliRenderFormat = RenderFormat | BinaryFormat;

export interface GraphOptions {
	format?: CliRenderFormat;
}
export async function runGraph(
	file: string,
	opts: GraphOptions = {},
): Promise<CommandResult> {
	const fmt = opts.format ?? "dot";
	const { graph, frontmatter, diagnostics } = analyze(readSource(file));
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	if (fmt === "pdf" || fmt === "png") {
		const svg = await renderGraph(graph, frontmatter, { format: "svg" });
		try {
			const buf = await svgToBinary(svg, fmt);
			return { stdout: "", stderr: "", exitCode: 0, binaryOutput: buf };
		} catch (e) {
			return fail(e instanceof Error ? `${e.message}\n` : String(e));
		}
	}
	const out = await renderGraph(graph, frontmatter, { format: fmt });
	return ok(out.endsWith("\n") ? out : `${out}\n`);
}

export type { DiffReport };

export function diffGraphs(fileA: string, fileB: string): DiffReport {
	const { graph: a } = analyze(readSource(fileA));
	const { graph: b } = analyze(readSource(fileB));
	return coreDiffGraphs(a, b);
}

export interface DiffOptions {
	format?: "text" | "dot" | "svg";
}

export async function runDiff(
	fileA: string,
	fileB: string,
	opts: DiffOptions = {},
): Promise<CommandResult> {
	const fmt = opts.format ?? "text";
	const {
		graph: graphA,
		frontmatter: fmA,
		diagnostics: diagsA,
	} = analyze(readSource(fileA));
	const failedA = failIfErrors(diagsA, fileA);
	if (failedA) return failedA;
	const {
		graph: graphB,
		frontmatter: fmB,
		diagnostics: diagsB,
	} = analyze(readSource(fileB));
	const failedB = failIfErrors(diagsB, fileB);
	if (failedB) return failedB;

	if (fmt === "dot") {
		const dot = await renderDiff(graphA, fmA, graphB, fmB, { format: "dot" });
		return ok(dot.endsWith("\n") ? dot : `${dot}\n`);
	}
	if (fmt === "svg") {
		const svg = await renderDiff(graphA, fmA, graphB, fmB, { format: "svg" });
		return ok(svg.endsWith("\n") ? svg : `${svg}\n`);
	}

	// text format
	const r = coreDiffGraphs(graphA, graphB, fmA, fmB);
	const out: string[] = [];
	const section = (label: string, items: string[]) => {
		for (const i of items) out.push(`${label} ${i}`);
	};
	section("+ node", r.addedNodes);
	section("- node", r.removedNodes);
	section("~ node", r.changedNodes);
	section("+ edge", r.addedEdges);
	section("- edge", r.removedEdges);
	section("+ feedback", r.addedFeedback);
	section("- feedback", r.removedFeedback);
	if (out.length === 0) return ok("no structural differences\n");
	return ok(`${out.join("\n")}\n`);
}

declare const __PFDSL_VERSION__: string;

export const HELP = `pfdsl <command> [options]

Commands:
  check <file> [--audit] [--summary] [--strict]
                           Validate a .pfdsl file
                           --audit   list terminal artifacts and external inputs
                           --summary print artifact/process/edge counts
                           --strict  error if feedback source not reachable from target process
  fmt <file> [--write] [--mode flat|flows]
                           Format a .pfdsl file; flows groups per-process (A >> P -> B)
  normalize <file>         Print canonical edge list
  graph <file> [--format dot|svg|pdf|png]
                           Print Graphviz DOT (default), SVG, PDF, or PNG
                           PDF/PNG requires: npm install puppeteer
  diff <a> <b> [--format text|dot|svg]
                           Structural diff (text), or visual diff DOT/SVG
  skill sync [--yes]
                           Sync pfd-ops skills and commands into the current directory
                           --yes     auto-confirm gh label creation (non-interactive)
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
		case "--version":
		case "-V":
			return ok(`${__PFDSL_VERSION__}\n`);
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
				strict: flags.strict === true,
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
			if (!f)
				return fail(
					"usage: pfdsl graph <file> [--format dot|svg|pdf|png]\n",
					2,
				);
			const fmt = flags.format;
			if (
				fmt !== undefined &&
				fmt !== "dot" &&
				fmt !== "svg" &&
				fmt !== "pdf" &&
				fmt !== "png"
			) {
				return fail(`unknown format: ${String(fmt)}\n`, 2);
			}
			return runGraph(f, fmt ? { format: fmt as CliRenderFormat } : {});
		}
		case "diff": {
			const [a, b] = positional;
			if (!a || !b) return fail("usage: pfdsl diff <a> <b>\n", 2);
			const fmt = flags.format;
			if (
				fmt !== undefined &&
				fmt !== "text" &&
				fmt !== "dot" &&
				fmt !== "svg"
			) {
				return fail(`unknown format: ${String(fmt)}\n`, 2);
			}
			return await runDiff(a, b, fmt ? { format: fmt } : {});
		}
		case "skill": {
			const [sub] = positional;
			if (sub !== "sync") {
				return fail("usage: pfdsl skill sync [--yes]\n", 2);
			}
			// --target overrides cwd; intended for tests only (production always
			// targets the directory the CLI is invoked from).
			const targetRoot =
				typeof flags.target === "string" ? flags.target : process.cwd();
			try {
				const result = await runSkillSync({
					targetRoot,
					yes: flags.yes === true,
				});
				return ok(result.stdout);
			} catch (e) {
				return fail(e instanceof Error ? `${e.message}\n` : String(e));
			}
		}
		default:
			return fail(`unknown command: ${command}\n${HELP}`, 2);
	}
}
