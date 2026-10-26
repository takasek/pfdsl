// Local preparation only. This module never publishes a page or changes Git refs.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { extractRoadmap, toolIdentity } from "./wiki-roadmap-spike.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

export function buildEditCandidate({
	page,
	wikiRevision,
	expectedRevision,
	expectedPageHash,
	replacement,
}) {
	if (
		!/^[a-f0-9]{40,64}$/.test(wikiRevision) ||
		wikiRevision !== expectedRevision
	)
		throw new Error(
			"Wiki revision conflict: acquire the current version again",
		);
	if (hash(page) !== expectedPageHash)
		throw new Error("Wiki page conflict: acquire the current page again");
	const originalSource = extractRoadmap(page);
	const block = fromMarkdown(page).children.find(
		(node) => node.type === "code" && node.lang === "pfdsl",
	);
	const start = block.position.start.offset;
	const end = block.position.end.offset;
	const raw = page.slice(start, end);
	const lines = raw.split(/\r?\n/);
	const opening = lines[0].match(/^( {0,3})(`{3,}|~{3,})pfdsl\s*$/);
	const closing = lines.at(-1).match(/^( {0,3})(`{3,}|~{3,})\s*$/);
	const source = replacement.replaceAll("\r\n", "\n").replace(/(?<!\n)$/, "\n");
	const marker = opening[2][0];
	const fenceLike = new RegExp(`^ {0,3}(${marker}+)[ \\t]*$`, "gm");
	const length = Math.max(
		opening[2].length,
		closing[2].length,
		...Array.from(source.matchAll(fenceLike), (match) => match[1].length + 1),
	);
	const fence = marker.repeat(length);
	const eol = raw.includes("\r\n") ? "\r\n" : "\n";
	const lineStart = page.lastIndexOf("\n", start - 1) + 1;
	const bodyIndent = page.slice(lineStart, start) + opening[1];
	const body =
		source
			.split("\n")
			.slice(0, -1)
			.map((line) => bodyIndent + line)
			.join(eol) + eol;
	const updated =
		page.slice(0, start) +
		`${opening[1]}${fence}pfdsl${eol}${body}${closing[1]}${fence}` +
		page.slice(end);
	if (extractRoadmap(updated).replaceAll("\r\n", "\n") !== source)
		throw new Error("Candidate model did not survive Markdown replacement");
	return {
		page: updated,
		source,
		base: {
			wikiRevision,
			page: "Roadmap.md",
			pageHash: hash(page),
			sourceHash: hash(originalSource),
		},
		candidate: { pageHash: hash(updated), sourceHash: hash(source) },
	};
}

export function prepareEdit({
	snapshot,
	expectedRevision,
	expectedPageHash,
	replacement,
	output,
	cli,
}) {
	if (existsSync(output)) throw new Error("Output already exists");
	if (
		readFileSync(join(snapshot.wiki, "Roadmap.md"), "utf8") !== snapshot.page ||
		readFileSync(snapshot.file, "utf8") !== snapshot.source
	)
		throw new Error("Acquired snapshot changed");
	const candidate = buildEditCandidate({
		page: snapshot.page,
		wikiRevision: snapshot.wikiRevision,
		expectedRevision,
		expectedPageHash,
		replacement,
	});
	const run = (...args) =>
		execFileSync(process.execPath, [cli, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	const query = () => ({
		ready: JSON.parse(run("status", "ready", snapshot.file, "--json")),
		blocked: JSON.parse(run("status", "blocked", snapshot.file, "--json")),
	});
	let baseline;
	try {
		run("check", snapshot.file, "--strict");
		baseline = { valid: true, ...query() };
	} catch (error) {
		baseline = { valid: false, error: String(error.stderr || error.message) };
	}
	let graph;
	let svg;
	try {
		writeFileSync(snapshot.file, candidate.source);
		run("check", snapshot.file, "--strict");
		graph = query();
		svg = run("render", snapshot.file, "--format", "svg");
	} finally {
		writeFileSync(snapshot.file, snapshot.source);
	}
	const manifest = {
		base: candidate.base,
		candidate: candidate.candidate,
		baseline,
		...graph,
		contextRepositoryRevision: snapshot.repoRevision,
		toolchain: { digest: toolIdentity(cli) },
		logicalModelPath: ".pfdsl/roadmap.pfdsl",
		validation: "syntax-and-graph-only",
		referenceResolution: "not-verified",
		operationalReady: false,
	};
	// Create a fresh directory only after validation. The manifest is the completion marker.
	mkdirSync(output);
	writeFileSync(join(output, "Roadmap.before.md"), snapshot.page, {
		flag: "wx",
	});
	writeFileSync(join(output, "Roadmap.md"), candidate.page, { flag: "wx" });
	writeFileSync(join(output, "roadmap.pfdsl"), candidate.source, {
		flag: "wx",
	});
	writeFileSync(join(output, "Roadmap.svg"), svg, { flag: "wx" });
	const diff = spawnSync(
		"git",
		[
			"diff",
			"--no-ext-diff",
			"--no-textconv",
			"--no-index",
			"--",
			"Roadmap.before.md",
			"Roadmap.md",
		],
		{ cwd: output, encoding: "utf8" },
	);
	if (diff.status !== 0 && diff.status !== 1)
		throw new Error("Could not produce candidate diff");
	writeFileSync(join(output, "Roadmap.diff"), diff.stdout, { flag: "wx" });
	writeFileSync(
		join(output, "manifest.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
		{ flag: "wx" },
	);
	return manifest;
}
