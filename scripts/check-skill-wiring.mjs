#!/usr/bin/env node
/**
 * check-skill-wiring.mjs
 *
 * Verifies that every distributed hand-written skill/agent has exactly one
 * workflow output producer in .pfdsl/workflow.pfdsl and a primary input/output
 * path that reaches `gen_plugin` in .pfdsl/pipeline.pfdsl (where it is
 * consumed as bundled material).
 * See scripts/lib/skill-wiring-check.mjs
 * for how scope is derived without a hand-maintained list of skill names (#699).
 *
 * Reads the graphs through @pfdsl/core's analyze() rather than by matching
 * .pfdsl text, so edge kinds and artifact metadata come from the same parser
 * the CLI uses. That assumes the repo is built — which `make check-docs`, this
 * check's only caller, already assumes for the `pfdsl check`/`render` steps
 * above it (and CI builds before running it).
 *
 * Usage: node scripts/check-skill-wiring.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { emitLinesAndExit } from "./lib/emit-lines.mjs";
import { runSkillWiringCheck } from "./lib/skill-wiring-check-steps.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { analyze, locateNode } = await import(
	resolve(root, "packages/core/dist/index.js")
);

emitLinesAndExit(
	runSkillWiringCheck({
		readFile: (file) => readFileSync(resolve(root, file), "utf-8"),
		analyzeFile: (text) => analyze(text),
		locate: locateNode,
	}),
);
