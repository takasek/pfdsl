#!/usr/bin/env node
/**
 * check-spec-ids.mjs
 *
 * Scans docs/**\/*.md for `(SPEC_<id>)` id definitions and `[[SPEC_<id>]]`
 * strict references (#328, ADR-0027). Fails (exit 1) when:
 *   - the same id is defined more than once anywhere in the scanned files, or
 *   - a strict reference has no matching definition anywhere.
 *
 * Permissive references `[[SPEC_<id>?]]` are checked separately by
 * check-forward-ref-markers.mjs and are not dangling errors here.
 *
 * Usage:
 *   node scripts/check-spec-ids.mjs [files...]
 *   (no args → all git-tracked docs/**\/*.md files)
 */

import { readFileSync } from "node:fs";
import { emitLinesAndExit } from "./lib/emit-lines.mjs";
import { gitLsFiles } from "./lib/run-exec.mjs";
import { runSpecIdCheck } from "./lib/spec-id-check-steps.mjs";

const args = process.argv.slice(2);
const listFiles = () => gitLsFiles(["docs/**/*.md"]);

emitLinesAndExit(
	runSpecIdCheck({
		args,
		listFiles,
		readFile: (file) => readFileSync(file, "utf8"),
	}),
);
