#!/usr/bin/env node
/**
 * check-companion-bindings.mjs
 *
 * pfd-retro's audit and pfd-ops's L2 dispatch resolve through multi-step
 * pointer chains (companion .md prose -> a repo-relative path -> a required
 * section heading), and nothing checked those pointers stayed valid as files
 * got renamed or sections got reworded (#344).
 *
 * Checks 1 and 2 run per file in the order below; 3 runs afterwards.
 *
 * 1. Resolves markdown links written relative to the linking file (`../x.md`,
 *    a bare sibling name) against that file's own directory, over every
 *    .pfdsl/*.md the pathspec below yields — the pfd-retro-patterns cases
 *    included, which check 2 exempts. Only targets landing back inside
 *    .pfdsl/ are checked: those point the reader at a live companion, whereas
 *    one resolving outside it is a repo path that happens to be spelled
 *    relatively, which is check 2's territory and its exemption's. 87 cases
 *    carry the same `../pfd-retro.md`, which one rename would break all at
 *    once (#1231 follow-up).
 * 2. Scans current .pfdsl markdown companions for repo-relative path references
 *    (inline code and markdown links starting with docs/, .claude/,
 *    scripts/, packages/) and verifies each resolves to an existing
 *    file/directory. Assumes the repo is built (e.g. packages/cli/dist
 *    exists) — this runs as part of `make check-docs`, which already
 *    assumes that for other checks. Historical pfd-retro-patterns cases retain
 *    references to their original revisions and are outside this live check.
 * 3. If .pfdsl/bindings/pfd-retro.md exists, verifies it has the "pfd-retro
 *    バインディング" heading pfd-retro's audit protocol depends on being
 *    able to find.
 *
 * Usage: node scripts/check-companion-bindings.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCompanionBindingsCheck } from "./lib/companion-binding-check-steps.mjs";
import { emitLinesAndExit } from "./lib/emit-lines.mjs";
import { gitLsFiles } from "./lib/run-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

emitLinesAndExit(
	runCompanionBindingsCheck({
		listFiles: () => gitLsFiles([".pfdsl/*.md"], { cwd: root }),
		readFile: (file) => readFileSync(resolve(root, file), "utf-8"),
		exists: (path) => existsSync(resolve(root, path)),
	}),
);
