import {
	analyzeSource,
	type Diagnostic,
	loadDependencyClosure,
	loadDependencyClosureAsync,
	resolveEffectiveFrontmatter,
	wrapPresetSource,
} from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter/dot";
import {
	buildDescriptions,
	buildLocations,
	buildSubflows,
} from "./location-utils.js";
import type { MessageToWebview } from "./messages.js";
import { buildPreviewGraph } from "./preview-graph.js";
import { blockingDiagnosticMessage } from "./preview-logic.js";

export function analyzeSnapshot(source: string) {
	return { ...analyzeSource(source), source };
}
export type DocumentModel = ReturnType<typeof analyzeSnapshot>;
export type PresetLoader = (path: string) => DocumentModel | null;

/** Dependency diagnostics retain coordinates in the host's original saved file. */
export function analyzeDependencySnapshot(
	path: string,
	source: string,
): DocumentModel {
	const wrapped = wrapPresetSource(path, source);
	const model = analyzeSnapshot(wrapped);
	if (wrapped !== source)
		model.diagnostics = model.diagnostics.map((d) => ({
			...d,
			range: {
				start: {
					...d.range.start,
					line: Math.max(1, d.range.start.line - 1),
					offset: Math.max(0, d.range.start.offset - 4),
				},
				end: {
					...d.range.end,
					line: Math.max(1, d.range.end.line - 1),
					offset: Math.max(0, d.range.end.offset - 4),
				},
			},
		}));
	return model;
}

/** Saved dependency sources are supplied by the host; the entry is always its editor snapshot. */
export async function preloadPresets(
	path: string,
	model: DocumentModel,
	read: (path: string) => Promise<string | null>,
): Promise<PresetLoader> {
	const closure = await loadDependencyClosureAsync(path, async (file) => {
		if (file === path) return model;
		try {
			const source = await read(file);
			return source === null ? null : analyzeDependencySnapshot(file, source);
		} catch {
			return null;
		}
	});
	return (file) => closure.docs.get(file) ?? null;
}

/** Presentation stays lenient for missing presets, matching the existing VS Code preview. */
export function prepareDocument(
	model: DocumentModel,
	path: string | null,
	load: PresetLoader,
) {
	let frontmatter = model.frontmatter;
	let presetDiagnostics: Diagnostic[] = [];
	if (path !== null) {
		const dependencies = loadDependencyClosure(path, (file) =>
			file === path ? model : load(file),
		);
		frontmatter = resolveEffectiveFrontmatter(
			path,
			model.frontmatter,
			(file) => dependencies.docs.get(file) ?? null,
		);
		presetDiagnostics = [
			...dependencies.diagnostics,
			...dependencies.localDiagnostics.filter((d) => d.file !== undefined),
			...dependencies.presetDiagnostics,
		];
	}
	let message: MessageToWebview;
	const error = blockingDiagnosticMessage(model.diagnostics);
	if (error) message = { type: "error", message: error };
	else {
		try {
			message = {
				type: "render",
				dot: exportDot(model.graph, frontmatter),
				descriptions: buildDescriptions(model.frontmatter),
				locations: buildLocations(model.frontmatter),
				subflows: buildSubflows(model.frontmatter),
				graph: buildPreviewGraph(model, frontmatter),
				editing: {
					source: model.source,
					nodes: [...model.nodeKinds].flatMap(([id, kind]) =>
						kind === "group"
							? []
							: [
									{
										id,
										kind,
										defined: Object.hasOwn(model.frontmatter?.[kind] ?? {}, id),
									},
								],
					),
				},
			};
		} catch (error) {
			message = {
				type: "error",
				message: `Export failed: ${(error as Error).message}`,
			};
		}
	}
	return { model, frontmatter, presetDiagnostics, message };
}
