#!/usr/bin/env node
// Generates the Codex-specific repository and plugin assets from the
// maintained Claude sources. Run this directly for only the Codex outputs;
// scripts/gen-plugin-dist-independent.mjs invokes the same assembly together
// with the Claude plugin mirrors.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleCodexAssets } from "./lib/gen-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugin/pfdsl");
const codexPluginRoot = resolve(root, "plugin/pfdsl-codex");

try {
	assembleCodexAssets({ root, pluginRoot, codexPluginRoot });
	console.log("Codex repository and plugin assets generated.");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
