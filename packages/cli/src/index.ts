import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	analyze,
	auditGraph,
	type ConsumerAsymmetryHint,
	computeDependsOn,
	computeImpact,
	computeNeighbors,
	computeOpenInputs,
	computePaths,
	computeStats,
	computeTerminals,
	diffGraphs as coreDiffGraphs,
	DIAGNOSTIC_REGISTRY,
	type Diagnostic,
	type DiagnosticRegistryEntry,
	type DiffReport,
	escapeRe,
	format,
	formatEdges,
	groupEdges,
	hasErrors,
	type IndexChange,
	loadExtendsChain,
	loadSubflowGraph,
	type PfdType,
	reindex,
	resolveEffectiveFrontmatter,
	resolveLocationFsPath,
	resolveRefPath,
	type SortKey,
	STATUS_VALUES,
	sort,
	sortEdges,
	validatePresetKeys,
	validateSubflowBoundary,
	wrapPresetSource,
} from "@pfdsl/core";
import { type BinaryFormat, svgToBinary } from "@pfdsl/graphviz-exporter";
import {
	type RenderFormat,
	renderDiff,
	renderGraph,
} from "@pfdsl/preview-engine";

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

const SEVERITY_ANSI_CODE: Record<Diagnostic["severity"], string> = {
	error: "31", // red
	warning: "33", // yellow
	info: "36", // cyan
};

function formatDiagnostic(d: Diagnostic, file: string, color = false): string {
	const r = d.range;
	const loc = r ? `${file}:${r.start.line}:${r.start.column}` : file;
	const code = d.code ? ` [${d.code}]` : "";
	const severity = color
		? `\x1b[${SEVERITY_ANSI_CODE[d.severity]}m${d.severity}\x1b[0m`
		: d.severity;
	return `${loc}: ${severity}${code}: ${d.message}`;
}

export interface ShouldColorizeInput {
	/** True when the user passed --no-color. */
	noColorFlag: boolean;
	/** The output stream color would be written to (e.g. process.stdout). */
	stream: { isTTY?: boolean };
	/** The process environment (checked for NO_COLOR). */
	env: { NO_COLOR?: string };
}

/** ADR/#180: color is enabled only when stdout is a TTY, NO_COLOR is unset, and --no-color was not passed. */
export function shouldColorize(input: ShouldColorizeInput): boolean {
	if (input.noColorFlag) return false;
	if (input.env.NO_COLOR !== undefined) return false;
	return Boolean(input.stream.isTTY);
}

function isCommandResult(v: string | CommandResult): v is CommandResult {
	return typeof v === "object";
}

