import type { ExportFormat } from "@pfdsl/editor";
import { invoke } from "@tauri-apps/api/core";
import type { ExportSelection } from "./export-run.js";

export interface ExportServices {
	choose(
		name: string,
		formats: readonly ExportFormat[],
	): Promise<ExportSelection | null>;
	write(id: number, format: ExportFormat, bytes: Uint8Array): Promise<string>;
	release(id: number): Promise<void>;
	pdf(svg: string, width: number, height: number): Promise<Uint8Array>;
}

export const nativeExportServices: ExportServices = {
	choose: (name, formats) => invoke("choose_export", { name, formats }),
	write: (id, format, bytes) =>
		invoke("write_export", { id, format, bytes: Array.from(bytes) }),
	release: (id) => invoke("release_export", { id }),
	pdf: async (svg, width, height) =>
		new Uint8Array(
			await invoke<number[]>("export_pdf", { svg, width, height }),
		),
};
