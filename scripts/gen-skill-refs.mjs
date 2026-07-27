#!/usr/bin/env node
// Generates the dist非依存 references/*.md files for the pfdsl Claude skill
// to a target directory (spec / review-perspectives / quality-guide /
// samples / examples — see scripts/lib/gen-skill-refs.mjs for the split
// rationale, #586). Does NOT write SKILL.md (that needs packages/cli/dist,
// see scripts/gen-skill.mjs).
// Run: node scripts/gen-skill-refs.mjs --out .claude/skills/pfdsl
// The --out path must contain '.claude/' or 'skills/' (safety check).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeSkillOutDir } from "./lib/skill-out-dir.mjs";
import { writeSkillRefs } from "./lib/gen-skill-refs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const outIdx = process.argv.indexOf("--out");
if (outIdx === -1 || !process.argv[outIdx + 1] || process.argv[outIdx + 1].startsWith("-")) {
	console.error("Usage: node scripts/gen-skill-refs.mjs --out <skill-dir>");
	console.error("Example: node scripts/gen-skill-refs.mjs --out .claude/skills/pfdsl");
	process.exit(2);
}

const outDir = resolve(process.cwd(), process.argv[outIdx + 1]);
assertSafeSkillOutDir(outDir);

writeSkillRefs(root, outDir);
console.log(`\nreferences/ written to: ${resolve(outDir, "references")}`);
