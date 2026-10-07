import {
	collectExtendsRefs,
	collectSubflowRefs,
	type DocWithFrontmatter,
	resolveRefPath,
	subflowBoundaryDiagnostics,
	validatePresetKeys,
} from "./multifile.js";
import { zeroRange } from "./position.js";
import type { Document } from "./types/ast.js";
import type { Diagnostic } from "./types/diagnostic.js";
import type { NormalizedEdge } from "./types/index.js";

export type DependencyRole = "entry" | "subflow" | "preset";
export type DependencyDiagnostic = Diagnostic & { file?: string };
export interface DependencyDocument extends DocWithFrontmatter {
	edges: NormalizedEdge[];
	diagnostics: Diagnostic[];
	document: Document;
}
export interface DependencyReference {
	kind: "extends" | "subflow";
	from: string;
	ref: string;
	to?: string;
	process?: string;
}
export interface DependencyClosure<T> {
	docs: Map<string, T>;
	/** A file may be both the entry and a preset, or both a child and a preset. */
	roles: Map<string, Set<DependencyRole>>;
	references: DependencyReference[];
	/** Cross-file references and boundaries, attributed to their declaring file. */
	diagnostics: DependencyDiagnostic[];
	/** File-local diagnostics, including those of the entry. */
	localDiagnostics: DependencyDiagnostic[];
	/** V028 for each file used as a preset, including a dual-role entry. */
	presetDiagnostics: DependencyDiagnostic[];
}
export interface DependencyOptions {
	/** False resolves only the entry's extends graph, for presentation-only consumers. */
	subflows?: boolean;
}

/** One traversal drives both synchronous CLI and asynchronous editor readers. */
function* walk<T extends DependencyDocument>(
	entry: string,
	options: DependencyOptions,
): Generator<string, DependencyClosure<T>, T | null> {
	const docs = new Map<string, T>();
	const roles = new Map<string, Set<DependencyRole>>();
	const references: DependencyReference[] = [];
	const diagnostics: DependencyDiagnostic[] = [];
	const loaded = new Map<string, T | null>();
	const scanned = new Set<string>();
	const queue: { path: string; role: DependencyRole }[] = [
		{ path: entry, role: "entry" },
	];
	const inFile = (d: Diagnostic, path: string): DependencyDiagnostic =>
		path === entry ? d : { ...d, file: path };
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const { path, role } = queue[cursor]!;
		if (!loaded.has(path)) loaded.set(path, yield path);
		const doc = loaded.get(path);
		if (!doc) continue;
		docs.set(path, doc);
		let fileRoles = roles.get(path);
		if (!fileRoles) {
			fileRoles = new Set();
			roles.set(path, fileRoles);
		}
		fileRoles.add(role);
		const kinds =
			role === "preset" || options.subflows === false
				? (["extends"] as const)
				: (["extends", "subflow"] as const);
		for (const kind of kinds) {
			const scanKey = JSON.stringify([path, kind]);
			if (scanned.has(scanKey)) continue;
			scanned.add(scanKey);
			const refs =
				kind === "extends"
					? collectExtendsRefs(doc.frontmatter ?? {}).map((ref) => ({
							ref,
							process: undefined,
						}))
					: collectSubflowRefs(doc.frontmatter ?? {});
			for (const { ref, process } of refs) {
				const resolved = resolveRefPath(path, ref);
				const reference: DependencyReference = {
					kind,
					from: path,
					ref,
					...(process !== undefined ? { process } : {}),
					...(resolved.ok ? { to: resolved.path } : {}),
				};
				references.push(reference);
				if (!resolved.ok) {
					diagnostics.push(
						inFile(
							{
								severity: "error",
								code: kind === "extends" ? "V026" : "V021",
								message: `invalid ${kind} path (${resolved.reason}): ${ref}`,
								range: zeroRange(),
							},
							path,
						),
					);
				} else
					queue.push({
						path: resolved.path,
						role: kind === "extends" ? "preset" : "subflow",
					});
			}
		}
	}

	// Each reference kind has its own DFS state: a mixed-edge loop is not a cycle.
	for (const kind of ["subflow", "extends"] as const) {
		const adjacency = new Map<string, DependencyReference[]>();
		const reported = new Set<string>();
		for (const ref of references.filter(
			(ref) => ref.kind === kind && ref.to !== undefined,
		)) {
			const list = adjacency.get(ref.from) ?? [];
			list.push(ref);
			adjacency.set(ref.from, list);
			if (!docs.has(ref.to!)) {
				const key = JSON.stringify([ref.from, ref.to]);
				if (reported.has(key)) continue;
				reported.add(key);
				diagnostics.push(
					inFile(
						{
							severity: "error",
							code: kind === "extends" ? "V026" : "V021",
							message: `${kind} file not found: ${ref.to}`,
							range: zeroRange(),
						},
						ref.from,
					),
				);
			}
		}
		const active = new Set<string>();
		const visited = new Set<string>();
		function visit(path: string) {
			if (visited.has(path)) return;
			active.add(path);
			for (const ref of adjacency.get(path) ?? []) {
				if (!docs.has(ref.to!)) continue;
				if (active.has(ref.to!)) {
					const key = JSON.stringify([ref.from, ref.to]);
					if (reported.has(key)) continue;
					reported.add(key);
					diagnostics.push(
						inFile(
							{
								severity: "error",
								code: kind === "extends" ? "V027" : "V022",
								message: `circular ${kind} reference: ${ref.to}`,
								range: zeroRange(),
							},
							ref.from,
						),
					);
				} else visit(ref.to!);
			}
			active.delete(path);
			visited.add(path);
		}
		for (const path of docs.keys()) visit(path);
	}
	const entryDoc = docs.get(entry);
	if (options.subflows !== false && entryDoc) {
		// Reuse the boundary validator over cached documents; reference diagnostics
		// above already have a single closure-wide identity.
		diagnostics.push(
			...subflowBoundaryDiagnostics(
				entry,
				entryDoc.edges,
				entryDoc.frontmatter,
				(path) => docs.get(path) ?? null,
			).diagnostics.filter((d) => !["V021", "V022"].includes(d.code)),
		);
	}
	const localDiagnostics: DependencyDiagnostic[] = [];
	const presetDiagnostics: DependencyDiagnostic[] = [];
	for (const [path, doc] of docs) {
		localDiagnostics.push(...doc.diagnostics.map((d) => inFile(d, path)));
		if (roles.get(path)?.has("preset"))
			presetDiagnostics.push(
				...validatePresetKeys(path, doc.frontmatter, doc.document).map((d) =>
					inFile(d, path),
				),
			);
	}
	return {
		docs,
		roles,
		references,
		diagnostics,
		localDiagnostics,
		presetDiagnostics,
	};
}

/** Load each reachable file once, including failed reads. The loader owns strictness and source coordinates. */
export function loadDependencyClosure<T extends DependencyDocument>(
	entry: string,
	load: (path: string) => T | null,
	options: DependencyOptions = {},
): DependencyClosure<T> {
	const traversal = walk<T>(entry, options);
	let step = traversal.next();
	while (!step.done) step = traversal.next(load(step.value));
	return step.value;
}

/** Async adapter for the same closure traversal and diagnostics as the synchronous API. */
export async function loadDependencyClosureAsync<T extends DependencyDocument>(
	entry: string,
	load: (path: string) => Promise<T | null>,
	options: DependencyOptions = {},
): Promise<DependencyClosure<T>> {
	const traversal = walk<T>(entry, options);
	let step = traversal.next();
	while (!step.done) step = traversal.next(await load(step.value));
	return step.value;
}