function readSource(file: string): string | CommandResult {
	if (file === "-") {
		return readFileSync(0, "utf-8");
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

/**
 * Shared file loader for `loadExtendsChain` and `loadSubflowGraph`: reads +
 * analyzes a file by absolute path.
 */
function fileLoader(path: string): ReturnType<typeof analyze> | null {
	try {
		const src = readFileSync(path, "utf-8");
		return analyze(wrapPresetSource(path, src));
	} catch {
		return null;
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
	hints?: boolean;
	strict?: boolean;
	json?: boolean;
	color?: boolean;
}

export function runCheck(file: string, opts: CheckOptions = {}): CommandResult {
	const src = readSource(file);
	if (isCommandResult(src)) return src;
	const { diagnostics, edges, nodeKinds, frontmatter } = analyze(
		src,
		opts.strict ? { strict: true } : undefined,
	);
	const lines = diagnostics.map((d) => formatDiagnostic(d, file, opts.color));
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
				stdout: `${JSON.stringify({ ok: true, diagnostics })}\n`,
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
	const multiDiags: Diagnostic[] = [];

	// --- Subflow checks ---
	const subflowGraph = loadSubflowGraph(absFile, fileLoader);
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
	const extendsChain = loadExtendsChain(absFile, fileLoader);
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
		return fail(
			`${errs.map((d) => formatDiagnostic(d, file, opts.color)).join("\n")}\n`,
		);
	}

	const extraLines: string[] = [];
	const artifactMeta = frontmatter?.artifact ?? undefined;

	let hints: ConsumerAsymmetryHint[] = [];
	let hintsOmitted = 0;
	if (opts.hints) {
		const { consumerAsymmetry, consumerAsymmetryRemainder } = auditGraph(
			edges,
			nodeKinds,
			artifactMeta,
		);
		hints = consumerAsymmetry;
		hintsOmitted = consumerAsymmetryRemainder;
		for (const hint of hints) {
			extraLines.push(
				`consumer asymmetry (hint): ${hint.artifact} lacks [${hint.missingProcesses.join(", ")}] present on same-group ${hint.sibling}`,
			);
		}
		if (hintsOmitted > 0) {
			extraLines.push(`... (${hintsOmitted} more)`);
		}
	}

	if (opts.json) {
		const allDiags = [...diagnostics, ...multiDiags];
		const payload: Record<string, unknown> = {
			ok: true,
			diagnostics: allDiags,
		};
		if (opts.hints) {
			payload.hints = hints;
			if (hintsOmitted > 0) payload.hintsOmitted = hintsOmitted;
		}
		return {
			stdout: `${JSON.stringify(payload)}\n`,
			stderr: "",
			exitCode: 0,
		};
	}

	const allLines = [
		...lines,
		...multiDiags.map((d) => formatDiagnostic(d, file, opts.color)),
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
	check?: boolean;
}
export function runFmt(file: string, opts: FmtOptions = {}): CommandResult {
	if (opts.check && opts.write) {
		return fail("--check cannot be combined with --write\n", 2);
	}
	if (file === "-" && opts.write) {
		return fail("--write cannot be used with stdin (-)\n", 2);
	}
	const source = readSource(file);
	if (isCommandResult(source)) return source;
	const { output, diagnostics } = format(source, { style: "flows" });
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	if (opts.check) {
		const changed = output !== source;
		return {
			stdout: changed ? "not formatted\n" : "",
			stderr: "",
			exitCode: changed ? 1 : 0,
		};
	}
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

export interface GraphEdgesOptions {
	json?: boolean;
}

export function runGraphEdges(
	file: string,
	opts: GraphEdgesOptions = {},
): CommandResult {
	const normSrc = readSource(file);
	if (isCommandResult(normSrc)) return normSrc;
	const { edges, graph, diagnostics } = analyze(normSrc);
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	const sorted = sortEdges(edges, graph);
	if (opts.json) {
		return ok(`${JSON.stringify({ ok: true, edges: sorted })}\n`);
	}
	return ok(formatEdges(sorted));
}

export interface ReadyOptions {
	best?: boolean;
	json?: boolean;
}

/**
 * Core ready-process algorithm operating on pre-analyzed data.
 * "Ready" = all input artifacts done/undefined AND at least one output still actionable (not done/wip/suspended/waiting).
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
	const { processInputs, processOutputs } = groupEdges(edges);

	const readyIds: string[] = [];
	for (const [pid, inputs] of processInputs) {
		if (nodeKinds.get(pid) !== "process") continue;
		const allInputsDone = inputs.every((aid) => {
			const s = artifactMeta[aid]?.status;
			return s === "done" || s === undefined;
		});
		if (!allInputsDone) continue;
		const outputs = processOutputs.get(pid) ?? [];
		const outputsInert =
			outputs.length > 0 &&
			outputs.every((aid) => {
				const s = artifactMeta[aid]?.status;
				return (
					s === "done" || s === "suspended" || s === "waiting" || s === "wip"
				);
			});
		if (!outputsInert) readyIds.push(pid);
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
	warnings: Diagnostic[];
} {
	const { diagnostics, edges, nodeKinds, frontmatter } = analyze(src, {
		readyGate: true,
	});
	if (hasErrors(diagnostics))
		return { readyIds: [], isRoadmap: false, warnings: [] };

	const warnings = diagnostics.filter((d) => d.code === "W006");
	const pfdType = frontmatter?.type;
	const isRoadmap = pfdType === undefined || pfdType === "roadmap";
	if (!isRoadmap) return { readyIds: [], isRoadmap: false, warnings };

	const artifactMeta = frontmatter?.artifact ?? {};
	const { readyIds } = computeReadyIdsCore(edges, nodeKinds, artifactMeta);
	return { readyIds, isRoadmap: true, warnings };
}

export function runReady(file: string, opts: ReadyOptions = {}): CommandResult {
	const src = readSource(file);
	if (isCommandResult(src)) return src;

	const { diagnostics, edges, nodeKinds, frontmatter } = analyze(src, {
		readyGate: true,
	});
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

	const warnings = diagnostics.filter((d) => d.code === "W006");
	const warnText = warnings.length ? diagText(warnings, file) : "";

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
		const { artifactConsumers, processOutputs: processOutputLists } =
			groupEdges(edges);
		// Precompute process output artifact sets (O(m) once)
		const processOutputSets = new Map<string, Set<string>>();
		for (const [pid, outputs] of processOutputLists) {
			processOutputSets.set(pid, new Set(outputs));
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

	type ReadyItem = {
		id: string;
		label: string;
		inputs: string[];
		outputs: string[];
	};
	const toItem = (pid: string): ReadyItem => ({
		id: pid,
		label: frontmatter?.process?.[pid]?.label ?? pid,
		inputs: processInputs.get(pid) ?? [],
		outputs: processOutputs.get(pid) ?? [],
	});

	const readyItems = readyIds.map(toItem);
	const bestItem = bestId ? toItem(bestId) : undefined;

	if (opts.json) {
		const payload: Record<string, unknown> = { ok: true, ready: readyItems };
		if (opts.best && bestItem) payload.best = bestItem;
		if (warnings.length) payload.warnings = warnings;
		return ok(`${JSON.stringify(payload)}\n`, warnText);
	}

	if (readyItems.length === 0) {
		return ok("No ready processes. Check artifact statuses.\n", warnText);
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
	return ok(`${lines.join("\n")}\n`, warnText);
}

export interface MetaSetOptions {
	json?: boolean;
}

/** Fields whose values are arrays/maps — meta set only writes scalars. */
const NON_SCALAR_FIELDS = new Set([
	"tags",
	"parts",
	"externalStakeholders",
	"boundary",
]);

/**
 * Render a value as a single-line YAML scalar, double-quoting when a bare
 * scalar would misparse (YAML indicators, colon, quotes, leading/trailing
 * whitespace, ...). Inner spaces are fine bare ("make spec").
 */
function yamlScalar(value: string): string {
	const needsQuoting =
		value === "" ||
		/[:#"'\\\n]/.test(value) ||
		/^[\s[\]{}&*!|>%@`,?-]/.test(value) ||
		/^\s|\s$/.test(value);
	if (!needsQuoting) return value;
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")}"`;
}

/**
 * Rewrite one node's field in the raw source, preserving all other
 * formatting. The id is escaped since quoted ids may contain regex
 * metacharacters (#430). Two styles are supported:
 *   block-style: "<indent><id>:\n  <fields>..."
 *   flow-style:  "<indent><id>: { key: val, ... }"  (#415)
 * Returns null when the id has no frontmatter entry.
 */
function setFieldInSource(
	src: string,
	id: string,
	field: string,
	scalar: string,
): string | null {
	const frontmatterMatch = /^---\n([\s\S]*?\n)---\n/.exec(src);
	const fmBlock = frontmatterMatch?.[1];
	if (!frontmatterMatch || !fmBlock) return null;
	const fmBodyStart = frontmatterMatch[0].length - fmBlock.length - 4; // after "---\n"

	const escapedId = escapeRe(id);
	const escapedField = escapeRe(field);
	const headerRe = new RegExp(`^(\\s+)${escapedId}:\\s*\\n`, "m");
	const headerMatch = headerRe.exec(fmBlock);

	const flowHeaderRe = new RegExp(
		`^(\\s+)${escapedId}:\\s*(\\{[^}]*\\})[ \\t]*$`,
		"m",
	);
	const flowMatch = headerMatch ? null : flowHeaderRe.exec(fmBlock);

	if (!headerMatch && !flowMatch) return null;

	let newFm: string;
	if (flowMatch) {
		// Flow-style: update or insert the field within "{ ... }" on the same line
		const flowBody = flowMatch[2]!;
		const kvRe = new RegExp(
			`\\b${escapedField}:\\s*("(?:[^"\\\\]|\\\\.)*"|[^,}]*)`,
		);
		let newFlowBody: string;
		if (kvRe.test(flowBody)) {
			newFlowBody = flowBody.replace(kvRe, `${field}: ${scalar}`);
		} else {
			const inner = flowBody.slice(1, -1).trim();
			newFlowBody = inner
				? `{ ${inner}, ${field}: ${scalar} }`
				: `{ ${field}: ${scalar} }`;
		}
		const matchedLine = flowMatch[0]!;
		const newLine = matchedLine.replace(flowBody, newFlowBody);
		newFm =
			fmBlock.slice(0, flowMatch.index) +
			newLine +
			fmBlock.slice(flowMatch.index + matchedLine.length);
	} else {
		// Block-style. Detect indent width from the header line (#430).
		const nodeIndent = headerMatch![1]!.length;
		const afterHeader = fmBlock.slice(
			headerMatch!.index + headerMatch![0].length,
		);
		const afterHeaderNl = afterHeader.indexOf("\n");
		const firstLine =
			afterHeaderNl === -1 ? afterHeader : afterHeader.slice(0, afterHeaderNl);
		const firstLineIndent = firstLine.length - firstLine.trimStart().length;
		const childIndent =
			firstLine.trim() !== "" && firstLineIndent > nodeIndent
				? firstLineIndent
				: nodeIndent * 2;

		const nodePad = " ".repeat(nodeIndent);
		const childPad = " ".repeat(childIndent);

		// Replace "<childPad><field>: <old>" under this node — including any
		// deeper-indented continuation lines (multi-line block scalars), so
		// replacing them never leaves orphan lines — or insert after the header.
		const fieldLineRe = new RegExp(
			`(${nodePad}${escapedId}:[ \\t]*\\n(?:${childPad}[^\\n]*\\n)*?)${childPad}${escapedField}:[^\\n]*\\n(?:${childPad} +[^\\n]*\\n)*`,
		);
		if (fieldLineRe.test(fmBlock)) {
			newFm = fmBlock.replace(
				fieldLineRe,
				`$1${childPad}${field}: ${scalar}\n`,
			);
		} else {
			newFm = fmBlock.replace(
				new RegExp(`(${nodePad}${escapedId}:[ \\t]*\\n)`),
				`$1${childPad}${field}: ${scalar}\n`,
			);
		}
	}

	return (
		src.slice(0, fmBodyStart) + newFm + src.slice(fmBodyStart + fmBlock.length)
	);
}

export function runMetaSet(
	file: string,
	idList: string,
	field: string,
	value: string,
	opts: MetaSetOptions = {},
): CommandResult {
	if (file === "-") {
		return fail("meta set cannot be used with stdin (-)\n", 2);
	}
	if (field.includes(".")) {
		return fail(
			`meta set: '${field}' is a derived read-only field and cannot be set\n`,
			2,
		);
	}
	if (NON_SCALAR_FIELDS.has(field)) {
		return fail(`meta set: '${field}' is not a scalar field\n`, 2);
	}
	if (
		field === "status" &&
		!STATUS_VALUES.includes(value as (typeof STATUS_VALUES)[number])
	) {
		return fail(
			`meta set: invalid status '${value}' (valid: ${STATUS_VALUES.join(" | ")})\n`,
			2,
		);
	}
	if (field === "index" && !/^\d+$/.test(value)) {
		return fail(
			`meta set: index must be a non-negative integer, got '${value}'\n`,
			2,
		);
	}
	const ids = splitCommaList(idList);
	if (ids.length === 0) return fail(HELP_META_SET, 2);

	const src = readSource(file);
	if (isCommandResult(src)) return src;

	const { diagnostics, nodeKinds } = analyze(src);
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;

	// Validate every id and field/kind pairing before touching anything, so a
	// multi-id call is atomic: either all writes land or none do.
	const missing = ids.filter((id) => !nodeKinds.has(id));
	if (missing.length > 0) {
		return fail(`error: id(s) not found in ${file}: ${missing.join(", ")}\n`);
	}
	for (const id of ids) {
		const kind = nodeKinds.get(id);
		if (kind !== "artifact" && kind !== "process" && kind !== "group") continue;
		if (!KNOWN_FIELDS[kind].has(field)) {
			return fail(
				`meta set: '${field}' is not a valid ${kind} field (id: ${id})\n`,
				2,
			);
		}
	}

	// Snapshot ready set before mutation (roadmap only)
	const { readyIds: beforeIds, isRoadmap } = computeReadyIds(src);
	const beforeSet = new Set(beforeIds);

	const scalar = yamlScalar(value);
	let newSrc = src;
	for (const id of ids) {
		const applied = setFieldInSource(newSrc, id, field, scalar);
		if (applied === null) {
			return fail(`error: '${id}' not found in ${file}\n`);
		}
		newSrc = applied;
	}

	// Safety net: never write a rewrite that introduces errors the original
	// didn't have (rewriter bug or unsupported YAML style).
	if (hasErrors(analyze(newSrc).diagnostics)) {
		return fail(
			`meta set: refusing to write ${file}: the rewrite would introduce parse errors\n`,
		);
	}
	writeFileSync(file, newSrc, "utf-8");

	// Recompute against the written file (roadmap only) so newly-ready processes
	// and warnings (e.g. W006) reflect post-mutation state, not the pre-write snapshot.
	const after = isRoadmap ? computeReadyIds(newSrc) : undefined;
	const newlyReady: string[] = after
		? after.readyIds.filter((id) => !beforeSet.has(id))
		: [];
	const warnings = after?.warnings ?? [];

	const warnText = warnings.length ? diagText(warnings, file) : "";

	if (opts.json) {
		const payload: Record<string, unknown> = { ok: true, newlyReady };
		if (warnings.length) payload.warnings = warnings;
		return ok(`${JSON.stringify(payload)}\n`, warnText);
	}
	if (newlyReady.length > 0) {
		return ok(`newly ready: ${newlyReady.join(", ")}\n`, warnText);
	}
	return ok("", warnText);
}

export interface GetOptions {
	id?: string;
	field?: string;
	json?: boolean;
}

function splitCommaList(raw: string): string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

const KNOWN_FIELDS: Record<"artifact" | "process" | "group", Set<string>> = {
	artifact: new Set([
		"label",
		"description",
		"owner",
		"externalStakeholders",
		"parts",
		"index",
		"status",
		"tags",
		"group",
		"criteria",
		"location",
		"revises",
	]),
	process: new Set([
		"label",
		"description",
		"owner",
		"externalStakeholders",
		"index",
		"group",
		"tags",
		"command",
		"location",
		"subflow",
		"boundary",
	]),
	group: new Set(["label", "color", "parent"]),
};

/**
 * Read-only fields computed from a base field rather than stored in
 * frontmatter. `location.resolved` auto-accompanies `location` (artifact and
 * process); `command.cwd` auto-accompanies `command` (process only). Both
 * can also be requested explicitly via the field positional, in which case
 * only the derived value is returned (the base field is not auto-added).
 */
const DERIVED_FIELDS: Record<"artifact" | "process" | "group", Set<string>> = {
	artifact: new Set(["location.resolved"]),
	process: new Set(["location.resolved", "command.cwd"]),
	group: new Set(),
};

/** Classify a single `location:` element per spec §15.8 and resolve it if it's not a URL. */
function resolveLocationElement(
	docFsPath: string,
	element: string,
	basePath?: string,
): string {
	return element.includes("://")
		? element
		: resolveLocationFsPath(docFsPath, element, basePath);
}

function resolveLocationDerived(
	docFsPath: string,
	value: unknown,
	basePath?: string,
): unknown {
	return Array.isArray(value)
		? value.map((v) => resolveLocationElement(docFsPath, String(v), basePath))
		: resolveLocationElement(docFsPath, String(value), basePath);
}

/** The directory commands run in: basePath resolved against the file's dir (§15.8), independent of the command string itself. */
function commandCwdDerived(docFsPath: string, basePath?: string): string {
	return resolveLocationFsPath(docFsPath, ".", basePath);
}

export function runGet(file: string, opts: GetOptions = {}): CommandResult {
	if (!opts.id) return fail(`error: id is required\n\n${HELP_GET}`, 2);
	const ids = splitCommaList(opts.id);
	if (ids.length === 0) return fail(`error: id is required\n\n${HELP_GET}`, 2);

	// Omitted field positional means "all set fields"; present-but-empty
	// (e.g. an empty/blank field positional) is still a usage error.
	const explicitFields =
		opts.field !== undefined ? splitCommaList(opts.field) : undefined;
	if (explicitFields !== undefined && explicitFields.length === 0) {
		return fail(`error: field is required\n\n${HELP_GET}`, 2);
	}

	const src = readSource(file);
	if (isCommandResult(src)) return src;

	const { diagnostics, frontmatter, nodeKinds } = analyze(src);
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;

	const basePath = frontmatter?.basePath;
	const docFsPath = file === "-" ? null : resolve(file);

	const metaFor = (id: string): Record<string, unknown> | undefined => {
		switch (nodeKinds.get(id)) {
			case "artifact":
				return frontmatter?.artifact?.[id];
			case "process":
				return frontmatter?.process?.[id];
			case "group":
				return frontmatter?.group?.[id];
			default:
				return undefined;
		}
	};

	const missing: string[] = [];
	// Keyed by "kind::field" so one warning covers every id sharing that
	// (kind, field) pair instead of repeating per id (#479 usability re-check).
	const unknownFieldIds = new Map<string, string[]>();
	// Keyed by field name so one warning covers every id that hit the same
	// can't-resolve-from-stdin case.
	const stdinFieldIds = new Map<string, string[]>();
	const flagUnknown = (
		kind: "artifact" | "process" | "group",
		field: string,
		id: string,
	) => {
		const key = `${kind}::${field}`;
		const affected = unknownFieldIds.get(key);
		if (affected) affected.push(id);
		else unknownFieldIds.set(key, [id]);
	};
	const flagStdin = (field: string, id: string) => {
		const affected = stdinFieldIds.get(field);
		if (affected) affected.push(id);
		else stdinFieldIds.set(field, [id]);
	};

	const values: Record<string, Record<string, unknown>> = {};
	const displayFieldsById: Record<string, string[]> = {};

	for (const id of ids) {
		const kind = nodeKinds.get(id);
		if (kind === undefined) {
			missing.push(id);
			continue;
		}
		const meta = metaFor(id);
		const row: Record<string, unknown> = {};
		const displayFields: string[] = [];
		const addField = (field: string) => {
			if (!displayFields.includes(field)) displayFields.push(field);
		};

		// Derived fields auto-accompany their base field right after it, but
		// only when the node actually has the base field and we have a real
		// file path to resolve against (not stdin).
		const addLocationResolvedIfApplicable = () => {
			if (meta?.location === undefined || docFsPath === null) return;
			row["location.resolved"] = resolveLocationDerived(
				docFsPath,
				meta.location,
				basePath,
			);
			addField("location.resolved");
		};
		const addCommandCwdIfApplicable = () => {
			if (meta?.command === undefined || docFsPath === null) return;
			row["command.cwd"] = commandCwdDerived(docFsPath, basePath);
			addField("command.cwd");
		};

		if (explicitFields === undefined) {
			// field positional omitted: every field present on this node, raw, in
			// frontmatter order, plus applicable derived fields.
			for (const field of meta ? Object.keys(meta) : []) {
				row[field] = meta![field];
				addField(field);
				if (field === "location") addLocationResolvedIfApplicable();
				if (field === "command") addCommandCwdIfApplicable();
			}
		} else {
			for (const field of explicitFields) {
				if (field === "location.resolved" || field === "command.cwd") {
					addField(field);
					if (!DERIVED_FIELDS[kind].has(field)) flagUnknown(kind, field, id);
					if (docFsPath === null) {
						row[field] = null;
						flagStdin(field, id);
						continue;
					}
					if (field === "location.resolved") {
						row[field] =
							meta?.location === undefined
								? null
								: resolveLocationDerived(docFsPath, meta.location, basePath);
					} else {
						row[field] = commandCwdDerived(docFsPath, basePath);
					}
					continue;
				}
				addField(field);
				if (!KNOWN_FIELDS[kind].has(field)) flagUnknown(kind, field, id);
				row[field] = meta?.[field] ?? null;
				if (field === "location") addLocationResolvedIfApplicable();
				if (field === "command") addCommandCwdIfApplicable();
			}
		}

		values[id] = row;
		displayFieldsById[id] = displayFields;
	}

	const unknownWarnings = [...unknownFieldIds.entries()].map(
		([key, affectedIds]) => {
			const field = key.split("::")[1];
			return `warning: '${field}' is not a recognized field for ${affectedIds.length === 1 ? `'${affectedIds[0]}'` : `id(s) ${affectedIds.join(", ")}`} (possible typo?)`;
		},
	);
	const stdinWarnings = [...stdinFieldIds.entries()].map(
		([field, affectedIds]) =>
			`warning: cannot resolve '${field}' for ${affectedIds.length === 1 ? `'${affectedIds[0]}'` : `id(s) ${affectedIds.join(", ")}`}: no file path when reading from stdin`,
	);
	const warnings = [...unknownWarnings, ...stdinWarnings];
	const warnText = warnings.length ? `${warnings.join("\n")}\n` : "";

	const linesFor = (idsToPrint: string[]) =>
		idsToPrint.flatMap((id) =>
			(displayFieldsById[id] ?? []).map((field) =>
				formatGetLine(id, field, values),
			),
		);

	if (missing.length > 0) {
		const errorText = `error: id(s) not found in ${file}: ${missing.join(", ")}\n`;
		if (opts.json) {
			return fail(
				`${warnText}${errorText}`,
				1,
				`${JSON.stringify({ ok: false, values, missing })}\n`,
			);
		}
		const lines = linesFor(ids.filter((id) => values[id]));
		const stdout = lines.length ? `${lines.join("\n")}\n` : "";
		return fail(`${warnText}${errorText}`, 1, stdout);
	}

	if (opts.json) {
		return ok(`${JSON.stringify({ ok: true, values })}\n`, warnText);
	}

	const lines = linesFor(ids);
	return ok(lines.length ? `${lines.join("\n")}\n` : "", warnText);
}

function formatGetLine(
	id: string,
	field: string,
	values: Record<string, Record<string, unknown>>,
): string {
	const v = values[id]?.[field];
	const display = Array.isArray(v) ? v.join(", ") : v === null ? "" : String(v);
	return `${id}.${field}: ${display}`;
}

export interface GraphAnalysisOptions {
	json?: boolean;
}

type GraphLoadResult =
	| { graph: ReturnType<typeof analyze>["graph"] }
	| CommandResult;

function isGraphLoadFailure(v: GraphLoadResult): v is CommandResult {
	return "exitCode" in v;
}

function loadGraph(file: string): GraphLoadResult {
	const src = readSource(file);
	if (isCommandResult(src)) return src;
	const { diagnostics, graph } = analyze(src);
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	return { graph };
}

/** Shared not-found error shape across all graph-analysis subcommands (#479 usability review). */
function idsNotFoundError(file: string, ids: string[]): CommandResult {
	return fail(`error: id(s) not found in ${file}: ${ids.join(", ")}\n`, 1);
}

export function runNeighbors(
	file: string,
	id: string,
	opts: GraphAnalysisOptions = {},
): CommandResult {
	const loaded = loadGraph(file);
	if (isGraphLoadFailure(loaded)) return loaded;
	if (!loaded.graph.nodes.has(id)) return idsNotFoundError(file, [id]);
	const { predecessors, successors } = computeNeighbors(loaded.graph, id);
	if (opts.json) {
		return ok(`${JSON.stringify({ ok: true, predecessors, successors })}\n`);
	}
	return ok(
		`predecessors: ${predecessors.join(", ") || "(none)"}\nsuccessors: ${successors.join(", ") || "(none)"}\n`,
	);
}

export function runImpact(
	file: string,
	id: string,
	opts: GraphAnalysisOptions = {},
): CommandResult {
	const loaded = loadGraph(file);
	if (isGraphLoadFailure(loaded)) return loaded;
	if (!loaded.graph.nodes.has(id)) return idsNotFoundError(file, [id]);
	const impact = computeImpact(loaded.graph, id).sort();
	if (opts.json) return ok(`${JSON.stringify({ ok: true, impact })}\n`);
	return ok(impact.length ? `${impact.join("\n")}\n` : "(none)\n");
}

export function runDependsOn(
	file: string,
	id: string,
	opts: GraphAnalysisOptions = {},
): CommandResult {
	const loaded = loadGraph(file);
	if (isGraphLoadFailure(loaded)) return loaded;
	if (!loaded.graph.nodes.has(id)) return idsNotFoundError(file, [id]);
	const dependsOn = computeDependsOn(loaded.graph, id).sort();
	if (opts.json) return ok(`${JSON.stringify({ ok: true, dependsOn })}\n`);
	return ok(dependsOn.length ? `${dependsOn.join("\n")}\n` : "(none)\n");
}

export function runPath(
	file: string,
	from: string,
	to: string,
	opts: GraphAnalysisOptions = {},
): CommandResult {
	const loaded = loadGraph(file);
	if (isGraphLoadFailure(loaded)) return loaded;
	const missing = [from, to].filter((id) => !loaded.graph.nodes.has(id));
	if (missing.length > 0) return idsNotFoundError(file, missing);
	const paths = computePaths(loaded.graph, from, to);
	if (opts.json) return ok(`${JSON.stringify({ ok: true, paths })}\n`);
	if (paths.length === 0) return ok("no path found\n");
	return ok(`${paths.map((p) => p.join(" -> ")).join("\n")}\n`);
}

export interface StatsOptions extends GraphAnalysisOptions {
	limit?: number;
}

/** Above this row count, text mode (not --json) hints that --limit exists (#479 usability review). */
const STATS_HINT_THRESHOLD = 20;

export function runStats(file: string, opts: StatsOptions = {}): CommandResult {
	const loaded = loadGraph(file);
	if (isGraphLoadFailure(loaded)) return loaded;
	const all = computeStats(loaded.graph);
	const stats = opts.limit !== undefined ? all.slice(0, opts.limit) : all;
	if (opts.json) return ok(`${JSON.stringify({ ok: true, stats })}\n`);
	const lines = stats.map(
		(s) =>
			`${s.id} (${s.kind})   fan-in=${s.fanIn}  fan-out=${s.fanOut}  total=${s.fanIn + s.fanOut}`,
	);
	const hint =
		opts.limit === undefined && all.length > STATS_HINT_THRESHOLD
			? `(${all.length} nodes total — pass --limit <n> to narrow)\n`
			: "";
	return ok(`${lines.join("\n")}\n`, hint);
}

export interface GraphSummaryOptions {
	json?: boolean;
}

/**
 * Shared loader for graph summary/io: reads + analyzes a file, failing on
 * errors, and returns the pieces auditGraph needs.
 */
function loadForAudit(file: string):
	| {
			edges: ReturnType<typeof analyze>["edges"];
			nodeKinds: ReturnType<typeof analyze>["nodeKinds"];
			artifactMeta: NonNullable<
				ReturnType<typeof analyze>["frontmatter"]
			>["artifact"];
	  }
	| CommandResult {
	const src = readSource(file);
	if (isCommandResult(src)) return src;
	const { diagnostics, edges, nodeKinds, frontmatter } = analyze(src);
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;
	return { edges, nodeKinds, artifactMeta: frontmatter?.artifact ?? undefined };
}

export function runGraphSummary(
	file: string,
	opts: GraphSummaryOptions = {},
): CommandResult {
	const loaded = loadForAudit(file);
	if ("exitCode" in loaded) return loaded;
	const { edges, nodeKinds, artifactMeta } = loaded;
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
	if (opts.json) {
		return ok(
			`${JSON.stringify({
				ok: true,
				artifacts: artifactCount,
				processes: processCount,
				edges: primaryEdgeCount,
				externalInputs: externalInputs.length,
				terminals: terminals.length,
			})}\n`,
		);
	}
	return ok(
		`artifacts: ${artifactCount}, processes: ${processCount}, edges: ${primaryEdgeCount}, external_inputs: ${externalInputs.length}, terminals: ${terminals.length}\n`,
	);
}

export function runGraphIo(
	file: string,
	opts: GraphSummaryOptions = {},
): CommandResult {
	const loaded = loadForAudit(file);
	if ("exitCode" in loaded) return loaded;
	const { edges, nodeKinds, artifactMeta } = loaded;
	const { terminals, externalInputs } = auditGraph(
		edges,
		nodeKinds,
		artifactMeta,
	);
	if (opts.json) {
		return ok(`${JSON.stringify({ ok: true, externalInputs, terminals })}\n`);
	}
	return ok(
		`external inputs: ${externalInputs.join(", ")}\nterminal artifacts: ${terminals.join(", ")}\n`,
	);
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
	warnings?: Diagnostic[];
}

export function runStatusGaps(
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
	} = analyze(roadmapSrc, { readyGate: true });
	const roadmapFail = failIfErrors(roadmapDiags, roadmapFile);
	if (roadmapFail) return roadmapFail;

	const warnings = roadmapDiags.filter((d) => d.code === "W006");
	const warnText = warnings.length ? diagText(warnings, roadmapFile) : "";

	const ROADMAP_REQUIRED_TYPE = "roadmap" satisfies PfdType;
	if (
		roadmapFm?.type !== undefined &&
		roadmapFm.type !== ROADMAP_REQUIRED_TYPE
	) {
		return fail(
			`status gaps: roadmap file must have type: roadmap. Got type: ${roadmapFm.type}\n`,
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
				`status gaps: flow file must be workflow or runtime-pipeline, not roadmap: ${flowFile}\n`,
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
	if (warnings.length) result.warnings = warnings;

	if (opts.json) {
		const exitCode = gaps.length > 0 ? 1 : 0;
		return {
			stdout: `${JSON.stringify(result)}\n`,
			stderr: warnText,
			exitCode,
		};
	}

	if (gaps.length === 0) {
		return ok(
			"All todo artifacts in flow files are tracked in the roadmap.\n",
			warnText,
		);
	}

	const lines: string[] = [`Untracked todo artifacts (${gaps.length}):`];
	for (const g of gaps) {
		lines.push(`  ${g.artifactId.padEnd(20)} "${g.label}"   in: ${g.file}`);
	}
	lines.push(
		"",
		"Add a build chain in the roadmap for each untracked artifact.",
	);
	return { stdout: `${lines.join("\n")}\n`, stderr: warnText, exitCode: 1 };
}

export type { BinaryFormat };
export { svgToBinary };
export type CliRenderFormat = RenderFormat | BinaryFormat;

export interface RenderOptions {
	format?: CliRenderFormat;
}
export async function runRender(
	file: string,
	opts: RenderOptions = {},
): Promise<CommandResult> {
	const fmt = opts.format ?? "dot";
	const graphSrc = readSource(file);
	if (isCommandResult(graphSrc)) return graphSrc;
	const { graph, frontmatter, diagnostics } = analyze(graphSrc);
	const failed = failIfErrors(diagnostics, file);
	if (failed) return failed;

	// Resolve extends-inherited statusStyles/tag/group (§2.9.4) so presets
	// shared across files actually affect rendering, not just `check`.
	// Skipped for stdin (-): relative extends paths need a base file.
	let effectiveFrontmatter = frontmatter;
	if (file !== "-") {
		effectiveFrontmatter = resolveEffectiveFrontmatter(
			resolve(file),
			frontmatter,
			fileLoader,
		);
	}

	if (fmt === "pdf" || fmt === "png") {
		const svg = await renderGraph(graph, effectiveFrontmatter, {
			format: "svg",
		});
		try {
			const buf = await svgToBinary(svg, fmt);
			return { stdout: "", stderr: "", exitCode: 0, binaryOutput: buf };
		} catch (e) {
			return fail(e instanceof Error ? `${e.message}\n` : String(e));
		}
	}
	const out = await renderGraph(graph, effectiveFrontmatter, { format: fmt });
	return ok(out.endsWith("\n") ? out : `${out}\n`);
}

export type { DiffReport };

export interface DiffOptions {
	format?: "text" | "dot" | "svg";
	json?: boolean;
}

export async function runDiff(
	fileA: string,
	fileB: string,
	opts: DiffOptions = {},
): Promise<CommandResult> {
	const fmt = opts.format ?? "text";
	if (opts.json && (fmt === "dot" || fmt === "svg")) {
		return fail("--json cannot be combined with --format dot|svg\n", 2);
	}
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
	if (opts.json) {
		return ok(`${JSON.stringify({ ok: true, diff: r })}\n`);
	}
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

const HELP_CHECK = `usage: pfdsl check <file|-> [--strict] [--hints] [--json] [--no-color]

Validate a .pfdsl file. Use - to read from stdin.

Options:
  --strict   error if feedback source not reachable from target process
  --hints    also emit consumer asymmetry hints for same-group artifacts
  --json     output diagnostics as JSON ({ ok, diagnostics, hints? })
  --no-color disable ANSI color codes (also: NO_COLOR env var)

For topology queries (terminal artifacts, external inputs, counts) see
\`pfdsl graph io\` and \`pfdsl graph summary\`.
`;

const HELP_GRAPH_SUMMARY = `usage: pfdsl graph summary <file|-> [--json]

Print aggregate counts for the graph: artifacts, processes, primary edges,
external inputs, and terminal artifacts. Use - to read from stdin.

  --json  output as JSON ({ ok, artifacts, processes, edges, externalInputs, terminals })

Exit codes:
  0  success
  1  parse/validation error
  2  invalid usage
`;

const HELP_GRAPH_IO = `usage: pfdsl graph io <file|-> [--json]

Print the graph's boundary: external inputs (artifacts consumed but never
produced — where the flow starts) and terminal artifacts (produced but never
consumed — where it ends). Artifacts with externalStakeholders are treated
as having an external consumer and excluded from terminals. Use - to read
from stdin.

  --json  output as JSON ({ ok, externalInputs: string[], terminals: string[] })

Exit codes:
  0  success
  1  parse/validation error
  2  invalid usage
`;

const HELP_FMT = `usage: pfdsl fmt <file|-> [--write] [--check]

Format a .pfdsl file, grouping each process with its inputs and outputs.
Use - to read from stdin (--write not allowed with stdin; --check is allowed).

Options:
  --write  rewrite the file in place (cannot be used with -)
  --check  do not write; exit 1 if formatting would change anything (CI)
           (cannot be combined with --write)
`;

const HELP_REINDEX = `usage: pfdsl meta reindex <file|-> [--write] [--check] [--renumber] [--json]

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

const HELP_SORT = `usage: pfdsl meta sort <file|-> --by <keys> [--write] [--check]

Sort artifact and process node definitions within each frontmatter section.
Each section is sorted independently. Use - to read from stdin.

Options:
  --by <keys>   comma-separated sort keys: index, topological, group, id
                e.g. --by group,index  (primary=group, secondary=index)
  --write       rewrite the file in place (cannot be used with -)
  --check       exit 1 if the file is not already sorted (CI mode)
`;

const HELP_GRAPH_EDGES = `usage: pfdsl graph edges <file|-> [--json]

Print canonical edge list. Use - to read from stdin.

Options:
  --json  output as JSON ({ ok, edges: {kind, artifact, process}[] })
`;

const HELP_RENDER = `usage: pfdsl render <file|-> [--format dot|svg|pdf|png]

Print a Graphviz representation. Use - to read from stdin.

Options:
  --format dot  Graphviz DOT (default)
  --format svg  SVG via Graphviz wasm
  --format pdf  PDF (requires: npm install puppeteer)
  --format png  PNG (requires: npm install puppeteer)
`;

const HELP_DIFF = `usage: pfdsl diff <a> <b> [--format text|dot|svg] [--json]

Show structural differences between two .pfdsl files. Either side may be -
to read from stdin, e.g. \`git show HEAD:f.pfdsl | pfdsl diff - f.pfdsl\`.

Options:
  --format text  human-readable summary (default)
  --format dot   visual diff as Graphviz DOT
  --format svg   visual diff as SVG
  --json         emit the structural report as JSON
                 ({ ok, diff: { addedNodes, removedNodes, changedNodes,
                 addedEdges, removedEdges, addedFeedback, removedFeedback } })
                 (cannot be combined with --format dot|svg)
`;

const HELP_READY = `usage: pfdsl status ready <file|-> [--best] [--json]

List processes whose every input artifact has status: done (or no status set).
Only applies to roadmap files (type: roadmap). Use - to read from stdin.
Omitting type: is treated as roadmap and allowed, with a warning (W006).

Options:
  --best  highlight the process that unblocks the most downstream work
  --json  output as JSON ({ ok, ready: [{id, label, inputs, outputs}], best?, warnings? })
`;

const HELP_META_SET = `usage: pfdsl meta set <file> <id[,id...]> <field> <value> [--json]

Set a scalar frontmatter field on one or more nodes, rewriting the file in
place while preserving its formatting. Multiple comma-separated ids get the
same value; the call is atomic (all writes land or none do). Quote values
containing spaces.

Field-aware validation: status must be one of todo | wip | done | waiting |
suspended; index must be a non-negative integer; the field must be valid for
each node's kind. Array/map fields (tags, parts, externalStakeholders,
boundary) and derived read-only fields (location.resolved, command.cwd)
cannot be set.

When setting status on a roadmap file, reports which processes became newly
ready after the change (once, after all writes).
Omitting type: is treated as roadmap and allowed, with a warning (W006).

  --json    emit JSON ({ ok, newlyReady: string[], warnings? }) instead of text

Exit codes:
  0  success
  1  id not found in the file, or the rewrite was refused
  2  invalid usage (missing argument, invalid field or value)
`;

const HELP_GET = `usage: pfdsl meta get <file|-> <id[,id...]> [field[,field...]] [--json]

Print field values for one or more artifact/process/group ids.

  <id[,id...]>        comma-separated ids (required)
  [field[,field...]]  comma-separated field names (optional). Omit entirely
                      to print every field set in each node's frontmatter
                      entry (raw, in frontmatter order), plus applicable
                      derived fields.
  --json              emit JSON ({ ok, values: { [id]: { [field]: value } } })

\`location\` is returned as the raw value exactly as written (so \`meta get\`
and \`meta set\` round-trip). The resolved filesystem path is a separate
read-only derived field, \`location.resolved\`, which is added to the output
automatically right after \`location\` whenever \`location\` is in the output
(explicitly requested or via an omitted field positional) and the node has
a location. Each location element is classified per spec §15.8: an element
containing "://" is a URL and is passed through unchanged; everything else
(paths and globs) is resolved against the file's basePath. A scalar
location yields a scalar location.resolved; an array yields an array.

\`command.cwd\` works the same way for process nodes: whenever \`command\` is
in the output and the node has a command, \`command.cwd\` (the basePath-
resolved directory commands run in) is added right after it. command.cwd
does not depend on the command string itself.

Either derived field may also be requested explicitly in the field
positional (e.g. location.resolved), in which case only the derived value
is returned — the base field is not auto-added. Use - to read from stdin:
since there is no file path to resolve against, derived fields are silently
omitted from auto-accompaniment, and an explicit request for one returns
null with a warning on stderr instead of failing the command.

A field the node doesn't have prints as an empty value (JSON: null); this is
not an error. A node that exists but has no frontmatter entry at all yields
an empty row (JSON: {}, no text lines). Requesting a field name that isn't a
recognized frontmatter or derived key prints a warning to stderr (possible
typo) but still returns the value (empty, since it's genuinely unset) — this
does not fail the command.

If some requested ids exist and others don't, values for the found ids are
still printed (to stdout, or under "values" in --json) alongside the error
for the missing ones.

Exit codes:
  0  success
  1  one or more requested ids do not exist in the file
  2  invalid usage (missing id, or too many positional arguments)
`;

const HELP_NEIGHBORS = `usage: pfdsl graph neighbors <file|-> <id> [--json]

Print the direct predecessors (in-edges) and successors (out-edges) of a
node — its immediate producer(s)/consumer(s) only, not the full closure.

  --json  output as JSON ({ ok, predecessors: string[], successors: string[] })

Exit codes:
  0  success
  1  id not found in the file
  2  invalid usage (missing id)
`;

const HELP_IMPACT = `usage: pfdsl graph impact <file|-> <id> [--json]

Print the full downstream closure reachable from <id> via primary edges
(everything <id> unblocks, transitively), excluding <id> itself. Text mode
prints one id per line (empty: "(none)"), for easy piping into other tools.

  --json  output as JSON ({ ok, impact: string[] })

Exit codes:
  0  success
  1  id not found in the file
  2  invalid usage (missing id)
`;

const HELP_DEPENDS_ON = `usage: pfdsl graph depends-on <file|-> <id> [--json]

Print the full upstream closure <id> depends on via primary edges
(everything that must exist for <id> to exist), excluding <id> itself. Text
mode prints one id per line (empty: "(none)"), for easy piping into other tools.

  --json  output as JSON ({ ok, dependsOn: string[] })

Exit codes:
  0  success
  1  id not found in the file
  2  invalid usage (missing id)
`;

const HELP_PATH = `usage: pfdsl graph path <file|-> <from> <to> [--json]

Print all simple paths from <from> to <to> via primary edges (empty if
none exist). Answers "is <from> a prerequisite of <to>, and how".

  --json  output as JSON ({ ok, paths: string[][] })

Exit codes:
  0  success (including when no path exists)
  1  <from> or <to> not found in the file
  2  invalid usage (missing from/to)
`;

const HELP_STATS = `usage: pfdsl graph stats <file|-> [--limit <n>] [--json]

Print fan-in/fan-out per node, ranked by total degree descending (hubs
first) then id ascending. Text mode prints a hint to stderr suggesting
--limit when the file has more than ${STATS_HINT_THRESHOLD} nodes and --limit wasn't given
(kept off stdout so \`stats <file> | ...\` pipelines aren't affected).

  --limit <n>  only print the top n rows
  --json       output as JSON ({ ok, stats: {id, kind, fanIn, fanOut}[] })

Exit codes:
  0  success
  2  invalid usage
`;

const HELP_STATUS_GAPS = `usage: pfdsl status gaps <roadmap> <flow> [<flow>...] [--json]

Cross-check todo artifacts in workflow/runtime-pipeline files against the roadmap.
Reports artifacts with status: todo in flow files that have no corresponding entry
in the roadmap, indicating a build chain is missing.
Omitting type: on the roadmap file is treated as roadmap and allowed, with a warning (W006).

  <roadmap>  path to a .pfdsl file with type: roadmap
  <flow>     one or more .pfdsl files with type: workflow or runtime-pipeline

Options:
  --json  output as JSON ({ ok, gaps: [{file, artifactId, label, status}], warnings? })

Exit codes:
  0  all todo artifacts are tracked in the roadmap
  1  one or more todo artifacts have no roadmap entry
  2  invalid usage
`;

const HELP_EXPLAIN = `usage: pfdsl explain <code>

Print the one-line summary and spec section for a diagnostic code (e.g. V021).
Codes come from the FM/L/N/P/V/W families reported by \`pfdsl check\`.

  <code>  a diagnostic code, e.g. V021, P004, W002, FM001

Exit codes:
  0  known code
  2  unknown code, or invalid usage
`;

function severityLabel(
	severities: DiagnosticRegistryEntry["severities"],
): string {
	if (severities.length > 1) return "warning; --strict: error";
	return severities[0] ?? "error";
}

function runExplain(code: string): CommandResult {
	const entry = DIAGNOSTIC_REGISTRY[code];
	if (!entry) {
		const known = Object.keys(DIAGNOSTIC_REGISTRY).sort();
		return fail(
			`Unknown diagnostic code: ${code}\nKnown codes: ${known.join(", ")}\n`,
			2,
		);
	}
	const lines = [
		`${code} (${severityLabel(entry.severities)}): ${entry.summary}`,
		`Defined in: spec §${entry.section}`,
		"",
		`Full text: docs/spec/spec.md §${entry.section} (references/spec.md when using the pfdsl skill)`,
	];
	return ok(`${lines.join("\n")}\n`);
}

const HELP_GRAPH_GROUP = `usage: pfdsl graph <subcommand> ...

Read-only queries on the graph topology. Run
\`pfdsl graph <subcommand> --help\` for details on each.

Subcommands:
  summary <file|->            Print artifact/process/edge counts
  io <file|->                 Print external inputs and terminal artifacts
  stats <file|-> [--limit]    Rank nodes by fan-in/fan-out degree
  neighbors <file|-> <id>     Direct predecessors/successors of a node
  impact <file|-> <id>        Full downstream closure of a node
  depends-on <file|-> <id>    Full upstream closure of a node
  path <file|-> <from> <to>   All simple paths between two nodes
  edges <file|->              Canonical edge list

All subcommands accept --json.
`;

const HELP_META_GROUP = `usage: pfdsl meta <subcommand> ...

Read and write frontmatter metadata. Run
\`pfdsl meta <subcommand> --help\` for details on each.

Subcommands:
  get <file|-> <id[,id...]> [field[,field...]]   Print field values
  set <file> <id> <field> <value>                Set a field value in place
  sort <file|-> --by <keys>                      Sort node definitions
  reindex <file|->                               Assign topological index: values
`;

const HELP_STATUS_GROUP = `usage: pfdsl status <subcommand> ...

Planning queries derived from artifact status. Run
\`pfdsl status <subcommand> --help\` for details on each.

Subcommands:
  ready <file|-> [--best]           List ready-to-start processes
  gaps <roadmap> <flow> [<flow>...] Find todo artifacts missing from the roadmap
`;

export const HELP = `pfdsl <command> [options]

Commands:
  check <file|-> [--strict] [--hints] [--json] [--no-color]
                           Validate a .pfdsl file (- = stdin)
  explain <code>           Print the summary and spec section for a diagnostic code (e.g. V021)
  fmt <file|-> [--write] [--check]
                           Format a .pfdsl file (- = stdin)
  render <file|-> [--format dot|svg|pdf|png]
                           Render as Graphviz DOT (default), SVG, PDF, or PNG (- = stdin)
                           PDF/PNG requires: npm install puppeteer
  diff <a> <b> [--format text|dot|svg]
                           Structural diff (text), or visual diff DOT/SVG

Command groups (run \`pfdsl <group>\` for their subcommands):
  graph summary|io|stats|neighbors|impact|depends-on|path|edges
                           Read-only queries on the graph topology
  meta get|set|sort|reindex
                           Read and write frontmatter metadata
  status ready|gaps        Planning queries derived from artifact status

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

function runGraphGroup(
	positional: string[],
	flags: Record<string, string | boolean>,
): CommandResult {
	const [sub, ...rest] = positional;
	if (!sub)
		return flags.help ? ok(HELP_GRAPH_GROUP) : fail(HELP_GRAPH_GROUP, 2);
	switch (sub) {
		case "summary": {
			if (flags.help) return ok(HELP_GRAPH_SUMMARY);
			const f = rest[0];
			if (!f) return fail(HELP_GRAPH_SUMMARY, 2);
			return runGraphSummary(f, { json: flags.json === true });
		}
		case "io": {
			if (flags.help) return ok(HELP_GRAPH_IO);
			const f = rest[0];
			if (!f) return fail(HELP_GRAPH_IO, 2);
			return runGraphIo(f, { json: flags.json === true });
		}
		case "edges": {
			if (flags.help) return ok(HELP_GRAPH_EDGES);
			const f = rest[0];
			if (!f) return fail(HELP_GRAPH_EDGES, 2);
			return runGraphEdges(f, { json: flags.json === true });
		}
		case "neighbors": {
			if (flags.help) return ok(HELP_NEIGHBORS);
			const [f, id] = rest;
			if (!f || !id) return fail(HELP_NEIGHBORS, 2);
			return runNeighbors(f, id, { json: flags.json === true });
		}
		case "impact": {
			if (flags.help) return ok(HELP_IMPACT);
			const [f, id] = rest;
			if (!f || !id) return fail(HELP_IMPACT, 2);
			return runImpact(f, id, { json: flags.json === true });
		}
		case "depends-on": {
			if (flags.help) return ok(HELP_DEPENDS_ON);
			const [f, id] = rest;
			if (!f || !id) return fail(HELP_DEPENDS_ON, 2);
			return runDependsOn(f, id, { json: flags.json === true });
		}
		case "path": {
			if (flags.help) return ok(HELP_PATH);
			const [f, from, to] = rest;
			if (!f || !from || !to) return fail(HELP_PATH, 2);
			return runPath(f, from, to, { json: flags.json === true });
		}
		case "stats": {
			if (flags.help) return ok(HELP_STATS);
			const f = rest[0];
			if (!f) return fail(HELP_STATS, 2);
			const limitFlag = flags.limit;
			let limit: number | undefined;
			if (typeof limitFlag === "string") {
				const n = Number(limitFlag);
				if (!Number.isInteger(n) || n < 0) return fail(HELP_STATS, 2);
				limit = n;
			}
			return runStats(f, {
				...(limit !== undefined ? { limit } : {}),
				json: flags.json === true,
			});
		}
		default:
			return fail(`unknown graph subcommand: ${sub}\n${HELP_GRAPH_GROUP}`, 2);
	}
}

function runMetaGroup(
	positional: string[],
	flags: Record<string, string | boolean>,
): CommandResult {
	const [sub, ...rest] = positional;
	if (!sub) return flags.help ? ok(HELP_META_GROUP) : fail(HELP_META_GROUP, 2);
	switch (sub) {
		case "get": {
			if (flags.help) return ok(HELP_GET);
			const [f, id, field, ...extra] = rest;
			if (!f || !id) return fail(HELP_GET, 2);
			if (extra.length > 0) return fail(HELP_GET, 2);
			return runGet(f, {
				id,
				...(field !== undefined ? { field } : {}),
				json: flags.json === true,
			});
		}
		case "set": {
			if (flags.help) return ok(HELP_META_SET);
			const [f, id, field, value, ...extra] = rest;
			if (!f || !id || !field || value === undefined)
				return fail(HELP_META_SET, 2);
			if (extra.length > 0) {
				return fail(
					`meta set: too many arguments — quote values containing spaces (got: ${[value, ...extra].join(" ")})\n`,
					2,
				);
			}
			return runMetaSet(f, id, field, value, { json: flags.json === true });
		}
		case "sort": {
			if (flags.help) return ok(HELP_SORT);
			const f = rest[0];
			if (!f) return fail(HELP_SORT, 2);
			const byVal = flags.by;
			if (!byVal || byVal === true) return fail(HELP_SORT, 2);
			return runSort(f, {
				by: String(byVal),
				write: flags.write === true,
				check: flags.check === true,
			});
		}
		case "reindex": {
			if (flags.help) return ok(HELP_REINDEX);
			const f = rest[0];
			if (!f) return fail(HELP_REINDEX, 2);
			return runReindex(f, {
				write: flags.write === true,
				check: flags.check === true,
				renumber: flags.renumber === true,
				json: flags.json === true,
			});
		}
		default:
			return fail(`unknown meta subcommand: ${sub}\n${HELP_META_GROUP}`, 2);
	}
}

function runStatusGroup(
	positional: string[],
	flags: Record<string, string | boolean>,
): CommandResult {
	const [sub, ...rest] = positional;
	if (!sub)
		return flags.help ? ok(HELP_STATUS_GROUP) : fail(HELP_STATUS_GROUP, 2);
	switch (sub) {
		case "ready": {
			if (flags.help) return ok(HELP_READY);
			const f = rest[0];
			if (!f) return fail(HELP_READY, 2);
			return runReady(f, {
				best: flags.best === true,
				json: flags.json === true,
			});
		}
		case "gaps": {
			if (flags.help) return ok(HELP_STATUS_GAPS);
			const [roadmapFile, ...flowFiles] = rest;
			if (!roadmapFile || flowFiles.length === 0)
				return fail(HELP_STATUS_GAPS, 2);
			return runStatusGaps(roadmapFile, flowFiles, {
				json: flags.json === true,
			});
		}
		default:
			return fail(`unknown status subcommand: ${sub}\n${HELP_STATUS_GROUP}`, 2);
	}
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
		case "graph":
			return runGraphGroup(positional, flags);
		case "meta":
			return runMetaGroup(positional, flags);
		case "status":
			return runStatusGroup(positional, flags);
		case "check": {
			if (flags.help) return ok(HELP_CHECK);
			const f = positional[0];
			if (!f) return fail(HELP_CHECK, 2);
			return runCheck(f, {
				hints: flags.hints === true,
				strict: flags.strict === true,
				json: flags.json === true,
				color: shouldColorize({
					noColorFlag: flags["no-color"] === true,
					stream: process.stdout,
					env: process.env,
				}),
			});
		}
		case "fmt": {
			if (flags.help) return ok(HELP_FMT);
			const f = positional[0];
			if (!f) return fail(HELP_FMT, 2);
			return runFmt(f, {
				write: flags.write === true,
				check: flags.check === true,
			});
		}
		case "render": {
			if (flags.help) return ok(HELP_RENDER);
			const f = positional[0];
			if (!f) return fail(HELP_RENDER, 2);
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
			return runRender(f, fmt ? { format: fmt as CliRenderFormat } : {});
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
			return await runDiff(a, b, {
				...(fmt ? { format: fmt } : {}),
				json: flags.json === true,
			});
		}
		case "explain": {
			if (flags.help) return ok(HELP_EXPLAIN);
			const code = positional[0];
			if (!code) return fail(HELP_EXPLAIN, 2);
			return runExplain(code);
		}
		default:
			return fail(`unknown command: ${command}\n${HELP}`, 2);
	}
}
