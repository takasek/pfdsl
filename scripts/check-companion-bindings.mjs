#!/usr/bin/env node
/**
 * check-companion-bindings.mjs
 *
 * pfd-retro's audit and pfd-ops's L2 dispatch resolve through multi-step
 * pointer chains (companion .md prose -> a repo-relative path -> a required
 * section heading), and nothing checked those pointers stayed valid as files
 * got renamed or sections got reworded (#344).
 *
 * 1. Scans .pfdsl markdown companions for repo-relative path references
 *    (inline code and markdown links starting with docs/, .claude/,
 *    scripts/, packages/) and verifies each resolves to an existing
 *    file/directory. Assumes the repo is built (e.g. packages/cli/dist
 *    exists) — this runs as part of `make check-docs`, which already
 *    assumes that for other checks.
 * 2. If .pfdsl/bindings/pfd-retro.md exists, verifies it has the "pfd-retro
 *    バインディング" heading pfd-retro's audit protocol depends on being
 *    able to find.
 *
 * Usage: node scripts/check-companion-bindings.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { git } from "./lib/run-exec.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCompanionBindingsCheck } from "./lib/companion-binding-check-steps.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const { exitCode, stdoutLines, stderrLines } = runCompanionBindingsCheck({
	listFiles: () =>
		git(["ls-files", ".pfdsl/*.md"], { cwd: root })
			.trim()
			.split("\n")
			.filter(Boolean),
	readFile: (file) => readFileSync(resolve(root, file), "utf-8"),
	exists: (path) => existsSync(resolve(root, path)),
});
for (const line of stdoutLines) console.log(line);
for (const line of stderrLines) console.error(line);
process.exit(exitCode);
