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

type BinaryFormat = "pdf" | "png";
export type CliRenderFormat = RenderFormat | BinaryFormat;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPuppeteer = any;

export async function svgToBinary(
	svg: string,
	format: BinaryFormat,
): Promise<Buffer> {
	let puppeteer: AnyPuppeteer;
	try {
		puppeteer = await import("puppeteer");
	} catch {
		throw new Error(
			`PDF/PNG export requires puppeteer. Install it with:\n  npm install puppeteer`,
		);
	}
	const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
	let width = 1200;
	let height = 800;
	if (viewBoxMatch) {
		const parts = viewBoxMatch[1]!.split(/\s+/).map(Number);
		width = parts[2] ?? width;
		height = parts[3] ?? height;
	}
	const sandboxArgs =
		process.platform === "linux"
			? ["--no-sandbox", "--disable-setuid-sandbox"]
			: [];
	const browser = await puppeteer.default.launch({
		headless: true,
		args: sandboxArgs,
	});
	try {
		const page = await browser.newPage();
		await page.setContent(
			`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`,
			{ waitUntil: "load" },
		);
		if (format === "pdf") {
			return await page.pdf({
				width: `${width}px`,
				height: `${height}px`,
				printBackground: true,
				margin: { top: 0, right: 0, bottom: 0, left: 0 },
				pageRanges: "1",
			});
		}
		await page.setViewport({
			width: Math.ceil(width),
			height: Math.ceil(height),
			deviceScaleFactor: 1,
		});
		return await page.screenshot({ type: "png", omitBackground: false });
	} finally {
		try {
			await browser.close();
		} catch {
			// suppress close errors so the original error is not masked
		}
	}
}

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
  diff <a> <b>             Print structural diff between two files
  skill sync <name> [--yes]
                           Sync a bundled skill (currently: pfd-ops) into the current directory
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
			return runDiff(a, b);
		}
		case "skill": {
			const [sub, name] = positional;
			if (sub !== "sync" || !name) {
				return fail("usage: pfdsl skill sync <name> [--yes]\n", 2);
			}
			if (name !== "pfd-ops") {
				return fail(`unknown skill: ${name}\n`, 2);
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
