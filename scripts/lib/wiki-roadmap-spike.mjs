// Local-only experiment for #1519. Not a production storage adapter.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function toolIdentity(cli) {
	const root = resolve(dirname(cli), "../../..");
	const digest = createHash("sha256")
		.update(process.version)
		.update(readFileSync(join(root, "pnpm-lock.yaml")));
	for (const name of ["cli", "core", "graphviz-exporter"]) {
		const dist = join(root, "packages", name, "dist");
		for (const file of readdirSync(dist)
			.filter((file) => file.endsWith(".js"))
			.sort()) {
			digest
				.update(name)
				.update(file)
				.update(readFileSync(join(dist, file)));
		}
	}
	return digest.digest("hex");
}
function gitOutput(cwd, ...args) {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}
function git(cwd, ...args) {
	return gitOutput(cwd, ...args).trim();
}

export function extractRoadmap(page) {
	const tree = fromMarkdown(page);
	const blocks = [];
	const visit = (node) => {
		if (node.type === "code" && node.lang === "pfdsl") blocks.push(node);
		for (const child of node.children ?? []) visit(child);
	};
	visit(tree);
	if (blocks.length !== 1 || !tree.children.includes(blocks[0])) {
		throw new Error("Expected exactly one top-level pfdsl code block");
	}
	const block = blocks[0];
	const raw = page.slice(
		block.position.start.offset,
		block.position.end.offset,
	);
	const lines = raw.split(/\r?\n/);
	const open = lines[0].match(/^ {0,3}(`{3,}|~{3,})pfdsl\s*$/);
	if (
		!open ||
		!new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}\\s*$`).test(
			lines.at(-1),
		)
	) {
		throw new Error("Expected a closed pfdsl fence without metadata");
	}
	return `${block.value}\n`;
}

export function acquire({
	repo,
	wiki,
	repoRevision,
	root: workspace = tmpdir(),
}) {
	// Only local fixture repositories are accepted; this cannot publish to GitHub.
	const repository = realpathSync(repo);
	const wikiRemote = realpathSync(wiki);
	const root = mkdtempSync(join(workspace, "pfdsl-wiki-snapshot-"));
	const wikiClone = join(root, "wiki");
	const code = join(root, "code");
	git(root, "clone", "--no-local", wikiRemote, wikiClone);
	const wikiRevision = git(wikiClone, "rev-parse", "HEAD");
	const branch = git(wikiClone, "symbolic-ref", "--short", "HEAD");
	const page = readFileSync(join(wikiClone, "Roadmap.md"), "utf8");
	const source = extractRoadmap(page);
	const revision = git(
		repository,
		"rev-parse",
		"--verify",
		`${repoRevision}^{commit}`,
	);
	git(root, "clone", "--no-local", "--no-checkout", repository, code);
	git(code, "checkout", "--detach", revision);
	const file = join(code, ".pfdsl/roadmap.pfdsl");
	writeFileSync(file, source);
	return {
		root,
		wiki: wikiClone,
		code,
		file,
		branch,
		wikiRevision,
		repoRevision: revision,
		source,
		sourceHash: hash(source),
		page,
	};
}

export function evaluate(snapshot, cli) {
	const run = (...args) =>
		execFileSync(process.execPath, [cli, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	// This experiment runs against a single already-built CLI, not a downloaded toolchain.
	const key = hash(
		JSON.stringify([
			snapshot.sourceHash,
			snapshot.repoRevision,
			toolIdentity(cli),
		]),
	);
	if (readFileSync(snapshot.file, "utf8") !== snapshot.source)
		throw new Error("Snapshot changed");
	run("check", snapshot.file, "--strict");
	run("meta", "check-links", snapshot.file);
	const ready = JSON.parse(run("status", "ready", snapshot.file, "--json"));
	const blocked = JSON.parse(run("status", "blocked", snapshot.file, "--json"));
	const manifestPath = join(snapshot.wiki, "Roadmap.render.json");
	if (existsSync(manifestPath)) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const image = join(snapshot.wiki, "Roadmap.svg");
		if (
			manifest.key === key &&
			existsSync(image) &&
			manifest.svgHash === hash(readFileSync(image))
		) {
			return { status: "unchanged", key, ready, blocked };
		}
	}
	const svg = run("render", snapshot.file, "--format", "svg");
	if (readFileSync(snapshot.file, "utf8") !== snapshot.source)
		throw new Error("Snapshot changed");
	return {
		status: "rendered",
		key,
		ready,
		blocked,
		svg,
		sourceHash: snapshot.sourceHash,
		repoRevision: snapshot.repoRevision,
	};
}

export function publish(snapshot, result) {
	if (
		result.status !== "rendered" ||
		result.sourceHash !== snapshot.sourceHash ||
		result.repoRevision !== snapshot.repoRevision
	)
		throw new Error("No matching rendered result");
	git(snapshot.wiki, "fetch", "origin");
	if (
		git(snapshot.wiki, "rev-parse", `origin/${snapshot.branch}`) !==
		snapshot.wikiRevision
	) {
		throw new Error(
			"Wiki conflict: acquire the new version and evaluate again",
		);
	}
	if (readFileSync(join(snapshot.wiki, "Roadmap.md"), "utf8") !== snapshot.page)
		throw new Error("Wiki page changed");
	const manifest = {
		key: result.key,
		wikiRevision: snapshot.wikiRevision,
		repoRevision: snapshot.repoRevision,
		sourceHash: snapshot.sourceHash,
		svgHash: hash(result.svg),
	};
	writeFileSync(join(snapshot.wiki, "Roadmap.svg"), result.svg);
	writeFileSync(
		join(snapshot.wiki, "Roadmap.render.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	git(snapshot.wiki, "add", "--", "Roadmap.svg", "Roadmap.render.json");
	git(
		snapshot.wiki,
		"-c",
		"user.name=Wiki spike",
		"-c",
		"user.email=wiki-spike@example.invalid",
		"commit",
		"-m",
		"Render pinned roadmap",
	);
	// A race after fetch is still rejected by the normal non-force push.
	git(snapshot.wiki, "push", "origin", `HEAD:${snapshot.branch}`);
	const publishedRevision = git(snapshot.wiki, "rev-parse", "HEAD");
	git(snapshot.wiki, "fetch", "origin");
	const currentRevision = git(
		snapshot.wiki,
		"rev-parse",
		`origin/${snapshot.branch}`,
	);
	if (
		gitOutput(snapshot.wiki, "show", `${publishedRevision}:Roadmap.md`) !==
		snapshot.page
	)
		throw new Error("Readback mismatch");
	return {
		status: "published",
		publishedRevision,
		currentRevision,
		current: currentRevision === publishedRevision,
	};
}
