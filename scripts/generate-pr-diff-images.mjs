#!/usr/bin/env node
// Generates before/after SVG diagrams for .pfdsl files changed in a merged PR,
// and updates the PR description with image links.
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
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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

function renderSvg(filePath) {
	return execFileSync("pfdsl", ["graph", filePath, "--format", "svg"], {
		encoding: "utf-8",
		cwd: root,
	});
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

		// Before SVG (base version)
		const baseContent = getBaseContent(file);
		if (baseContent) {
			writeFileSync(tmpFile, baseContent, "utf-8");
			try {
				const svg = renderSvg(tmpFile);
				writeFileSync(join(svgDir, `${stem}.before.svg`), svg, "utf-8");
			} finally {
				try { unlinkSync(tmpFile); } catch { /* ignore */ }
			}
		}

		// After SVG (head version)
		const headPath = join(root, file);
		if (existsSync(headPath)) {
			const svg = renderSvg(headPath);
			writeFileSync(join(svgDir, `${stem}.after.svg`), svg, "utf-8");
		}
	}

	console.log(`Generated SVGs in docs/diagrams/pr-${prNumber}/`);
	process.exit(0);
}

// ── Phase 2: update PR description ────────────────────────────────────────

const defaultBranch = process.env.DEFAULT_BRANCH ?? "main";
const rawBase = `https://raw.githubusercontent.com/${repo}/${defaultBranch}/docs/diagrams/pr-${prNumber}`;

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
	{ encoding: "utf-8", cwd: root },
).trim();

const stripped = currentBody
	.replace(new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`, "g"), "")
	.trimEnd();

const newBody = stripped ? `${stripped}\n\n${newSection}` : newSection;

execFileSync("gh", ["pr", "edit", prNumber, "--body", newBody], {
	encoding: "utf-8",
	cwd: root,
});

console.log(`Updated PR #${prNumber} description with diagram images.`);
