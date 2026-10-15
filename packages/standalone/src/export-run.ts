import {
	type ExportFormat,
	type ExportResult,
	runExports,
} from "@pfdsl/editor";
export interface ExportSources {
	dot: string;
	tsv: string;
	warnings: string[];
}
export interface ExportSelection {
	id: number;
	paths?: Partial<Record<ExportFormat, string>>;
}
export function createExportRun(host: {
	snapshot(): Promise<ExportSources>;
	available(): boolean;
	choose(formats: readonly ExportFormat[]): Promise<ExportSelection | null>;
	convert(format: ExportFormat, sources: ExportSources): Promise<Uint8Array>;
	write(id: number, format: ExportFormat, bytes: Uint8Array): Promise<string>;
	release(id: number): Promise<void>;
	show(results: ExportResult[]): void;
}) {
	let running = false,
		generation = 0;
	return {
		async run(formats: readonly ExportFormat[]) {
			if (running || !host.available()) return;
			running = true;
			const request = generation;
			let selected: ExportSelection | null = null;
			try {
				const sources = await host.snapshot();
				if (request !== generation || !host.available()) return;
				selected = await host.choose(formats);
				if (!selected || request !== generation || !host.available()) return;
				const id = selected.id;
				const results = await runExports(
					formats,
					(format) => host.convert(format, sources),
					(format, bytes) => host.write(id, format, bytes),
					sources.warnings,
				);
				host.show(results);
			} finally {
				try {
					if (selected) await host.release(selected.id);
				} finally {
					running = false;
				}
			}
		},
		cancelPending() {
			generation++;
		},
	};
}
