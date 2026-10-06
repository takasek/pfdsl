import {
	analyzeSource,
	collectExtendsRefs,
	type Diagnostic,
	loadExtendsChain,
	resolveEffectiveFrontmatter,
	resolveRefPath,
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

/** Saved dependency sources are supplied by the host; the entry is always its editor snapshot. */
export async function preloadPresets(
	path: string,
	model: DocumentModel,
	read: (path: string) => Promise<string | null>,
): Promise<PresetLoader> {
	const models = new Map<string, DocumentModel | null>([[path, model]]);
	async function visit(from: string, current: DocumentModel) {
		for (const ref of collectExtendsRefs(current.frontmatter ?? {})) {
			const resolved = resolveRefPath(from, ref);
			if (!resolved.ok || models.has(resolved.path)) continue;
			models.set(resolved.path, null);
			let source: string | null;
			try {
				source = await read(resolved.path);
			} catch {
				source = null;
			}
			if (source === null) continue;
			const dependency = analyzeSnapshot(
				wrapPresetSource(resolved.path, source),
			);
			models.set(resolved.path, dependency);
			await visit(resolved.path, dependency);
		}
	}
	await visit(path, model);
	return (path) => models.get(path) ?? null;
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
		const dependencies = loadExtendsChain(path, (file) =>
			file === path ? model : load(file),
		);
		frontmatter = resolveEffectiveFrontmatter(
			path,
			model.frontmatter,
			(file) => dependencies.docs.get(file) ?? null,
		);
		presetDiagnostics = dependencies.diagnostics;
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
