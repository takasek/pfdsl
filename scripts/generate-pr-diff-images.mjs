#!/usr/bin/env node
// Generates before/after/diff SVG diagrams for .pfdsl files changed in a merged
// PR, and updates the PR description with image links. The diff SVG overlays the
// two versions: added green, removed red, metadata-changed yellow, unchanged
// hidden (see `pfdsl diff --format svg`).
//
// Two-phase usage (called by pr-diff-images.yml):
//   Phase 1 — generate SVGs:
//     node scripts/generate-pr-diff-images.mjs generate
//   Phase 2 — update PR description (run after SVGs are committed/pushed):
//     node scripts/generate-pr-diff-images.mjs update-pr
//
// Required env vars (both phases):
//   BASE_SHA           — PR base commit SHA
//   PR_NUMBER          — PR number
//   CHANGED_FILES      — newline-separated list of changed .pfdsl file paths
//   GITHUB_REPOSITORY  — "owner/repo"
//   GH_TOKEN           — GitHub token (phase 2 only)

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { parseHost } from "./lib/github-rest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Pin GH_HOST to this repo's own remote host so `gh` doesn't fail under an
// ambient GH_HOST pointing at a different host (multi-host `gh` login).
const ghEnv = (() => {
	try {
		const host = parseHost(
			execFileSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf-8" }).trim(),
		);
		return host ? { ...process.env, GH_HOST: host } : process.env;
	} catch {
		return process.env;
	}
})();

const mode = process.argv[2];
if (mode !== "generate" && mode !== "update-pr") {
	console.error("Usage: generate-pr-diff-images.mjs <generate|update-pr>");
	process.exit(1);
}

const baseSha = process.env.BASE_SHA;
const prNumber = process.env.PR_NUMBER;
const changedFiles = (process.env.CHANGED_FILES ?? "").split("\n").filter(Boolean);
const repo = process.env.GITHUB_REPOSITORY;

if (!baseSha || !prNumber || changedFiles.length === 0 || !repo) {
	console.error("Missing required env: BASE_SHA, PR_NUMBER, CHANGED_FILES, GITHUB_REPOSITORY");
	process.exit(1);
}

function sanitizePath(filePath) {
	return filePath.replace(/\.pfdsl$/, "");
}

// The in-repo CLI build, so the commands always match this script's revision
// (the published @pfdsl/cli lags the repo between merge and release).
const cliPath = join(root, "packages", "cli", "dist", "cli.js");

function renderSvg(filePath) {
	return execFileSync(
		process.execPath,
		[cliPath, "render", filePath, "--format", "svg"],
		{ encoding: "utf-8", cwd: root },
	);
}

function renderDiffSvg(aPath, bPath) {
	return execFileSync(
		process.execPath,
		[cliPath, "diff", aPath, bPath, "--format", "svg"],
		{ encoding: "utf-8", cwd: root },
	);
}

function getBaseContent(filePath) {
	try {
		return execFileSync("git", ["show", `${baseSha}:${filePath}`], {
			encoding: "utf-8",
			cwd: root,
		});
	} catch {
		return null; // file did not exist at base (newly added)
	}
}

const outDir = join(root, "docs", "diagrams", `pr-${prNumber}`);

// ── Phase 1: generate SVGs ─────────────────────────────────────────────────

if (mode === "generate") {
	mkdirSync(outDir, { recursive: true });

	for (const file of changedFiles) {
		const sanitized = sanitizePath(file);
		const svgDir = join(outDir, dirname(sanitized));
		mkdirSync(svgDir, { recursive: true });
		const stem = basename(sanitized);
		const tmpFile = join(tmpdir(), `pfdsl-before-${stem}-${process.pid}.pfdsl`);
		const emptyTmp = join(tmpdir(), `pfdsl-empty-${process.pid}.pfdsl`);

		const baseContent = getBaseContent(file);
		const headPath = join(root, file);
		const headExists = existsSync(headPath);

		try {
			// Before SVG (base version)
			if (baseContent) {
				writeFileSync(tmpFile, baseContent, "utf-8");
				const svg = renderSvg(tmpFile);
				writeFileSync(join(svgDir, `${stem}.before.svg`), svg, "utf-8");
			}

			// After SVG (head version)
			if (headExists) {
				const svg = renderSvg(headPath);
				writeFileSync(join(svgDir, `${stem}.after.svg`), svg, "utf-8");
			}

			// Diff SVG (overlay). Missing side → empty graph: an added file
			// renders all-green, a deleted file all-red.
			writeFileSync(emptyTmp, "", "utf-8");
			const aPath = baseContent ? tmpFile : emptyTmp;
			const bPath = headExists ? headPath : emptyTmp;
			const diffSvg = renderDiffSvg(aPath, bPath);
			writeFileSync(join(svgDir, `${stem}.diff.svg`), diffSvg, "utf-8");
		} finally {
			try { unlinkSync(tmpFile); } catch { /* ignore */ }
			try { unlinkSync(emptyTmp); } catch { /* ignore */ }
		}
	}

	console.log(`Generated SVGs in docs/diagrams/pr-${prNumber}/`);

	const githubOutput = process.env.GITHUB_OUTPUT;
	if (githubOutput) {
		appendFileSync(githubOutput, "has_svgs=true\n", "utf-8");
	}
	process.exit(0);
}

// ── Phase 2: update PR description ────────────────────────────────────────

const rawBase = `https://raw.githubusercontent.com/takasek/ci-image-store/main/pfdsl/pr-${prNumber}`;

const sections = changedFiles.map((file) => {
	const sanitized = sanitizePath(file);
	const stem = basename(sanitized);
	const relDir = dirname(sanitized);
	const rawDir = relDir === "." ? rawBase : `${rawBase}/${relDir}`;
	const lines = [`### \`${file}\``];

	if (existsSync(join(outDir, `${sanitized}.before.svg`))) {
		lines.push(`**Before**\n![before](${rawDir}/${stem}.before.svg)`);
	}
	if (existsSync(join(outDir, `${sanitized}.after.svg`))) {
		lines.push(`**After**\n![after](${rawDir}/${stem}.after.svg)`);
	}
	if (existsSync(join(outDir, `${sanitized}.diff.svg`))) {
		lines.push(`**Diff**\n![diff](${rawDir}/${stem}.diff.svg)`);
	}
	return lines.join("\n\n");
});

if (sections.length === 0) {
	console.log("No SVGs found; skipping PR description update.");
	process.exit(0);
}

const MARKER_START = "<!-- pfdsl-diff-images-start -->";
const MARKER_END = "<!-- pfdsl-diff-images-end -->";

const newSection = [
	MARKER_START,
	"",
	"## PFD Diagram Changes",
	"",
	sections.join("\n\n---\n\n"),
	"",
	MARKER_END,
].join("\n");

const currentBody = execFileSync(
	"gh",
	["pr", "view", prNumber, "--json", "body", "-q", ".body"],
	{ encoding: "utf-8", cwd: root, env: ghEnv },
).trim();

const stripped = currentBody
	.replace(new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`, "g"), "")
	.trimEnd();

const newBody = stripped ? `${stripped}\n\n${newSection}` : newSection;

execFileSync("gh", ["pr", "edit", prNumber, "--body", newBody], {
	encoding: "utf-8",
	cwd: root,
	env: ghEnv,
});

console.log(`Updated PR #${prNumber} description with diagram images.`);
