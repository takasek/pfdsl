import {
	analyzeSnapshot,
	computeFullDocumentFormatOutput,
	type FormatStyle,
	preloadPresets,
	prepareDocument,
} from "@pfdsl/editor";

export function formatSnapshot(source: string, style: FormatStyle = "flows") {
	return computeFullDocumentFormatOutput(source, style);
}

/** Native I/O is supplied by the caller; editor text takes precedence over disk. */
export async function processSnapshot(
	source: string,
	path: string | null,
	read: (path: string) => Promise<string | null>,
) {
	const model = analyzeSnapshot(source);
	const load =
		path === null ? () => null : await preloadPresets(path, model, read);
	return prepareDocument(model, path, load);
}
