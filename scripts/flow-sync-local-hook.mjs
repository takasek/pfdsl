#!/usr/bin/env node
// Repo-local step for flow-on-issue-close.yml (pfdsl-only; not part of the
// repo-agnostic install/ template — the workflow runs this file only if it
// exists, so adopting repos without it simply skip this step).
// Regenerates the golden snapshot that embeds .pfdsl/roadmap.pfdsl's format
// output, since audit-issues-flow.mjs --fix / normalize-pfdsl.mjs may have
// changed it.

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

// The workflow's earlier "npm install --no-save yaml" step leaves an npm-flat
// node_modules/ behind; clear it so pnpm doesn't have to reconcile a foreign layout.
rmSync("node_modules", { recursive: true, force: true });

// The workflow template intentionally stops short of setting up pnpm (repo-agnostic —
// adopting repos may use npm/yarn), so this pfdsl-only hook activates it via corepack,
// which resolves the exact version from this repo's package.json "packageManager" field.
execFileSync("corepack", ["enable"], { stdio: "inherit" });
execFileSync("pnpm", ["install", "--frozen-lockfile"], { stdio: "inherit" });
execFileSync("pnpm", ["--filter", "@pfdsl/core", "exec", "vitest", "run", "-u"], { stdio: "inherit" });
