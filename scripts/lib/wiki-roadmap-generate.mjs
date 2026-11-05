import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	acquireRoadmapSource,
	roadmapSourceIdentity,
} from "./roadmap-source.mjs";
import {
	run,
	git as runGit,
	withoutGitTargetEnvironment,
} from "./run-exec.mjs";

// Like gen-samples, load the build output at runtime; it is absent in unbuilt clones.
const { parse } = await import(
	fileURLToPath(new URL("../../packages/core/dist/index.js", import.meta.url))
);

const outputs = ["roadmap.index.md", "roadmap.svg"];
const inputs = ["roadmap.pfdsl", "roadmap.md"];
const marker = "<!-- pfdsl-wiki-preview: ";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function toolIdentity(cli) {
	const root = resolve(dirname(cli), "../../..");
	const digest = createHash("sha256")
		.update(process.version)
		.update(readFileSync(join(root, "pnpm-lock.yaml")));
	for (const name of ["cli", "core", "graphviz-exporter", "preview-engine"]) {
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
const gitOutput = (cwd, ...args) =>
	runGit(["-C", cwd, ...args], {
		env: withoutGitTargetEnvironment(process.env),
		captureStderr: true,
	});
const git = (cwd, ...args) => gitOutput(cwd, ...args).trim();
const read = (wiki, name) => readFileSync(join(wiki, name), "utf8");
function regular(wiki, name, required = true) {
	const path = join(wiki, name);
	if (!existsSync(path) && !lstatExists(path)) {
		if (required) throw new Error(`Missing input: ${name}`);
		return;
	}
	if (!lstatSync(path).isFile())
		throw new Error(`Expected a regular file: ${name}`);
}
function lstatExists(path) {
	try {
		lstatSync(path);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
}
function checkout(wiki) {
	wiki = realpathSync(wiki);
	if (realpathSync(git(wiki, "rev-parse", "--show-toplevel")) !== wiki)
		throw new Error("Wiki must be the checkout root");
	return wiki;
}
function clean(wiki) {
	if (git(wiki, "status", "--porcelain", "--untracked-files=all"))
		throw new Error("Wiki checkout must be clean");
}
function safeText(value) {
	return String(value)
		.replace(/\s+/g, " ")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replace(/[\\`*_{}[\]()#!|]/g, "\\$&");
}
function indexPage(metadata, receipt) {
	const root = `https://github.com/${receipt.repository}/wiki`;
	const raw = `https://raw.githubusercontent.com/wiki/${receipt.repository}`;
	const record = JSON.stringify(receipt)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e");
	return `# ${safeText(metadata.title || "Roadmap")}\n\n${metadata.description ? `${safeText(metadata.description)}\n\n` : ""}This is a trial preview for issue #1519. The repository roadmap remains authoritative.\n\n![Roadmap diagram](roadmap.svg)\n\nCompanion: [preview](${root}/roadmap) · [source](${raw}/roadmap.md)\n\n[PFD source (roadmap.pfdsl)](${raw}/roadmap.pfdsl)\n\nThis diagram shows the last successfully validated snapshot. Edits may be newer; a failed generation leaves this view unchanged.\n\n- Validation: strict PFD check and fixed-snapshot reference checks passed.\n- Input Wiki revision: \`${receipt.wikiRevision}\`\n- Generated at: ${receipt.generatedAt}\n- Toolchain digest: \`${receipt.toolchain}\`\n- [Generation status](https://github.com/${receipt.repository}/actions/workflows/wiki-roadmap-generate.yml)\n\n${marker}${record} -->\n`;
}
function snapshotKey(wiki, revision, repository, toolchain) {
	// Include the whole source tree: a preset/subflow/link target may affect validation.
	// Exclude only this generator's own output pair to avoid a publication loop.
	const tree = git(wiki, "ls-tree", "-r", "-z", revision)
		.split("\0")
		.filter(Boolean)
		.filter((entry) => !outputs.includes(entry.slice(entry.indexOf("\t") + 1)));
	return hash(JSON.stringify([repository, toolchain, tree]));
}
/** Generate a pair from a committed Wiki snapshot. Never execute PFD commands. */
export function generate({
	wiki,
	repository,
	cli,
	expectedRevision,
	roadmapSource,
	localSources = {},
}) {
	if (!/^[\w-]+\/[\w.-]+$/.test(repository ?? ""))
		throw new Error("Expected repository owner/name");
	wiki = checkout(wiki);
	clean(wiki);
	const wikiRevision = git(wiki, "rev-parse", "HEAD");
	if (expectedRevision && expectedRevision !== wikiRevision)
		throw new Error("Wiki revision conflict");
	for (const name of inputs) regular(wiki, name);
	for (const name of outputs) regular(wiki, name, false);
	const toolchain = hash(
		toolIdentity(cli) +
			readFileSync(import.meta.filename) +
			readFileSync(new URL("./roadmap-source.mjs", import.meta.url)) +
			readFileSync(new URL("./run-exec.mjs", import.meta.url)),
	);
	// Git may normalize editor bytes on commit or change line endings on checkout.
	// Validate and describe the published blobs; retain raw hashes for race detection.
	const committedInputs = inputs.map((name) =>
		gitOutput(wiki, "show", `${wikiRevision}:${name}`),
	);
	const worktreeInputHashes = inputs.map((name) => hash(read(wiki, name)));
	const sourceHash = hash(committedInputs[0]),
		companionHash = hash(committedInputs[1]);
	const metadata = parse(committedInputs[0]).frontmatter ?? {};
	const source =
		roadmapSource?.source ?? `https://github.com/${repository}.wiki.git`;
	if (
		roadmapSource &&
		(roadmapSource.documentId !== inputs[0] ||
			(roadmapSource.companionId ?? inputs[1]) !== inputs[1])
	)
		throw new Error("Wiki generator requires roadmap.pfdsl and roadmap.md");
	const acquired = acquireRoadmapSource({
		descriptor: roadmapSource
			? { ...roadmapSource, revision: wikiRevision }
			: {
					adapter: "local-git",
					source,
					revision: wikiRevision,
					documentId: inputs[0],
					companionId: inputs[1],
					logicalPath: inputs[0],
					basis: { source, revision: wikiRevision },
				},
		localSources: { ...localSources, [source]: wiki },
	});
	try {
		const referenceContext = roadmapSourceIdentity(acquired.context);
		// The Wiki tree already identifies all source bytes, excluding only our outputs.
		// Its commit changes on output-only publication and must not cause a loop.
		const keyContext = {
			...referenceContext,
			model: { ...referenceContext.model, fixedRevision: undefined },
			...(referenceContext.basis?.source === source
				? {
						basis: {
							source,
							sourceTree: snapshotKey(
								wiki,
								referenceContext.basis.fixedRevision,
								repository,
								toolchain,
							),
						},
					}
				: {}),
		};
		const key = hash(
			JSON.stringify([
				snapshotKey(wiki, wikiRevision, repository, toolchain),
				keyContext,
			]),
		);
		if (
			existsSync(join(wiki, outputs[0])) &&
			existsSync(join(wiki, outputs[1]))
		) {
			try {
				const page = gitOutput(wiki, "show", `${wikiRevision}:${outputs[0]}`);
				const start = page.lastIndexOf(marker);
				const receipt = JSON.parse(
					page.slice(start + marker.length).split(" -->")[0],
				);
				if (
					receipt.key === key &&
					receipt.svgHash ===
						hash(gitOutput(wiki, "show", `${wikiRevision}:${outputs[1]}`)) &&
					page === indexPage(metadata, receipt)
				)
					return {
						status: "unchanged",
						wikiRevision,
						key,
						sourceHash,
						companionHash,
						worktreeInputHashes,
						worktreeOutputHashes: outputs.map((name) => hash(read(wiki, name))),
						indexHash: hash(page),
						svgHash: receipt.svgHash,
						inputWikiRevision: receipt.wikiRevision,
						referenceContext: receipt.referenceContext,
					};
			} catch {
				/* A damaged receipt is regenerated, not trusted. */
			}
		}
		const file = acquired.file;
		const invoke = (...args) =>
			run(process.execPath, [cli, ...args], {
				cwd: dirname(file),
				captureStderr: true,
				env: withoutGitTargetEnvironment(process.env),
			});
		invoke(
			"check",
			file,
			"--strict",
			"--reference-context",
			acquired.contextFile,
		);
		const referenceChecks = [];
		for (const doc of acquired.documents) {
			if (doc.roles.some((role) => role !== "preset")) {
				const report = JSON.parse(
					invoke(
						"meta",
						"check-links",
						doc.file,
						"--json",
						"--reference-context",
						doc.contextFile,
					),
				);
				if (!report.ok || !report.referenceResolution)
					throw new Error(
						"Reference validation did not return a successful resolution record",
					);
				const evidence = report.referenceResolution;
				referenceChecks.push({
					...roadmapSourceIdentity(evidence),
					results: evidence.results.map(({ root, value, ...result }) => ({
						...result,
						...(result.kind === "url" ? { value } : {}),
					})),
				});
			}
		}
		const svg = invoke(
			"render",
			file,
			"--format",
			"svg",
			"--reference-context",
			acquired.contextFile,
		);
		const receipt = {
			version: 1,
			repository,
			key,
			wikiRevision,
			sourceHash,
			companionHash,
			svgHash: hash(svg),
			toolchain,
			referenceContext,
			referenceChecks,
			generatedAt: new Date().toISOString(),
		};
		const index = indexPage(metadata, receipt);
		// Recheck the caller checkout after validation, before replacing either output.
		clean(wiki);
		if (git(wiki, "rev-parse", "HEAD") !== wikiRevision)
			throw new Error("Wiki revision conflict");
		writeFileSync(join(wiki, outputs[1]), svg);
		writeFileSync(join(wiki, outputs[0]), index);
		return {
			status: "generated",
			wikiRevision,
			key,
			sourceHash,
			companionHash,
			worktreeInputHashes,
			worktreeOutputHashes: [hash(index), hash(svg)],
			indexHash: hash(index),
			svgHash: hash(svg),
			referenceContext,
		};
	} finally {
		acquired.dispose();
	}
}

/** Publish source changes with their generated or reusable pair using a non-force push. */
export function publish({
	wiki,
	result,
	expectedRemote,
	expectedRemoteRevision = result.wikiRevision,
	transportWiki = wiki,
}) {
	wiki = checkout(wiki);
	const sourceOnly =
		result.status === "unchanged" &&
		expectedRemoteRevision !== result.wikiRevision;
	if (result.status === "unchanged" && !sourceOnly) return result;
	if (result.status !== "generated" && !sourceOnly)
		throw new Error("No generated pair to publish");
	transportWiki = checkout(transportWiki);
	if (
		!expectedRemote ||
		git(transportWiki, "remote", "get-url", "origin") !== expectedRemote ||
		git(transportWiki, "remote", "get-url", "--push", "origin") !==
			expectedRemote
	)
		throw new Error("Unexpected Wiki remote");
	const branch = git(wiki, "symbolic-ref", "--short", "HEAD");
	if (git(wiki, "rev-parse", "HEAD") !== result.wikiRevision)
		throw new Error("Wiki revision conflict");
	if (git(wiki, "diff", "--cached", "--name-only"))
		throw new Error("Wiki index must be clean");
	for (const name of [...inputs, ...outputs]) regular(wiki, name);
	if (
		inputs.some(
			(name, index) =>
				hash(read(wiki, name)) !== result.worktreeInputHashes[index],
		) ||
		outputs.some(
			(name, index) =>
				hash(read(wiki, name)) !== result.worktreeOutputHashes[index],
		)
	)
		throw new Error("Generated snapshot changed");
	git(transportWiki, "fetch", "origin", branch);
	if (git(transportWiki, "rev-parse", "FETCH_HEAD") !== expectedRemoteRevision)
		throw new Error("Wiki remote conflict: generate from the new revision");
	if (result.status === "generated") {
		git(wiki, "add", "--", ...outputs);
		git(
			wiki,
			"-c",
			"user.name=github-actions[bot]",
			"-c",
			"user.email=41898282+github-actions[bot]@users.noreply.github.com",
			"commit",
			"-m",
			"docs(wiki): generate roadmap index and SVG",
		);
	}
	const revision = git(wiki, "rev-parse", "HEAD");
	// Network operations use the editor checkout's own Git authentication settings.
	if (transportWiki !== wiki)
		git(transportWiki, "fetch", "--no-tags", wiki, branch);
	git(transportWiki, "push", "origin", `${revision}:refs/heads/${branch}`);
	return {
		status: "published",
		revision,
		inputWikiRevision: result.inputWikiRevision ?? result.wikiRevision,
	};
}
