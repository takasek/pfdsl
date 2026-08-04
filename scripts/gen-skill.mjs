#!/usr/bin/env node
// Generates the pfdsl Claude skill to a target directory.
// Run: node scripts/gen-skill.mjs --out .claude/skills/pfdsl
// The --out path must contain '.claude/' or 'skills/' (safety check).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { execFileSync } from "node:child_process";

import { findMissingFields } from "./lib/skill-field-drift.mjs";
import { renderCliSection } from "./lib/skill-cli-section.mjs";
import { parseSkillOutDir } from "./lib/skill-out-dir.mjs";
import { writeSkillRefs } from "./lib/gen-skill-refs.mjs";
import { injectGeneratedHeader } from "./lib/skill-header.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// --- Parse args ---

const outDir = parseSkillOutDir("scripts/gen-skill.mjs", process.argv.slice(2));

// --- 1/1b/1c/2/2b. Write references/*.md (build-independent — see scripts/lib/gen-skill-refs.mjs) ---

const specVersion = writeSkillRefs(root, outDir);

// --- 3. Write SKILL.md from template ---

const templateSrc = readFileSync(resolve(__dirname, "skill-template/SKILL.md"), "utf-8");

const frontmatterTs = readFileSync(resolve(root, "packages/core/src/types/frontmatter.ts"), "utf-8");
const missingFields = findMissingFields(frontmatterTs, templateSrc);
if (missingFields.length > 0) {
  console.error("Error: typed frontmatter fields missing from skill-template 'Frontmatter structure' section:");
  for (const f of missingFields) console.error(`  - ${f}`);
  console.error("Add them to the yaml block (or the pointer line below it) in scripts/skill-template/SKILL.md.");
  process.exit(1);
}

const cliPath = resolve(root, "packages/cli/dist/cli.js");
if (!existsSync(cliPath)) {
  console.error("Error: packages/cli/dist/cli.js not found. Run 'pnpm -r build' first.");
  process.exit(1);
}
const helpOutput = execFileSync(process.execPath, [cliPath, "help"], { encoding: "utf-8" });

// The skill documents the command surface of the CLI it was generated against,
// so it declares that version as the minimum the reader's CLI must satisfy.
// Auto-injected from package.json so the preflight can never drift from reality.
const cliVersion = JSON.parse(
  readFileSync(resolve(root, "packages/cli/package.json"), "utf-8"),
).version;
if (!cliVersion) {
  console.error("Error: packages/cli/package.json has no 'version' field — cannot stamp the skill's required CLI version.");
  process.exit(1);
}

const skillMd = injectGeneratedHeader(templateSrc)
	.replace(/\{\{specVersion\}\}/g, specVersion)
	.replace(/\{\{cliVersion\}\}/g, cliVersion)
	.replace("{{cliCommands}}", renderCliSection(helpOutput));

// Fail loudly if the template carries a placeholder nobody substituted — a
// typo'd or newly-added {{name}} would otherwise ship as a literal to readers.
const leftover = [...new Set(skillMd.match(/\{\{[^{}]*\}\}/g) ?? [])];
if (leftover.length > 0) {
  console.error(`Error: unreplaced template placeholder(s) in generated SKILL.md: ${leftover.join(", ")}`);
  console.error("Every {{...}} in scripts/skill-template/SKILL.md needs a matching .replace() in scripts/gen-skill.mjs.");
  process.exit(1);
}

writeFileSync(resolve(outDir, "SKILL.md"), skillMd);
console.log("SKILL.md → generated from skill-template/SKILL.md");

// --- 4. Write CLAUDE.md guard (in-repo working copy only, .claude/ outputs) ---
// .claude/skills/pfdsl is a generated + gitignored working copy (#348); the
// marketplace plugin copy (plugin/pfdsl/skills/pfdsl, #366) intentionally
// omits this dev-only guard.
// Must check the path *relative to the repo root*, not raw absolute path
// components — the repo itself may be checked out under a directory that
// contains a literal ".claude" segment (e.g. a worktree at .claude/worktrees/*),
// which would otherwise false-positive for every --out target.
const relOutParts = relative(root, outDir).split(sep);
if (relOutParts[0] === ".claude") {
  const claudeMd = readFileSync(resolve(__dirname, "skill-template/CLAUDE.md"), "utf-8");
  writeFileSync(resolve(outDir, "CLAUDE.md"), claudeMd);
  console.log("CLAUDE.md → generated from skill-template/CLAUDE.md (in-repo working copy guard)");
}

console.log(`\nSkill written to: ${outDir}`);
