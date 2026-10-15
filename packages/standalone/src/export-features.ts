import {
	computeExportSources,
	type ExportResult,
	exportFormats,
} from "@pfdsl/editor";
import { renderDotToSvg } from "@pfdsl/preview-engine";
import type * as monaco from "monaco-editor/editor/editor.api.js";
import { svgSize, svgToPng } from "./export-image.js";
import type { ExportResultPresenter } from "./export-results.js";
import { createExportRun } from "./export-run.js";
import type { ExportServices } from "./export-services.js";
import { processSnapshot } from "./processing.js";

export function registerExportFeatures(
	editor: monaco.editor.IStandaloneCodeEditor,
	context: () => {
		name: string;
		path: string | null;
		read: (path: string) => Promise<string | null>;
	},
	services: ExportServices | undefined,
	report: (message: string) => void,
	show: ExportResultPresenter,
) {
	let disposed = false;
	let svg: Promise<string> | undefined;
	let version = 0;
	let name = "";
	const run = createExportRun({
		available: () => !disposed,
		async snapshot() {
			if (!services)
				throw new Error("Use the desktop application to export files.");
			const source = editor.getValue();
			version = editor.getModel()!.getVersionId();
			svg = undefined;
			const { path, read, name: capturedName } = context();
			name = capturedName;
			const prepared = await processSnapshot(source, path, read);
			if (prepared.message.type === "error")
				throw new Error(prepared.message.message);
			return {
				...computeExportSources(prepared.model.graph, prepared.frontmatter),
				warnings: prepared.presetDiagnostics.map((d) => d.message),
			};
		},
		choose: (formats) =>
			services!.choose(name.replace(/\.pfdsl$/i, ""), formats),
		async convert(format, sources) {
			if (format === "dot" || format === "tsv")
				return new TextEncoder().encode(sources[format]);
			svg ??= renderDotToSvg(sources.dot);
			const source = await svg;
			if (format === "svg") return new TextEncoder().encode(source);
			if (format === "png") return svgToPng(source);
			const { width, height } = svgSize(source);
			return services!.pdf(source, width, height);
		},
		write: (id, format, bytes) => services!.write(id, format, bytes),
		release: (id) => services!.release(id),
		show(results: ExportResult[]) {
			show(name, version, results);
		},
	});
	const actions = [...exportFormats, "all" as const].map((format) =>
		editor.addAction({
			id: `pfdsl.export.${format}`,
			label:
				format === "all"
					? "Export All (DOT, SVG, PDF, PNG, TSV)…"
					: `Export as ${format.toUpperCase()}…`,
			contextMenuGroupId: "pfdsl-export",
			async run() {
				try {
					await run.run(format === "all" ? exportFormats : [format]);
				} catch (error) {
					if (!disposed) report(String(error));
				}
			},
		}),
	);
	return {
		cancelPending: run.cancelPending,
		dispose() {
			disposed = true;
			run.cancelPending();
			for (const action of actions) action.dispose();
		},
	};
}
