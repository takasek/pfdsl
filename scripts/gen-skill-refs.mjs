#!/usr/bin/env node
// Generates the build-independent references/*.md files for the pfdsl Claude
// skill to a target directory (spec / review-perspectives / quality-guide /
// samples / examples — see scripts/lib/gen-skill-refs.mjs for the split
// rationale, #586). Does NOT write SKILL.md (that needs packages/cli/dist,
// see scripts/gen-skill.mjs).
// Run: node scripts/gen-skill-refs.mjs --out .claude/skills/pfdsl
// The --out path must contain '.claude/' or 'skills/' (safety check).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSkillOutDir } from "./lib/skill-out-dir.mjs";
import { writeSkillRefs } from "./lib/gen-skill-refs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const outDir = parseSkillOutDir("scripts/gen-skill-refs.mjs", process.argv.slice(2));

writeSkillRefs(root, outDir);
console.log(`\nreferences/ written to: ${resolve(outDir, "references")}`);
