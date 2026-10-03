#!/usr/bin/env node
/**
 * gen-article-images.mjs
 *
 * Renders the SVG figures referenced by docs/articles/*.md (README.md
 * excluded) from the ```pfdsl code blocks embedded in each article. The
 * images/<name>.svg reference that first appears right after a block is
 * treated as that block's output image; blocks with no such reference (NG
 * examples, typically marked with the preceding `<!-- pfdsl-nocheck -->`)
 * are skipped.
 *
 * Usage:
 *   node scripts/gen-article-images.mjs          # (re)generate docs/articles/images/*.svg
 *   node scripts/gen-article-images.mjs --check   # verify images are up to date (CI / pre-commit)
 *
 * Exit 0 = success. Exit 1 = a block with an image reference failed to
 * render, an image name is referenced twice within one article, or (in
 * --check mode) generated output differs from what's on disk.
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { extractPfdslBlocks, attachImageRefs, findDuplicateImageNames, findOrphanImages } from "./lib/gen-article-images-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const articlesDir = join(root, "docs", "articles");
const imagesDir = join(articlesDir, "images");
const CLI = join(root, "packages", "cli", "dist", "cli.js");

const checkMode = process.argv.includes("--check");

function renderSvg(content, tmpPath) {
	writeFileSync(tmpPath, content, "utf-8");
	try {
		const result = spawnSync("node", [CLI, "graph", tmpPath, "--format", "svg"], { encoding: "utf-8" });
		if (result.status !== 0) {
			return { ok: false, stdout: result.stdout, stderr: result.stderr };
		}
		return { ok: true, svg: result.stdout };
	} finally {
		try {
			unlinkSync(tmpPath);
		} catch {
			/* ignore */
		}
	}
}

const articleFiles = readdirSync(articlesDir)
	.filter((f) => f.endsWith(".md") && f !== "README.md")
	.sort();

/** @type {{filePath: string, startLine: number, content: string, imageName: string}[]} */
const tasks = [];
let hadError = false;

for (const file of articleFiles) {
	const filePath = join(articlesDir, file);
	const text = readFileSync(filePath, "utf-8");
	const blocks = attachImageRefs(text, extractPfdslBlocks(text));

	const dups = findDuplicateImageNames(blocks);
	if (dups.length > 0) {
		console.error(`${file}: image name(s) referenced more than once: ${dups.join(", ")}`);
		hadError = true;
		continue;
	}

	for (const block of blocks) {
		if (!block.imageName) continue; // no image ref → NG example etc., skip
		tasks.push({ filePath: file, startLine: block.startLine, content: block.content, imageName: block.imageName });
	}
}

if (hadError) {
	process.exit(1);
}

// --- Orphan image warning (images/ files not referenced by any block) ---

const onDiskImages = readdirSync(imagesDir)
	.filter((f) => f.endsWith(".svg"))
	.sort();
const referencedImages = tasks.map((t) => t.imageName);
const orphans = findOrphanImages(onDiskImages, referencedImages);
for (const orphan of orphans) {
	console.warn(`warning: images/${orphan} is not referenced by any pfdsl block`);
}

// --- Render + write (or check) ---

const staleFiles = [];

for (const task of tasks) {
	const tmpPath = join(tmpdir(), `pfdsl-article-img-${process.pid}-${basename(task.imageName)}.pfdsl`);
	const rendered = renderSvg(task.content, tmpPath);

	if (!rendered.ok) {
		console.error(`${task.filePath}:${task.startLine}: failed to render images/${task.imageName}`);
		if (rendered.stdout) process.stdout.write(rendered.stdout);
		if (rendered.stderr) process.stderr.write(rendered.stderr);
		process.exit(1);
	}

	const outPath = join(imagesDir, task.imageName);

	if (checkMode) {
		const existing = existsSync(outPath) ? readFileSync(outPath, "utf-8") : null;
		if (existing === null || existing !== rendered.svg) {
			staleFiles.push(task.imageName);
		}
		console.log(`${task.filePath}:${task.startLine} -> images/${task.imageName} (checked)`);
	} else {
		writeFileSync(outPath, rendered.svg, "utf-8");
		console.log(`${task.filePath}:${task.startLine} -> images/${task.imageName}`);
	}
}

if (checkMode) {
	if (staleFiles.length > 0) {
		console.error(`stale: ${staleFiles.join(", ")}`);
		console.error("Run 'node scripts/gen-article-images.mjs' and commit the result.");
		process.exit(1);
	}
	console.log("gen-article-images --check: OK");
}
