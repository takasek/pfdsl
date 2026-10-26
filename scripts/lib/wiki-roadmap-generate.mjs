import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
	analyze,
	loadDependencyClosure,
	parse,
	wrapPresetSource,
} from "../../packages/core/dist/index.js";
import {
	run,
	git as runGit,
	withoutGitTargetEnvironment,
} from "./run-exec.mjs";
import { toolIdentity } from "./wiki-roadmap-spike.mjs";

const outputs = ["roadmap.index.md", "roadmap.svg"];
const inputs = ["roadmap.pfdsl", "roadmap.md"];
const marker = "<!-- pfdsl-wiki-preview: ";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (cwd, ...args) =>
	runGit(["-C", cwd, ...args], {
		env: withoutGitTargetEnvironment(process.env),
		captureStderr: true,
	}).trim();
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
	return `# ${safeText(metadata.title || "Roadmap")}\n\n${metadata.description ? `${safeText(metadata.description)}\n\n` : ""}This is a trial preview for issue #1519. The repository roadmap remains authoritative.\n\n![Roadmap diagram](roadmap.svg)\n\nCompanion: [preview](${root}/roadmap) · [source](${raw}/roadmap.md)\n\n[PFD source (roadmap.pfdsl)](${raw}/roadmap.pfdsl)\n\nThis diagram shows the last successfully validated snapshot. Edits may be newer; a failed generation leaves this view unchanged.\n\n- Validation: strict PFD check and local link check passed. External reference resolution is not supported by this generator.\n- Input Wiki revision: \`${receipt.wikiRevision}\`\n- Generated at: ${receipt.generatedAt}\n- Toolchain digest: \`${receipt.toolchain}\`\n- [Generation status](https://github.com/${receipt.repository}/actions/workflows/wiki-roadmap-generate.yml)\n\n${marker}${JSON.stringify(receipt)} -->\n`;
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
function rejectUnsupportedReferences(directory) {
	directory = realpathSync(directory);
	loadDependencyClosure(join(directory, inputs[0]), (file) => {
		const name = relative(directory, file);
		if (isAbsolute(name) || name === ".." || name.startsWith("../"))
			throw new Error("Dependency leaves the Wiki snapshot");
		regular(directory, name);
		const actual = relative(directory, realpathSync(file));
		if (isAbsolute(actual) || actual === ".." || actual.startsWith("../"))
			throw new Error("Dependency leaves the Wiki snapshot");
		const result = analyze(wrapPresetSource(file, read(directory, name)), {
			strict: true,
		});
		const { frontmatter } = result;
		if (
			frontmatter?.baseRef !== undefined ||
			Object.values(frontmatter?.artifact ?? {}).some(
				(node) => node?.ref !== undefined,
			)
		) {
			throw new Error(
				`External reference resolution is not supported: ${name}`,
			);
		}
		return result;
	});
}

/** Generate a pair from a committed Wiki snapshot. Never execute PFD commands. */
export function generate({ wiki, repository, cli, expectedRevision }) {
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
			readFileSync(new URL("./run-exec.mjs", import.meta.url)),
	);
	const key = snapshotKey(wiki, wikiRevision, repository, toolchain);
	const sourceHash = hash(read(wiki, inputs[0])),
		companionHash = hash(read(wiki, inputs[1]));
	const metadata = parse(read(wiki, inputs[0])).frontmatter ?? {};
	if (
		existsSync(join(wiki, outputs[0])) &&
		existsSync(join(wiki, outputs[1]))
	) {
		try {
			const page = read(wiki, outputs[0]);
			const start = page.lastIndexOf(marker);
			const receipt = JSON.parse(
				page.slice(start + marker.length).split(" -->")[0],
			);
			if (
				receipt.key === key &&
				receipt.svgHash === hash(read(wiki, outputs[1])) &&
				page === indexPage(metadata, receipt)
			)
				return { status: "unchanged", wikiRevision, key };
		} catch {
			/* A damaged receipt is regenerated, not trusted. */
		}
	}
	const scratch = mkdtempSync(join(tmpdir(), "pfdsl-wiki-generate-"));
	try {
		const snapshot = join(scratch, "wiki");
		git(scratch, "clone", "--no-local", "--no-checkout", wiki, snapshot);
		git(snapshot, "checkout", "--detach", wikiRevision);
		rejectUnsupportedReferences(snapshot);
		const file = join(snapshot, inputs[0]);
		const invoke = (...args) =>
			run(process.execPath, [cli, ...args], {
				cwd: snapshot,
				captureStderr: true,
				env: withoutGitTargetEnvironment(process.env),
			});
		invoke("check", file, "--strict");
		invoke("meta", "check-links", file);
		const svg = invoke("render", file, "--format", "svg");
		const receipt = {
			version: 1,
			repository,
			key,
			wikiRevision,
			sourceHash,
			companionHash,
			svgHash: hash(svg),
			toolchain,
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
			indexHash: hash(index),
			svgHash: hash(svg),
		};
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

/** Commit the generated pair, then use an ordinary non-force push. */
export function publish({ wiki, result, expectedRemote }) {
	wiki = checkout(wiki);
	if (result.status === "unchanged") return result;
	if (result.status !== "generated")
		throw new Error("No generated pair to publish");
	if (
		!expectedRemote ||
		git(wiki, "remote", "get-url", "origin") !== expectedRemote ||
		git(wiki, "remote", "get-url", "--push", "origin") !== expectedRemote
	)
		throw new Error("Unexpected Wiki remote");
	const branch = git(wiki, "symbolic-ref", "--short", "HEAD");
	if (git(wiki, "rev-parse", "HEAD") !== result.wikiRevision)
		throw new Error("Wiki revision conflict");
	if (git(wiki, "diff", "--cached", "--name-only"))
		throw new Error("Wiki index must be clean");
	for (const name of [...inputs, ...outputs]) regular(wiki, name);
	if (
		hash(read(wiki, inputs[0])) !== result.sourceHash ||
		hash(read(wiki, inputs[1])) !== result.companionHash ||
		hash(read(wiki, outputs[0])) !== result.indexHash ||
		hash(read(wiki, outputs[1])) !== result.svgHash
	)
		throw new Error("Generated snapshot changed");
	git(wiki, "fetch", "origin", branch);
	if (git(wiki, "rev-parse", "FETCH_HEAD") !== result.wikiRevision)
		throw new Error("Wiki remote conflict: generate from the new revision");
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
	git(wiki, "push", "origin", `HEAD:refs/heads/${branch}`);
	return {
		status: "published",
		revision: git(wiki, "rev-parse", "HEAD"),
		inputWikiRevision: result.wikiRevision,
	};
}
