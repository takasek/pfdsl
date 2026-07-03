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
	type IndexChange,
	loadExtendsChain,
	loadSubflowGraph,
	type PfdType,
	reindex,
	resolveRefPath,
	type SortKey,
	STATUS_VALUES,
	sort,
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

function isCommandResult(v: string | CommandResult): v is CommandResult {
	return typeof v === "object";
}

function readSource(file: string): string | CommandResult {
	if (file === "-") {
		return readFileSync("/dev/stdin", "utf-8");
	}
	try {
		return readFileSync(file, "utf-8");
	} catch (e) {
		const err = e as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			return fail(`${file}: No such file or directory`);
		}
		if (err.code === "EISDIR") {
			return fail(`${file}: Is a directory`);
		}
		return fail(`${file}: Cannot read file (${err.code ?? "unknown error"})`);
	}
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
	json?: boolean;
}

export function runCheck(file: string, opts: CheckOptions = {}): CommandResult {
	const src = readSource(file);
	if (isCommandResult(src)) return src;
	const { diagnostics, edges, nodeKinds, frontmatter } = analyze(
		src,
		opts.strict ? { strict: true } : undefined,
	);
	const lines = diagnostics.map((d) => formatDiagnostic(d, file));
	if (hasErrors(diagnostics)) {
		if (opts.json) {
			const errs = diagnostics.filter((d) => d.severity === "error");
			return {
				stdout: `${JSON.stringify({ ok: false, diagnostics: errs })}\n`,
				stderr: "",
				exitCode: 1,
			};
		}
		return { stdout: "", stderr: `${lines.join("\n")}\n`, exitCode: 1 };
	}

	// Multi-file checks (subflow + extends) — only run when single-file is clean.
	// Skipped for stdin (-): relative paths cannot be resolved without a base file.
	if (file === "-") {
		if (opts.json) {
			return {
				stdout: `${JSON.stringify({ ok: true, diagnostics: [] })}\n`,
				stderr: "",
				exitCode: 0,
			};
		}
		return {
			stdout: lines.length ? `${lines.join("\n")}\n` : "OK\n",
			stderr: "",
			exitCode: 0,
		};
	}
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
		if (opts.json) {
			return {
				stdout: `${JSON.stringify({ ok: false, diagnostics: errs })}\n`,
				stderr: "",
				exitCode: 1,
			};
		}
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

	if (opts.json) {
		const allDiags = [...diagnostics, ...multiDiags];
		return {
			stdout: `${JSON.stringify({ ok: true, diagnostics: allDiags })}\n`,
			stderr: "",
			exitCode: 0,
		};
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
	if (file === "-" && opts.write) {
		return fail("--write cannot be used with stdin (-)\n", 2);
	}
	const source = readSource(file);
	if (isCommandResult(source)) return source;
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

export interface ReindexOptions {
	write?: boolean;
	check?: boolean;
	renumber?: boolean;
	json?: boolean;
}

function reindexReport(changes: IndexChange[], json: boolean): string {
	if (json) return `${JSON.stringify({ changes })}\n`;
	if (changes.length === 0) return "";
	const prefix = (k: IndexChange["kind"]) => (k === "process" ? "P" : "D");
	const lines = changes.map((c) =>
		c.from === null
			? `+ ${prefix(c.kind)} ${c.id} ${c.to}`
			: `~ ${prefix(c.kind)} ${c.id} ${c.from} → ${c.to}`,
	);
	return `${lines.join("\n")}\n`;
}

export function runReindex(
	file: string,
	opts: ReindexOptions = {},
): CommandResult {
	if (opts.check && opts.write) {
		return fail("--check cannot be combined with --write\n", 2);
	}
	if (file === "-" && opts.write) {
		return fail("--write cannot be used with stdin (-)\n", 2);
	}
	const src = readSource(file);
	if (isCommandResult(src)) return src;
	const { output, changes, diagnostics } = reindex(
		src,
		opts.renumber ? { renumber: true } : {},
	);
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;

	// --check: report drift, non-zero exit when reindexing would change anything.
	if (opts.check) {
		const report = reindexReport(changes, opts.json === true);
		return { stdout: report, stderr: "", exitCode: changes.length > 0 ? 1 : 0 };
	}

	// --write: body goes to the file; stdout carries the change report.
	if (opts.write) {
		if (changes.length > 0) writeFileSync(file, output, "utf-8");
		return ok(reindexReport(changes, opts.json === true));
	}

	// --json (no write): emit the machine-readable change report.
	if (opts.json) return ok(reindexReport(changes, true));

	// default: rewritten body to stdout (preview), like fmt.
	return ok(output);
}

export interface SortOptions {
	by: string; // comma-separated SortKey list, e.g. "group,index"
	write?: boolean;
	check?: boolean;
}

function parseSortKeys(raw: string): SortKey[] | CommandResult {
	const valid: SortKey[] = ["index", "topological", "group", "id"];
	const parts = raw.split(",").map((k) => k.trim());
	const invalid = parts.filter((k) => !(valid as string[]).includes(k));
	if (invalid.length > 0) {
		return fail(
			`invalid --by key(s): ${invalid.map((k) => JSON.stringify(k)).join(", ")} (valid: index, topological, group, id)\n`,
			2,
		);
	}
	return parts as SortKey[];
}

export function runSort(file: string, opts: SortOptions): CommandResult {
	if (opts.check && opts.write) {
		return fail("--check cannot be combined with --write\n", 2);
	}
	if (file === "-" && opts.write) {
		return fail("--write cannot be used with stdin (-)\n", 2);
	}

	const keys = parseSortKeys(opts.by);
	if (!Array.isArray(keys)) return keys;

	const src = readSource(file);
	if (isCommandResult(src)) return src;

	const { output, changed, diagnostics } = sort(src, { by: keys });
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;

	if (opts.check) {
		return {
			stdout: changed ? "not sorted\n" : "",
			stderr: "",
			exitCode: changed ? 1 : 0,
		};
	}

	if (opts.write) {
		if (changed) writeFileSync(file, output, "utf-8");
		return ok();
	}

	return ok(output);
}

export interface NormalizeOptions {
	json?: boolean;
}

export function runNormalize(
	file: string,
	opts: NormalizeOptions = {},
): CommandResult {
	const normSrc = readSource(file);
	if (isCommandResult(normSrc)) return normSrc;
	const { edges, graph, diagnostics } = analyze(normSrc);
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	const sorted = sortEdges(edges, graph);
	if (opts.json) {
		const edgeList = formatEdges(sorted).split("\n").filter(Boolean);
		return ok(`${JSON.stringify(edgeList)}\n`);
	}
	return ok(formatEdges(sorted));
}

export interface ReadyOptions {
	best?: boolean;
	json?: boolean;
}

/**
 * Core ready-process algorithm operating on pre-analyzed data.
 * "Ready" = all input artifacts done/undefined AND at least one output not done.
 * Returns processInputs and processOutputs maps in addition to readyIds so
 * callers (e.g. runReady --best) can reuse the already-built maps.
 */
function computeReadyIdsCore(
	edges: ReturnType<typeof analyze>["edges"],
	nodeKinds: ReturnType<typeof analyze>["nodeKinds"],
	artifactMeta: NonNullable<
		ReturnType<typeof analyze>["frontmatter"]
	>["artifact"] &
		object,
): {
	readyIds: string[];
	processInputs: Map<string, string[]>;
	processOutputs: Map<string, string[]>;
} {
	const processInputs = new Map<string, string[]>();
	for (const e of edges) {
		if (e.kind === "input") {
			const arr = processInputs.get(e.process) ?? [];
			arr.push(e.artifact);
			processInputs.set(e.process, arr);
		}
	}
	const processOutputs = new Map<string, string[]>();
	for (const e of edges) {
		if (e.kind === "output") {
			const arr = processOutputs.get(e.process) ?? [];
			arr.push(e.artifact);
			processOutputs.set(e.process, arr);
		}
	}

	const readyIds: string[] = [];
	for (const [pid, inputs] of processInputs) {
		if (nodeKinds.get(pid) !== "process") continue;
		const allInputsDone = inputs.every((aid) => {
			const s = artifactMeta[aid]?.status;
			return s === "done" || s === undefined;
		});
		if (!allInputsDone) continue;
		const outputs = processOutputs.get(pid) ?? [];
		const alreadyDone =
			outputs.length > 0 &&
			outputs.every((aid) => {
				const s = artifactMeta[aid]?.status;
				return s === "done";
			});
		if (!alreadyDone) readyIds.push(pid);
	}
	return { readyIds, processInputs, processOutputs };
}

/**
 * Compute the set of ready process IDs from raw source (parses and type-gates).
 * Returns {readyIds: [], isRoadmap: false} on parse errors or non-roadmap type.
 */
function computeReadyIds(src: string): {
	readyIds: string[];
	isRoadmap: boolean;
} {
	const { diagnostics, edges, nodeKinds, frontmatter } = analyze(src);
	if (hasErrors(diagnostics)) return { readyIds: [], isRoadmap: false };

	const pfdType = frontmatter?.type;
	const isRoadmap = pfdType === undefined || pfdType === "roadmap";
	if (!isRoadmap) return { readyIds: [], isRoadmap: false };

	const artifactMeta = frontmatter?.artifact ?? {};
	const { readyIds } = computeReadyIdsCore(edges, nodeKinds, artifactMeta);
	return { readyIds, isRoadmap: true };
}

export function runReady(file: string, opts: ReadyOptions = {}): CommandResult {
	const src = readSource(file);
	if (isCommandResult(src)) return src;

	const { diagnostics, edges, nodeKinds, frontmatter } = analyze(src);
	const earlyFail = failIfErrors(diagnostics, file);
	if (earlyFail) return earlyFail;

	const READY_REQUIRED_TYPE = "roadmap" satisfies PfdType;
	const pfdType = frontmatter?.type;
	if (pfdType !== undefined && pfdType !== READY_REQUIRED_TYPE) {
		return fail(
			`ready requires a roadmap file (type: roadmap). This file has type: ${pfdType}\n`,
			2,
		);
	}

	const artifactMeta = frontmatter?.artifact ?? {};

	const { readyIds, processInputs, processOutputs } = computeReadyIdsCore(
		edges,
		nodeKinds,
		artifactMeta,
	);

	// best-next: prefer the process that would actually make the most downstream processes ready.
	// A consumer counts only if completing pid removes its LAST remaining blocker
	// (i.e. all other inputs of that consumer are already done/undefined).
	let bestId: string | undefined;
	if (opts.best && readyIds.length > 0) {
		// Precompute artifact → consuming processes (O(m) once)
		const artifactConsumers = new Map<string, string[]>();
		for (const e of edges) {
			if (e.kind === "input") {
				const arr = artifactConsumers.get(e.artifact) ?? [];
				arr.push(e.process);
				artifactConsumers.set(e.artifact, arr);
			}
		}
		// Precompute process output artifact sets (O(m) once)
		const processOutputSets = new Map<string, Set<string>>();
		for (const e of edges) {
			if (e.kind === "output") {
				const s = processOutputSets.get(e.process) ?? new Set();
				s.add(e.artifact);
				processOutputSets.set(e.process, s);
			}
		}
		// Count consumers that would become ready after pid completes (O(m) per pid, but
		// pid iterates only its own outputs × their consumers, total O(m) across all pids)
		const countUnlocked = (pid: string): number => {
			const outputs = processOutputSets.get(pid) ?? new Set();
			const unlocked = new Set<string>();
			for (const aid of outputs) {
				for (const consumer of artifactConsumers.get(aid) ?? []) {
					if (unlocked.has(consumer)) continue;
					// Consumer becomes ready if all its inputs (other than ones pid outputs) are done
					const otherInputsAllDone =
						processInputs.get(consumer)?.every((inp) => {
							if (outputs.has(inp)) return true; // pid will satisfy this
							const s = artifactMeta[inp]?.status;
							return s === "done" || s === undefined;
						}) ?? true;
					if (otherInputsAllDone) unlocked.add(consumer);
				}
			}
			return unlocked.size;
		};
		// Precompute counts then find max in O(n) — avoid O(n log n) sort + allocation
		const counts = new Map<string, number>(
			readyIds.map((pid) => [pid, countUnlocked(pid)]),
		);
		bestId = readyIds.reduce((best, pid) => {
			const bc = counts.get(best) ?? 0;
			const pc = counts.get(pid) ?? 0;
			return pc > bc || (pc === bc && pid < best) ? pid : best;
		});
	}

	type ReadyItem = { id: string; label: string; inputs: string[] };
	const toItem = (pid: string): ReadyItem => ({
		id: pid,
		label: frontmatter?.process?.[pid]?.label ?? pid,
		inputs: processInputs.get(pid) ?? [],
	});

	const readyItems = readyIds.map(toItem);
	const bestItem = bestId ? toItem(bestId) : undefined;

	if (opts.json) {
		const payload: Record<string, unknown> = { ok: true, ready: readyItems };
		if (opts.best && bestItem) payload.best = bestItem;
		return ok(`${JSON.stringify(payload)}\n`);
	}

	if (readyItems.length === 0) {
		return ok("No ready processes. Check artifact statuses.\n");
	}

	const lines: string[] = [`Ready processes (${readyItems.length}):`];
	for (const item of readyItems) {
		const marker = opts.best && item.id === bestId ? "*" : " ";
		const inputs = item.inputs.join(", ");
		lines.push(
			`  ${marker} ${item.id.padEnd(20)} "${item.label}"   inputs: [${inputs}]`,
		);
	}
	if (opts.best && bestItem) {
		lines.push("");
		lines.push(
			"* = recommended next (removes the last blocker for the most downstream processes)",
		);
	}
	return ok(`${lines.join("\n")}\n`);
}

export interface StatusSetOptions {
	json?: boolean;
}

export function runStatusSet(
	file: string,
	artifactId: string,
	status: string,
	opts: StatusSetOptions = {},
): CommandResult {
	if (!STATUS_VALUES.includes(status as (typeof STATUS_VALUES)[number])) {
		return fail(HELP_STATUS_SET, 2);
	}
	const src = readSource(file);
	if (isCommandResult(src)) return src;

	const frontmatterMatch = /^---\n([\s\S]*?\n)---\n/.exec(src);
	const fmBlock = frontmatterMatch?.[1];
	if (!frontmatterMatch || !fmBlock) {
		return fail(`error: artifact '${artifactId}' not found in ${file}\n`);
	}
	const fmBodyStart = frontmatterMatch[0].length - fmBlock.length - 4; // after "---\n"

	// Find the artifact block: look for "  <id>:" in frontmatter
	const artifactHeaderRe = new RegExp(`^(  ${artifactId}:\\s*\\n)`, "m");
	if (!artifactHeaderRe.test(fmBlock)) {
		return fail(`error: artifact '${artifactId}' not found in ${file}\n`);
	}

	// Snapshot ready set before mutation (roadmap only)
	const { readyIds: beforeIds, isRoadmap } = computeReadyIds(src);
	const beforeSet = new Set(beforeIds);

	// Replace "    status: <old>" under this artifact, or insert it after its header
	const statusLineRe = new RegExp(
		`(  ${artifactId}:[ \\t]*\\n(?:    [^\\n]*\\n)*?)    status: [^\\n]+`,
	);
	let newFm: string;
	if (statusLineRe.test(fmBlock)) {
		newFm = fmBlock.replace(statusLineRe, `$1    status: ${status}`);
	} else {
		newFm = fmBlock.replace(
			new RegExp(`(  ${artifactId}:[ \\t]*\\n)`),
			`$1    status: ${status}\n`,
		);
	}

	const newSrc =
		src.slice(0, fmBodyStart) + newFm + src.slice(fmBodyStart + fmBlock.length);
	writeFileSync(file, newSrc, "utf-8");

	// Compute newly-ready processes (roadmap only)
	const newlyReady: string[] = isRoadmap
		? computeReadyIds(newSrc).readyIds.filter((id) => !beforeSet.has(id))
		: [];

	if (opts.json) {
		return ok(`${JSON.stringify({ ok: true, newlyReady })}\n`);
	}
	if (newlyReady.length > 0) {
		return ok(`newly ready: ${newlyReady.join(", ")}\n`);
	}
	return ok("");
}

export interface AuditSyncOptions {
	json?: boolean;
}

export interface AuditSyncGap {
	file: string;
	artifactId: string;
	label: string;
	status: string;
}

export interface AuditSyncResult {
	ok: boolean;
	gaps: AuditSyncGap[];
}

export function runAuditSync(
	roadmapFile: string,
	flowFiles: string[],
	opts: AuditSyncOptions = {},
): CommandResult {
	const roadmapSrc = readSource(roadmapFile);
	if (isCommandResult(roadmapSrc)) return roadmapSrc;

	const {
		diagnostics: roadmapDiags,
		frontmatter: roadmapFm,
		edges: roadmapEdges,
	} = analyze(roadmapSrc);
	const roadmapFail = failIfErrors(roadmapDiags, roadmapFile);
	if (roadmapFail) return roadmapFail;

	const ROADMAP_REQUIRED_TYPE = "roadmap" satisfies PfdType;
	if (
		roadmapFm?.type !== undefined &&
		roadmapFm.type !== ROADMAP_REQUIRED_TYPE
	) {
		return fail(
			`audit-sync: roadmap file must have type: roadmap. Got type: ${roadmapFm.type}\n`,
			2,
		);
	}

	// Collect all artifact IDs that appear in the roadmap (declared or in edges)
	const roadmapArtifactIds = new Set<string>(
		Object.keys(roadmapFm?.artifact ?? {}),
	);
	for (const e of roadmapEdges) {
		roadmapArtifactIds.add(e.artifact);
	}

	const gaps: AuditSyncGap[] = [];

	for (const flowFile of flowFiles) {
		const flowSrc = readSource(flowFile);
		if (isCommandResult(flowSrc)) return flowSrc;

		const { diagnostics: flowDiags, frontmatter: flowFm } = analyze(flowSrc);
		const flowFail = failIfErrors(flowDiags, flowFile);
		if (flowFail) return flowFail;

		const flowType = flowFm?.type;
		if (flowType === ROADMAP_REQUIRED_TYPE) {
			return fail(
				`audit-sync: flow file must be workflow or runtime-pipeline, not roadmap: ${flowFile}\n`,
				2,
			);
		}

		for (const [aid, meta] of Object.entries(flowFm?.artifact ?? {})) {
			if (meta.status === "todo") {
				if (!roadmapArtifactIds.has(aid)) {
					gaps.push({
						file: flowFile,
						artifactId: aid,
						label: meta.label ?? aid,
						status: "todo",
					});
				}
			}
		}
	}

	const result: AuditSyncResult = { ok: gaps.length === 0, gaps };

	if (opts.json) {
		const exitCode = gaps.length > 0 ? 1 : 0;
		return { stdout: `${JSON.stringify(result)}\n`, stderr: "", exitCode };
	}

	if (gaps.length === 0) {
		return ok("All todo artifacts in flow files are tracked in the roadmap.\n");
	}

	const lines: string[] = [`Untracked todo artifacts (${gaps.length}):`];
	for (const g of gaps) {
		lines.push(`  ${g.artifactId.padEnd(20)} "${g.label}"   in: ${g.file}`);
	}
	lines.push(
		"",
		"Add a build chain in the roadmap for each untracked artifact.",
	);
	return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 1 };
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
	const graphSrc = readSource(file);
	if (isCommandResult(graphSrc)) return graphSrc;
	const { graph, frontmatter, diagnostics } = analyze(graphSrc);
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
	const srcA = readSource(fileA);
	const srcB = readSource(fileB);
	const { graph: a } = analyze(isCommandResult(srcA) ? "" : srcA);
	const { graph: b } = analyze(isCommandResult(srcB) ? "" : srcB);
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
	const diffSrcA = readSource(fileA);
	if (isCommandResult(diffSrcA)) return diffSrcA;
	const {
		graph: graphA,
		frontmatter: fmA,
		diagnostics: diagsA,
	} = analyze(diffSrcA);
	const failedA = failIfErrors(diagsA, fileA);
	if (failedA) return failedA;
	const diffSrcB = readSource(fileB);
	if (isCommandResult(diffSrcB)) return diffSrcB;
	const {
		graph: graphB,
		frontmatter: fmB,
		diagnostics: diagsB,
	} = analyze(diffSrcB);
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

const HELP_CHECK = `usage: pfdsl check <file|-> [--audit] [--summary] [--strict] [--json] [--no-color]

Validate a .pfdsl file. Use - to read from stdin.

Options:
  --audit    list terminal artifacts and external inputs
  --summary  print artifact/process/edge counts
  --strict   error if feedback source not reachable from target process
  --json     output diagnostics as JSON ({ ok, diagnostics })
  --no-color disable ANSI color codes (also: NO_COLOR env var)
`;

const HELP_FMT = `usage: pfdsl fmt <file|-> [--write] [--mode flat|flows]

Format a .pfdsl file. Use - to read from stdin (--write not allowed with stdin).

Options:
  --write       rewrite the file in place (cannot be used with -)
  --mode flat   output one edge per line
  --mode flows  group each process with its inputs and outputs (default)
`;

const HELP_REINDEX = `usage: pfdsl reindex <file|-> [--write] [--check] [--renumber] [--json]

Assign integer index: values to nodes in topological order. Processes and
artifacts are numbered with independent counters. Use - to read from stdin.

By default existing index: values are kept and only nodes lacking one are
filled. Output follows the gofmt model: the rewritten file goes to stdout
(preview); with --write it is written in place and stdout carries the change
report instead. Diagnostics go to stderr.

Options:
  --write     rewrite the file in place; print the change report to stdout
              (cannot be used with -)
  --check     do not write; exit 1 if reindexing would change anything (CI)
  --renumber  reassign every node from 1 (default keeps existing indices)
  --json      emit the change report as JSON ({ changes: [...] })
`;

const HELP_SORT = `usage: pfdsl sort-meta <file|-> --by <keys> [--write] [--check]

Sort artifact and process node definitions within each frontmatter section.
Each section is sorted independently. Use - to read from stdin.

Options:
  --by <keys>   comma-separated sort keys: index, topological, group, id
                e.g. --by group,index  (primary=group, secondary=index)
  --write       rewrite the file in place (cannot be used with -)
  --check       exit 1 if the file is not already sorted (CI mode)
`;

const HELP_NORMALIZE = `usage: pfdsl normalize <file|-> [--json]

Print canonical edge list. Use - to read from stdin.

Options:
  --json  output edge list as JSON array
`;

const HELP_GRAPH = `usage: pfdsl graph <file|-> [--format dot|svg|pdf|png]

Print a Graphviz representation. Use - to read from stdin.

Options:
  --format dot  Graphviz DOT (default)
  --format svg  SVG via Graphviz wasm
  --format pdf  PDF (requires: npm install puppeteer)
  --format png  PNG (requires: npm install puppeteer)
`;

const HELP_DIFF = `usage: pfdsl diff <a> <b> [--format text|dot|svg]

Show structural differences between two .pfdsl files.

Options:
  --format text  human-readable summary (default)
  --format dot   visual diff as Graphviz DOT
  --format svg   visual diff as SVG
`;

const HELP_SKILL = `usage: pfdsl skill sync [--yes]

Sync pfd-ops skills and commands into the current directory.

Options:
  --yes  auto-confirm gh label creation (non-interactive)
`;

const HELP_READY = `usage: pfdsl ready <file|-> [--best] [--json]

List processes whose every input artifact has status: done (or no status set).
Only applies to roadmap files (type: roadmap). Use - to read from stdin.

Options:
  --best  highlight the process that unblocks the most downstream work
  --json  output as JSON ({ ok, ready: [{id, label, inputs}], best? })
`;

const HELP_STATUS_SET = `usage: pfdsl status-set <file> <artifact-id> <status> [--json]

Set the status of an artifact in a .pfdsl file, rewriting it in place.
For roadmap files, reports which processes became newly ready after the change.

  <status>  one of: todo | wip | done | waiting | suspended
  --json    emit JSON ({ ok, newlyReady: string[] }) instead of text

Exit codes:
  0  success
  1  artifact not found in the file
  2  invalid usage (missing argument, invalid status value)
`;

const HELP_AUDIT_SYNC = `usage: pfdsl audit-sync <roadmap> <flow> [<flow>...] [--json]

Cross-check todo artifacts in workflow/runtime-pipeline files against the roadmap.
Reports artifacts with status: todo in flow files that have no corresponding entry
in the roadmap, indicating a build chain is missing.

  <roadmap>  path to a .pfdsl file with type: roadmap
  <flow>     one or more .pfdsl files with type: workflow or runtime-pipeline

Options:
  --json  output as JSON ({ ok, gaps: [{file, artifactId, label, status}] })

Exit codes:
  0  all todo artifacts are tracked in the roadmap
  1  one or more todo artifacts have no roadmap entry
  2  invalid usage
`;

export const HELP = `pfdsl <command> [options]

Commands:
  check <file|-> [--audit] [--summary] [--strict] [--json] [--no-color]
                           Validate a .pfdsl file (- = stdin)
                           --audit    list terminal artifacts and external inputs
                           --summary  print artifact/process/edge counts
                           --strict   error if feedback source not reachable from target process
                           --json     output diagnostics as JSON
                           --no-color disable ANSI color codes (also: NO_COLOR env var)
  fmt <file|-> [--write] [--mode flat|flows]
                           Format a .pfdsl file (- = stdin)
  reindex <file|-> [--write] [--check] [--renumber] [--json]
                           Assign topological index: values (- = stdin)
                           --write     rewrite in place; report to stdout
                           --check     exit 1 if reindexing would change anything
                           --renumber  reassign every node from 1
                           --json      emit change report as JSON
  sort-meta <file|-> --by <keys> [--write] [--check]
                           Sort node definitions by keys (- = stdin)
                           --by        comma-separated: index, topological, group, id
                           --write     rewrite in place
                           --check     exit 1 if not already sorted
  normalize <file|-> [--json]
                           Print canonical edge list (- = stdin)
                           --json     output edge list as JSON array
  graph <file|-> [--format dot|svg|pdf|png]
                           Print Graphviz DOT (default), SVG, PDF, or PNG (- = stdin)
                           PDF/PNG requires: npm install puppeteer
  diff <a> <b> [--format text|dot|svg]
                           Structural diff (text), or visual diff DOT/SVG
  ready <file|-> [--best] [--json]
                           List ready-to-start processes (- = stdin)
                           --best    recommend the best next process
                           --json    output as JSON
  status-set <file> <artifact-id> <status> [--json]
                           Set artifact status (todo|wip|done|waiting|suspended) in place
                           Roadmap files: prints newly-ready processes after the change
                           --json    output as JSON ({ ok, newlyReady: string[] })
  audit-sync <roadmap> <flow> [<flow>...] [--json]
                           Cross-check todo artifacts in flow files against the roadmap
                           --json    output as JSON
  skill sync [--yes]
                           Sync pfd-ops skills and commands into the current directory
                           --yes     auto-confirm gh label creation (non-interactive)
  help                     Show this help

Exit codes:
  0  success (warnings are non-fatal)
  1  error (parse/validation error, or file cannot be read)
  2  invalid usage (missing argument, unknown flag or subcommand)
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
				const prev = flags[key];
				// Repeated string flag: join with comma so --by a --by b ≡ --by a,b
				flags[key] = typeof prev === "string" ? `${prev},${next}` : next;
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
			if (flags.help) return ok(HELP_CHECK);
			const f = positional[0];
			if (!f) return fail(HELP_CHECK, 2);
			return runCheck(f, {
				audit: flags.audit === true,
				summary: flags.summary === true,
				strict: flags.strict === true,
				json: flags.json === true,
			});
		}
		case "fmt": {
			if (flags.help) return ok(HELP_FMT);
			const f = positional[0];
			if (!f) return fail(HELP_FMT, 2);
			const mode = flags.mode;
			if (mode !== undefined && mode !== "flat" && mode !== "flows") {
				return fail(`unknown mode: ${String(mode)}\n`, 2);
			}
			return runFmt(f, {
				write: flags.write === true,
				...(mode ? { mode } : {}),
			});
		}
		case "reindex": {
			if (flags.help) return ok(HELP_REINDEX);
			const f = positional[0];
			if (!f) return fail(HELP_REINDEX, 2);
			return runReindex(f, {
				write: flags.write === true,
				check: flags.check === true,
				renumber: flags.renumber === true,
				json: flags.json === true,
			});
		}
		case "sort-meta": {
			if (flags.help) return ok(HELP_SORT);
			const f = positional[0];
			if (!f) return fail(HELP_SORT, 2);
			const byVal = flags.by;
			if (!byVal || byVal === true) return fail(HELP_SORT, 2);
			return runSort(f, {
				by: String(byVal),
				write: flags.write === true,
				check: flags.check === true,
			});
		}
		case "normalize": {
			if (flags.help) return ok(HELP_NORMALIZE);
			const f = positional[0];
			if (!f) return fail(HELP_NORMALIZE, 2);
			return runNormalize(f, { json: flags.json === true });
		}
		case "graph": {
			if (flags.help) return ok(HELP_GRAPH);
			const f = positional[0];
			if (!f) return fail(HELP_GRAPH, 2);
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
			if (flags.help) return ok(HELP_DIFF);
			const [a, b] = positional;
			if (!a || !b) return fail(HELP_DIFF, 2);
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
		case "ready": {
			if (flags.help) return ok(HELP_READY);
			const f = positional[0];
			if (!f) return fail(HELP_READY, 2);
			return runReady(f, {
				best: flags.best === true,
				json: flags.json === true,
			});
		}
		case "status-set": {
			if (flags.help) return ok(HELP_STATUS_SET);
			const [f, artifactId, status] = positional;
			if (!f || !artifactId || !status) return fail(HELP_STATUS_SET, 2);
			return runStatusSet(f, artifactId, status, {
				json: flags.json === true,
			});
		}
		case "audit-sync": {
			if (flags.help) return ok(HELP_AUDIT_SYNC);
			const [roadmapFile, ...flowFiles] = positional;
			if (!roadmapFile || flowFiles.length === 0)
				return fail(HELP_AUDIT_SYNC, 2);
			return runAuditSync(roadmapFile, flowFiles, {
				json: flags.json === true,
			});
		}
		case "skill": {
			if (flags.help) return ok(HELP_SKILL);
			const [sub] = positional;
			if (sub !== "sync") {
				return fail(HELP_SKILL, 2);
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
