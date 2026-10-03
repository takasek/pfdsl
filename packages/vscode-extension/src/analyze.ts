import { readFileSync } from "node:fs";
import {
	analyze,
	analyzeSource,
	type Frontmatter,
	resolveEffectiveFrontmatter,
	wrapPresetSource,
} from "@pfdsl/core";
import type * as vscode from "vscode";

export const LANGUAGE_ID = "pfdsl";

interface CacheEntry {
	version: number;
	result: ReturnType<typeof analyzeSource>;
}

const cache = new Map<string, CacheEntry>();

export function analyzeDocument(
	doc: vscode.TextDocument,
): ReturnType<typeof analyzeSource> {
	const key = doc.uri.toString();
	const entry = cache.get(key);
	if (entry && entry.version === doc.version) return entry.result;
	const result = analyzeSource(doc.getText());
	cache.set(key, { version: doc.version, result });
	return result;
}

/** Dependency presets use saved files; the entry always uses its editor snapshot. */
function extendsLoader(path: string): ReturnType<typeof analyze> | null {
	try {
		const src = readFileSync(path, "utf-8");
		return analyze(wrapPresetSource(path, src));
	} catch {
		return null;
	}
}

/**
 * Resolve `extends:`-inherited statusStyles/tag/group (§2.9.4) for a document
 * identified by `uri`, so preview/export match CLI `graph` rendering (#427).
 * Skipped for non-`file` schemes (e.g. untitled documents) — relative extends
 * paths need a real file location to resolve against.
 */
export function resolveEffectiveFrontmatterForUri(
	uri: { scheme: string; fsPath: string },
	frontmatter: Frontmatter | null,
): Frontmatter | null {
	if (uri.scheme !== "file") return frontmatter;
	return resolveEffectiveFrontmatter(uri.fsPath, frontmatter, extendsLoader);
}

export function dropAnalyzeCache(uri: vscode.Uri): void {
	cache.delete(uri.toString());
}

export function clearAnalyzeCache(): void {
	cache.clear();
}
