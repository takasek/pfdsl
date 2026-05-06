import { type AnalyzeResult, analyze } from "@pfdsl/core";
import type * as vscode from "vscode";

export const LANGUAGE_ID = "pfdsl";

interface CacheEntry {
	version: number;
	result: AnalyzeResult;
}

const cache = new Map<string, CacheEntry>();

export function analyzeDocument(doc: vscode.TextDocument): AnalyzeResult {
	const key = doc.uri.toString();
	const entry = cache.get(key);
	if (entry && entry.version === doc.version) return entry.result;
	const result = analyze(doc.getText());
	cache.set(key, { version: doc.version, result });
	return result;
}

export function dropAnalyzeCache(uri: vscode.Uri): void {
	cache.delete(uri.toString());
}

export function clearAnalyzeCache(): void {
	cache.clear();
}
