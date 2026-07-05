#!/usr/bin/env node
/**
 * check-stale-forward-refs.mjs
 *
 * Greps docs/**\/*.md for phrases that defer a definition to a future
 * feature ("将来版に委ねる" / "別途定義する"). These go stale silently when
 * the referenced feature ships and the text isn't updated — e.g. spec.md
 * §15.8/§15.9 kept saying "マルチファイル仕様（将来版）に委ねる" for two
 * versions after §2.9 shipped multifile semantics (docs/review-prompts.md
 * C系 "stale 前方参照"; #299 additional scope).
 *
 * This cannot determine staleness automatically — only a human can judge
 * whether the referenced future feature now exists. It always exits 0 and
 * exists purely to surface every occurrence as a warning/reminder so the
 * check isn't skipped during review.
 *
 * Usage:
 *   node scripts/check-stale-forward-refs.mjs [files...]
 *   (no args → all git-tracked docs/**\/*.md files)
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
	findStaleForwardRefs,
	formatStaleForwardRefs,
} from "./lib/stale-forward-ref-check.mjs";

const args = process.argv.slice(2);
const files =
	args.length > 0
		? args
		: execSync('git ls-files "docs/**/*.md"', { encoding: "utf8" })
				.trim()
				.split("\n")
				.filter(Boolean);

const allHits = [];
for (const file of files) {
	const text = readFileSync(file, "utf8");
	for (const hit of findStaleForwardRefs(text)) {
		allHits.push({ file, ...hit });
	}
}

if (allHits.length > 0) {
	console.log(
		`check-stale-forward-refs: ${allHits.length} forward-reference phrase(s) found — confirm the referenced feature is still unimplemented:\n`,
	);
	console.log(formatStaleForwardRefs(allHits));
} else {
	console.log("check-stale-forward-refs: no forward-reference phrases found");
}
