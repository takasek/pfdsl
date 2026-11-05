import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git as runGit, withoutGitTargetEnvironment } from "./run-exec.mjs";

const { analyze, loadDependencyClosure, wrapPresetSource } = await import(
	fileURLToPath(new URL("../../packages/core/dist/index.js", import.meta.url))
);
const git = (cwd, ...args) =>
	runGit(["-C", cwd, ...args], {
		env: withoutGitTargetEnvironment(process.env),
		captureStderr: true,
	});
const blob = (cwd, oid) =>
	runGit(["-C", cwd, "cat-file", "blob", oid], {
		env: withoutGitTargetEnvironment(process.env),
		captureStderr: true,
		encoding: null,
	});
const digest = (value) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Explicit preparation settings, separate from the adopted repository config. */
export function readRoadmapSourceConfig(file) {
	if (file === undefined) return {};
	const settings = JSON.parse(readFileSync(file, "utf8"));
	if (
		!settings ||
		typeof settings !== "object" ||
		!settings.roadmapSource ||
		!settings.localSources ||
		typeof settings.localSources !== "object" ||
		Array.isArray(settings.localSources)
	)
		throw new Error(
			"Source config requires roadmapSource and localSources mappings",
		);
	return {
		roadmapSource: settings.roadmapSource,
		localSources: settings.localSources,
	};
}
function required(value, name) {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`Missing ${name}`);
	return value;
}
function logical(value, name) {
	required(value, name);
	if (
		isAbsolute(value) ||
		/^[A-Za-z]:/.test(value) ||
		value.includes("\\") ||
		value.split("/").some((part) => part === ".." || part === "." || !part)
	)
		throw new Error(`Invalid ${name}: ${value}`);
	return value;
}
function contained(root, file) {
	const path = relative(root, file);
	return (
		!isAbsolute(path) &&
		path !== ".." &&
		!path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
	);
}
function regular(root, name) {
	const file = resolve(root, name);
	if (!contained(root, file)) throw new Error(`Path outside snapshot: ${name}`);
	if (!existsSync(file)) throw new Error(`Missing snapshot path: ${name}`);
	if (!contained(root, realpathSync(file)))
		throw new Error(`Path outside snapshot: ${name}`);
	if (!lstatSync(file).isFile())
		throw new Error(`Expected a regular file: ${name}`);
	return file;
}

// Check link expansion before creating links, including intermediate links
// followed by '..'. Gitlinks cannot be materialized from the containing commit.
function inspectTree(checkout, revision) {
	const links = new Map();
	const files = [];
	for (const entry of git(checkout, "ls-tree", "-r", "-z", revision)
		.split("\0")
		.filter(Boolean)) {
		const [header, name] = [
			entry.slice(0, entry.indexOf("\t")),
			entry.slice(entry.indexOf("\t") + 1),
		];
		logical(name, "Git tree path");
		const [mode, , oid] = header.split(" ");
		if (header.startsWith("160000 "))
			throw new Error(
				`Snapshot acquisition failed: unsupported Git submodule ${name}`,
			);
		if (header.startsWith("120000 "))
			links.set(name, blob(checkout, oid).toString("utf8"));
		else files.push({ name, mode, oid });
	}
	for (const [name, target] of links) {
		const pending = [
			...posix
				.dirname(name)
				.split("/")
				.filter((part) => part !== "."),
			...target.split("/"),
		];
		const parts = [];
		let followed = 0;
		if (
			target.startsWith("/") ||
			target.includes("\\") ||
			/^[A-Za-z]:/.test(target)
		)
			throw new Error(`Snapshot symlink escapes outside the root: ${name}`);
		while (pending.length) {
			const part = pending.shift();
			if (!part || part === ".") continue;
			if (part === "..") {
				if (!parts.length)
					throw new Error(`Snapshot symlink escapes outside the root: ${name}`);
				parts.pop();
				continue;
			}
			parts.push(part);
			const next = links.get(parts.join("/"));
			if (next !== undefined) {
				if (++followed > 40) throw new Error(`Snapshot symlink cycle: ${name}`);
				if (
					next.startsWith("/") ||
					next.includes("\\") ||
					/^[A-Za-z]:/.test(next)
				)
					throw new Error(`Snapshot symlink escapes outside the root: ${name}`);
				parts.pop();
				pending.unshift(...next.split("/"));
			}
		}
	}
	return { links, files };
}

