#!/usr/bin/env node
/**
 * check-criteria-judgeability.mjs
 *
 * Flags `criteria` that name a registry version query through a latest-only
 * accessor, which makes the criteria false for every version but the newest
 * (#867). The general question — whether a criteria can be decided at all — is
 * not machinable; see scripts/lib/criteria-judgeability.mjs for why this is
 * the subset that is, and docs/quality-guide.md for the norm it enforces.
 *
 * Reads the graphs through @pfdsl/core's analyze(), so it assumes the repo is
 * built — the same assumption `make check-docs`, its only caller, already makes
 * for the `pfdsl check`/`render` steps.
 *
 * Usage: node scripts/check-criteria-judgeability.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCriteriaJudgeabilityCheck } from "./lib/criteria-judgeability.mjs";
import { emitLinesAndExit } from "./lib/emit-lines.mjs";
import { gitLsFiles } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { analyze } = await import(resolve(root, "packages/core/dist/index.js"));

emitLinesAndExit(
	runCriteriaJudgeabilityCheck({
		listFiles: () => gitLsFiles(["*.pfdsl"], { cwd: root }),
		readFile: (file) => readFileSync(resolve(root, file), "utf-8"),
		analyzeFile: (text) => analyze(text),
	}),
);
