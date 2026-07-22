#!/usr/bin/env node
// Collapses consecutive blank lines in a .pfdsl file body.
// Usage: node scripts/pfdsl/normalize-pfdsl.mjs [path] (default: .pfdsl/roadmap.pfdsl)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeBody } from "./lib/issues-flow-audit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const filePath = process.argv[2] ?? resolve(root, ".pfdsl/roadmap.pfdsl");
const raw = readFileSync(filePath, "utf-8");

const lines = raw.split("\n");
let fmEnd = -1;
for (let i = 1; i < lines.length; i++) {
	if (lines[i].trimEnd() === "---") { fmEnd = i; break; }
}
if (fmEnd === -1) throw new Error(`No closing --- found in ${filePath}`);

const fmPart = lines.slice(0, fmEnd + 1).join("\n");
const body = lines.slice(fmEnd + 1).join("\n");
const normalized = normalizeBody(body);

if (normalized !== body) {
	writeFileSync(filePath, fmPart + "\n" + normalized, "utf-8");
	console.log(`normalized: ${filePath}`);
} else {
	console.log("already normalized");
}
