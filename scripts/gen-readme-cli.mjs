#!/usr/bin/env node
// Regenerates the README.md `## CLI` generated block from `pfdsl help` output.
// Run from repo root: node scripts/gen-readme-cli.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const cliPath = resolve(root, "packages/cli/dist/cli.js");
if (!existsSync(cliPath)) {
  console.error("Error: packages/cli/dist/cli.js not found. Run 'pnpm -r build' first.");
  process.exit(1);
}

const helpOutput = execFileSync(process.execPath, [cliPath, "help"], { encoding: "utf-8" }).replace(/\s+$/, "");

const readmePath = resolve(root, "README.md");
const readme = readFileSync(readmePath, "utf-8");

const startMarker = "<!-- gen-readme-cli:start -->";
const endMarker = "<!-- gen-readme-cli:end -->";
const startIdx = readme.indexOf(startMarker);
const endIdx = readme.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error("Error: README.md is missing gen-readme-cli sentinel comments. See scripts/gen-readme-cli.mjs.");
  process.exit(1);
}

const before = readme.slice(0, startIdx + startMarker.length);
const after = readme.slice(endIdx);
const block = `\n\n\`\`\`bash\n${helpOutput}\n\`\`\`\n\n`;

const updated = before + block + after;

if (updated === readme) {
  console.log("README.md CLI section already up to date with `pfdsl help`");
} else {
  writeFileSync(readmePath, updated);
  console.log("README.md CLI section ← `pfdsl help`");
}