function materialize(checkout, revision, root) {
	const { links, files } = inspectTree(checkout, revision);
	// Raw blobs preserve export-ignore/export-subst files and binary contents.
	// All regular files are written before symlinks, so writes cannot follow links.
	for (const { name, mode, oid } of files) {
		const file = join(root, name);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, blob(checkout, oid), {
			mode: mode === "100755" ? 0o755 : 0o644,
			flag: "wx",
		});
	}
	for (const [name, target] of links) {
		const file = join(root, name);
		mkdirSync(dirname(file), { recursive: true });
		symlinkSync(target, file);
	}
}

/** Remove machine-local paths while retaining every identity needed to replay. */
export function roadmapSourceIdentity(context) {
	return {
		adapter: context.adapter,
		model: context.model,
		logicalPath: context.logicalPath,
		...(context.basis
			? {
					basis: {
						source: context.basis.source,
						fixedRevision: context.basis.fixedRevision,
					},
				}
			: {}),
		targets: context.targets.map(({ source, revision, fixedRevision }) => ({
			source,
			revision,
			fixedRevision,
		})),
	};
}

/** Acquire once; callers share its files and context until dispose(). No fetch or checkout mutation. */
export function acquireRoadmapSource({
	repositoryRoot = process.cwd(),
	descriptor,
	localSources = {},
	temporaryRoot = tmpdir(),
} = {}) {
	if (descriptor === undefined)
		return {
			file: join(repositoryRoot, ".pfdsl/roadmap.pfdsl"),
			companionFile: join(repositoryRoot, ".pfdsl/roadmap.md"),
			dispose() {},
		};
	if (descriptor.adapter !== "local-git")
		throw new Error(
			`Unsupported roadmap source adapter: ${descriptor.adapter}`,
		);
	const logicalPath = logical(descriptor.logicalPath, "model logical path");
	const documentId = logical(descriptor.documentId, "model document ID");
	const companionId = logical(
		descriptor.companionId ?? "roadmap.md",
		"companion document ID",
	);
	const scratch = realpathSync(
		mkdtempSync(join(temporaryRoot, "pfdsl-roadmap-source-")),
	);
	const dispose = () => rmSync(scratch, { recursive: true, force: true });
	const pinned = new Map(),
		extracted = new Map();
	function pin(source, revision) {
		required(source, "source");
		required(revision, "revision");
		const key = JSON.stringify([source, revision]);
		if (pinned.has(key)) return pinned.get(key);
		if (!Object.hasOwn(localSources, source))
			throw new Error(`Unknown source: ${source}`);
		const local = localSources[source];
		if (typeof local !== "string" || !isAbsolute(local))
			throw new Error(
				`Source requires an absolute local Git checkout: ${source}`,
			);
		let checkout;
		try {
			checkout = realpathSync(local);
			if (
				realpathSync(git(checkout, "rev-parse", "--show-toplevel").trim()) !==
				checkout
			)
				throw new Error("Expected checkout root");
		} catch (error) {
			throw new Error(
				`Snapshot acquisition failed for ${source}: ${error.message}`,
			);
		}
		let fixedRevision;
		try {
			fixedRevision = git(
				checkout,
				"rev-parse",
				"--verify",
				"--end-of-options",
				`${revision}^{commit}`,
			).trim();
		} catch {
			throw new Error(`Unknown revision for ${source}: ${revision}`);
		}
		const extraction = JSON.stringify([source, fixedRevision]);
		let root = extracted.get(extraction);
		if (!root) {
			root = join(scratch, `snapshot-${extracted.size}`);
			mkdirSync(root);
			try {
				materialize(checkout, fixedRevision, root);
			} catch (error) {
				throw new Error(
					`Snapshot acquisition failed for ${source}: ${error.message}`,
				);
			}
			extracted.set(extraction, root);
		}
		const binding = { source, revision, fixedRevision, root };
		pinned.set(key, binding);
		return binding;
	}
	try {
		const origin = pin(descriptor.source, descriptor.revision);
		const file = regular(origin.root, documentId);
		const companionFile = regular(origin.root, companionId);
		const basisBinding = descriptor.basis
			? pin(descriptor.basis.source, descriptor.basis.revision)
			: undefined;
		const basis = basisBinding
			? {
					source: basisBinding.source,
					fixedRevision: basisBinding.fixedRevision,
					root: basisBinding.root,
				}
			: undefined;
		const virtualRoot = basis?.root ?? join(scratch, "missing-basis");
		const entry = resolve(virtualRoot, logicalPath);
		const targets = new Map();
		function addTarget(ref) {
			if (
				!ref ||
				typeof ref !== "object" ||
				Array.isArray(ref) ||
				Object.keys(ref).length !== 2 ||
				!Object.hasOwn(ref, "source") ||
				!Object.hasOwn(ref, "revision") ||
				typeof ref.source !== "string" ||
				!ref.source.trim() ||
				typeof ref.revision !== "string" ||
				!ref.revision.trim()
			)
				throw new Error(
					"Invalid reference declaration: expected source and revision",
				);
			const binding = pin(ref.source, ref.revision);
			targets.set(JSON.stringify([ref.source, ref.revision]), binding);
		}
		const closure = loadDependencyClosure(entry, (path) => {
			if (path !== entry && !basis)
				throw new Error("Missing model basis for dependency resolution");
			const input =
				path === entry
					? file
					: regular(virtualRoot, relative(virtualRoot, path));
			const doc = analyze(wrapPresetSource(path, readFileSync(input, "utf8")), {
				strict: true,
			});
			if (doc.frontmatter?.baseRef !== undefined)
				addTarget(doc.frontmatter.baseRef);
			for (const artifact of Object.values(doc.frontmatter?.artifact ?? {}))
				if (artifact?.ref !== undefined) addTarget(artifact.ref);
			return doc;
		});
		const dependencyFailure = closure.diagnostics.find(
			(item) => item.severity === "error",
		);
		if (dependencyFailure)
			throw new Error(
				`${dependencyFailure.code}: ${dependencyFailure.message}`,
			);
		const context = {
			adapter: "local-git",
			model: {
				source: origin.source,
				fixedRevision: origin.fixedRevision,
				documentId,
				extractionId: "whole-file",
			},
			logicalPath,
			...(basis ? { basis } : {}),
			targets: [...targets.values()].sort((a, b) =>
				JSON.stringify([a.source, a.revision]).localeCompare(
					JSON.stringify([b.source, b.revision]),
				),
			),
		};
		const contextFile = join(scratch, "reference-context.json");
		writeFileSync(contextFile, `${JSON.stringify(context, null, 2)}\n`);
		const documents = [...closure.docs.keys()].map((path, index) => {
			if (path === entry)
				return {
					file,
					contextFile,
					logicalPath,
					roles: [...closure.roles.get(path)],
				};
			const childPath = relative(virtualRoot, path).split("\\").join("/");
			const childContext = {
				...context,
				logicalPath: childPath,
				model: {
					source: basis.source,
					fixedRevision: basis.fixedRevision,
					documentId: childPath,
					extractionId: "whole-file",
				},
			};
			const childContextFile = join(scratch, `reference-context-${index}.json`);
			writeFileSync(
				childContextFile,
				`${JSON.stringify(childContext, null, 2)}\n`,
			);
			return {
				file: path,
				contextFile: childContextFile,
				logicalPath: childPath,
				roles: [...closure.roles.get(path)],
			};
		});
		return {
			file,
			companionFile,
			context,
			contextFile,
			documents,
			key: digest(roadmapSourceIdentity(context)),
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
