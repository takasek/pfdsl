import { invoke } from "@tauri-apps/api/core";
import type { ExportServices } from "./export-features.js";
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
