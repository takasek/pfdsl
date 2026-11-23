import { createHash, randomUUID } from "node:crypto";
import * as nodeFs from "node:fs";
import { dirname, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { micromark } from "micromark";
import { html, parse, parseFragment } from "parse5";
import { isGitHubUnavailableError } from "./github-ops.mjs";

const lf = (text) => text.replaceAll("\r\n", "\n");
const sha256 = (text) =>
	createHash("sha256").update(text, "utf8").digest("hex");
export const modelHash = (text) => sha256(lf(text));
const uuidPattern =
	"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const markerPattern = new RegExp(
	`^<!-- pfdsl:issue-pfd source id=(${uuidPattern}) op=(${uuidPattern}) base=(0|[1-9]\\d*) -->\\n`,
	"i",
);

function marker(body) {
	const match = lf(body).match(markerPattern);
	return match
		? { sourceId: match[1], op: match[2], base: Number(match[3]) }
		: null;
}

function renderedFenceLines(text) {
	// Mark compiler-created code elements with their source line. The unique
	// attribute distinguishes them from code elements authored as raw HTML.
	const attribute = `data-pfdsl-fence-${randomUUID()}`;
	const markup = micromark(text, {
		// This HTML is parsed locally and never displayed or executed.
		allowDangerousHtml: true,
		htmlExtensions: [
			{
				exit: {
					codeFencedFenceInfo(token) {
						this.resume();
						this.tag(` ${attribute}="${token.start.line}"`);
					},
				},
			},
		],
	});
	const lines = new Set();
	for (const node of htmlDescendants(parseFragment(markup))) {
		if (node.tagName !== "code" || node.parentNode.tagName !== "pre") continue;
		const source = node.attrs.find(({ name }) => name === attribute);
		if (source) lines.add(Number(source.value));
	}
	return lines;
}

/** Extract Markdown only; the existing CLI owns all PFD semantics. */
export function parseSource(body) {
	const text = lf(body);
	const identity = marker(text);
	if (!identity)
		throw new Error(
			"Missing or invalid issue-pfd source marker on the first line",
		);
	const candidates = fromMarkdown(text).children.filter(
		(node) =>
			node.type === "code" && node.lang === "pfdsl" && node.meta === null,
	);
	// Raw HTML can span multiple Markdown blocks in the compiled document.
	const lines = candidates.length ? renderedFenceLines(text) : new Set();
	const blocks = candidates.filter((node) =>
		lines.has(node.position.start.line),
	);
	if (blocks.length !== 1)
		throw new Error("Source must contain exactly one closed pfdsl fence");
	const { start: opening, end: closing } = blocks[0].position;
	const openEnd = text.indexOf("\n", opening.offset);
	const start = openEnd + 1;
	const end = text.lastIndexOf("\n", closing.offset - 1) + 1;
	// CommonMark also accepts an unclosed fence. Check the two delimiter lines
	// at the parser's offsets, then keep the source bytes the AST value would trim.
	const openFence = /^(`{3,}|~{3,})[ \t]*pfdsl[ \t]*$/.exec(
		text.slice(opening.offset, openEnd),
	)?.[1];
	const closeFence = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(
		text.slice(end, closing.offset),
	)?.[1];
	if (
		openEnd < 0 ||
		end < start ||
		!openFence ||
		!closeFence ||
		openFence[0] !== closeFence[0] ||
		closeFence.length < openFence.length
	)
		throw new Error("Source must contain exactly one closed pfdsl fence");
	return {
		...identity,
		prefix: text.slice(0, start),
		model: text.slice(start, end),
		suffix: text.slice(end),
	};
}

const SOURCE_SELECTION_ERROR = "ISSUE_PFD_SOURCE_SELECTION";

class SourceSelectionError extends Error {
	code = SOURCE_SELECTION_ERROR;
}

function sourceBody(prefix, model, suffix) {
	const unchanged = prefix + model + suffix;
	try {
		if (parseSource(unchanged).model === model) return unchanged;
	} catch {
		/* Lengthen the wrapper when the edited model closes it. */
	}
	const runs = [...model.matchAll(/^ {0,3}(`{3,})[ \t]*$/gm)].map(
		(match) => match[1].length,
	);
	const fence = "`".repeat(Math.max(3, ...runs.map((length) => length + 1)));
	return (
		prefix.replace(/(`{3,}|~{3,})([ \t]*pfdsl[ \t]*)\n$/, `${fence}$2\n`) +
		model +
		suffix.replace(/^( {0,3})(`{3,}|~{3,})/, `$1${fence}`)
	);
}

const escapeHtml = (text) =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
function htmlElement(parent, tagName) {
	return parent?.childNodes.find((node) => node.tagName === tagName);
}

function* htmlDescendants(parent) {
	const pending = [...(parent?.childNodes ?? [])];
	while (pending.length) {
		const node = pending.pop();
		if (!node.tagName) continue;
		yield node;
		// Template contents are a separate document fragment, outside childNodes.
		for (const child of node.childNodes) pending.push(child);
	}
}

function diagramDocument(body) {
	return typeof body === "string"
		? htmlElement(parse(body, { sourceCodeLocationInfo: true }), "html")
		: null;
}

function svgFromDocument(document, body) {
	let svg = null;
	for (const node of htmlDescendants(htmlElement(document, "body"))) {
		if (node.tagName === "svg" && node.namespaceURI === html.NS.SVG) {
			if (svg !== null) return null;
			const { startTag, endTag } = node.sourceCodeLocation;
			svg = body.slice(startTag.startOffset, (endTag ?? startTag).endOffset);
			if (!endTag) {
				// If the parser uses this closing tag, the opening tag was not self-closing.
				const fragment = parseFragment(`${svg}</svg>`, {
					sourceCodeLocationInfo: true,
				});
				if (htmlElement(fragment, "svg").sourceCodeLocation.endTag) return null;
			}
		}
	}
	return svg;
}

export function svgElement(body) {
	return svgFromDocument(diagramDocument(body), body);
}

export function diagramBody(stamp, output, sourceUrl = "") {
	const json = escapeHtml(JSON.stringify(stamp));
	return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="pfdsl-issue-pfd" content="${json}"><title>Issue PFD</title></head><body>\n<h1>Issue PFD: ${stamp.result}</h1><p>Generated from source v${stamp.sourceVersion}: <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a></p><pre>${escapeHtml(JSON.stringify(stamp, null, 2))}</pre>\n${stamp.result === "rendered" ? output : `<h2>PFD generation ${stamp.result}</h2><pre>${escapeHtml(output)}</pre>`}\n</body></html>\n`;
}

function stampFromDocument(document) {
	const head = htmlElement(document, "head");
	const meta = head?.childNodes.find(
		(node) =>
			node.tagName === "meta" &&
			node.attrs.some(
				({ name, value }) => name === "name" && value === "pfdsl-issue-pfd",
			),
	);
	const content = meta?.attrs.find(({ name }) => name === "content")?.value;
	if (content === undefined) return null;
	try {
		const value = JSON.parse(content);
		if (
			value.schema !== 2 ||
			typeof value.sourceId !== "string" ||
			!Number.isSafeInteger(value.sourceArtifact) ||
			!Number.isSafeInteger(value.sourceVersion) ||
			typeof value.sourceBodySha256 !== "string" ||
			!["rendered", "failed", "invalid-source"].includes(value.result) ||
			typeof value.cliVersion !== "string" ||
			typeof value.generatedAt !== "string"
		)
			return null;
		if (
			value.result !== "invalid-source" &&
			typeof value.modelSha256 !== "string"
		)
			return null;
		if (value.result === "rendered" && typeof value.svgSha256 !== "string")
			return null;
		return value;
	} catch {
		return null;
	}
}

export function readStamp(body) {
	return stampFromDocument(diagramDocument(body));
}

function readDiagram(body) {
	const document = diagramDocument(body);
	const stamp = stampFromDocument(document);
	const svg =
		stamp?.result === "rendered" ? svgFromDocument(document, body) : null;
	return {
		stamp,
		hasMatchingSvg: svg !== null && sha256(svg) === stamp.svgSha256,
	};
}

export function referenceContext({ state, version, dir, model }) {
	const local = version === undefined;
	return {
		adapter: "pfdsl:issue-artifact-v1",
		model: {
			source: local ? `local:${resolve(dir)}` : sourceUrl(state),
			fixedRevision: local ? sha256(model) : String(version),
			documentId: local ? "model.pfdsl" : String(state.artifact),
			extractionId: "pfdsl-fence",
		},
		logicalPath: "issue-pfd.pfdsl",
		targets: [],
	};
}
const sourceUrl = (state) =>
	`https://${state.host}/${state.owner}/${state.repo}/issues/${state.issue}/artifacts/${state.artifact}`;
function selectedVersion(record, version) {
	const versions = [...record.versions].sort((a, b) => b.version - a.version);
	const result =
		version === undefined
			? versions[0]
			: versions.find((v) => v.version === version);
	if (!result) throw new Error(`Artifact version not found: ${version}`);
	return result;
}
function setBase(state, version) {
	const body = lf(version.body);
	const parsed = parseSource(body);
	if (parsed.sourceId !== state.sourceId)
		throw new Error("Source identity changed");
	Object.assign(state, {
		base: {
			version: version.version,
			body,
			sourceBodySha256: modelHash(body),
			modelSha256: modelHash(parsed.model),
		},
		prefix: parsed.prefix,
		suffix: parsed.suffix,
	});
}
/** GitHub and CLI are injected. Directory state is the only local authority. */
export function createIssuePfd({
	github,
	fs = nodeFs,
	repository,
	cli,
	root = process.cwd(),
	uuid = randomUUID,
	now = () => new Date().toISOString(),
}) {
	const {
		existsSync,
		mkdirSync,
		readdirSync,
		readFileSync,
		renameSync,
		rmSync,
		writeFileSync,
		statSync,
		lstatSync,
		chmodSync,
		linkSync,
	} = fs;
	function readModel(path) {
		const bytes = readFileSync(path);
		try {
			// Preserve an existing BOM; decoding must not alter valid input bytes.
			return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
				bytes,
			);
		} catch (cause) {
			throw new Error(`Invalid UTF-8 in local PFD: ${path}`, { cause });
		}
	}
	function requireRegularOutput(path) {
		let stat;
		try {
			stat = lstatSync(path);
		} catch (error) {
			if (error.code === "ENOENT") return;
			throw error;
		}
		if (!stat.isFile())
			throw new Error(`Output must be a regular file: ${path}`);
	}
	function ensureEmpty(dir, locked = false) {
		if (
			existsSync(dir) &&
			readdirSync(dir).some((name) => !locked || name !== ".issue-pfd.lock")
		)
			throw new Error(`pull/create requires an empty directory: ${dir}`);
	}
	function saveFile(path, body, exclusive = false) {
		const temp = resolve(dirname(path), `.issue-pfd-${uuid()}.tmp`);
		const mode =
			!exclusive && existsSync(path) ? statSync(path).mode & 0o7777 : 0o600;
		let created = false;
		try {
			writeFileSync(temp, body, { flag: "wx", mode: 0o600 });
			created = true;
			if (mode !== 0o600) chmodSync(temp, mode);
			if (exclusive) linkSync(temp, path);
			else renameSync(temp, path);
		} finally {
			if (created) rmSync(temp, { force: true });
		}
	}
	function saveState(dir, state, exclusive = false) {
		saveFile(
			resolve(dir, "issue-pfd.json"),
			`${JSON.stringify(state, null, 2)}\n`,
			exclusive,
		);
	}
	function readState(dir) {
		const state = JSON.parse(
			readFileSync(resolve(dir, "issue-pfd.json"), "utf8"),
		);
		if (state.schema !== 2)
			throw new Error(
				"Unsupported issue-pfd state schema; preserve local edits and pull into a new directory",
			);
		return state;
	}
	async function withLock(dir, command, action) {
		const path = resolve(dir, ".issue-pfd.lock");
		try {
			writeFileSync(
				path,
				JSON.stringify({
					pid: process.pid,
					command,
					startedAt: new Date().toISOString(),
				}),
				{ flag: "wx" },
			);
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			throw new Error(
				`Directory lock is held: ${path}; owner: ${readFileSync(path, "utf8")}`,
			);
		}
		try {
			return await action();
		} finally {
			rmSync(path);
		}
	}

	const get = (issue, artifact) => github.getArtifact({ issue, artifact });
	function assertRepository(state) {
		const actual = repository();
		if (["host", "owner", "repo"].some((key) => state[key] !== actual[key]))
			throw new Error("Repository mismatch; refusing to write");
	}
	function persist(dir, state, baseChanged = false, exclusive = false) {
		assertRepository(state);
		saveState(dir, state, exclusive);
		if (baseChanged && state.base)
			saveFile(resolve(dir, "base.pfdsl"), parseSource(state.base.body).model);
	}
	function sourceIdentity(record) {
		for (const version of [...record.versions].sort(
			(a, b) => b.version - a.version,
		)) {
			const found = marker(version.body);
			if (found) return found.sourceId;
		}
		return null;
	}
	async function sources(issue) {
		const found = [];
		for (const item of await github.listArtifacts({ issue })) {
			if (item.type !== "generic") continue;
			const record = await get(issue, item.number);
			if (sourceIdentity(record)) found.push(record);
		}
		return found;
	}
	async function selectSource(opts) {
		let record;
		if (opts.artifact !== undefined)
			record = await get(opts.issue, opts.artifact);
		else {
			const found = await sources(opts.issue);
			if (found.length !== 1)
				throw new SourceSelectionError(
					`Found ${found.length} source artifacts (${found.map((x) => x.artifact.number).join(", ")}); select --artifact`,
				);
			[record] = found;
		}
		const sourceId = sourceIdentity(record);
		if (!sourceId)
			throw new SourceSelectionError(
				"No PFD source identity in artifact history; select --artifact with an existing PFD source",
			);
		return { record, version: selectedVersion(record, opts.version), sourceId };
	}
	async function diagrams(issue, sourceId, sourceArtifact) {
		const found = [];
		for (const item of await github.listArtifacts({ issue })) {
			if (item.type !== "embedded_html") continue;
			const record = await get(issue, item.number);
			const parsed = readDiagram(selectedVersion(record).body);
			const { stamp } = parsed;
			if (
				stamp?.sourceId === sourceId &&
				stamp.sourceArtifact === sourceArtifact
			)
				found.push({ record, ...parsed });
		}
		return found;
	}
	async function selectDiagram(state, diagram) {
		if (diagram !== undefined) {
			const record = await get(state.issue, diagram);
			const parsed = readDiagram(selectedVersion(record).body);
			const { stamp } = parsed;
			if (
				record.artifact.type !== "embedded_html" ||
				stamp?.sourceId !== state.sourceId ||
				stamp.sourceArtifact !== state.artifact
			)
				throw new Error(`Diagram ${diagram} does not match this source`);
			return { record, ...parsed };
		}
		const found = await diagrams(state.issue, state.sourceId, state.artifact);
		if (found.length > 1)
			throw new Error(
				`Multiple diagrams (${found.map((x) => x.record.artifact.number).join(", ")}); select --diagram`,
			);
		return found[0];
	}
	const diagnostic = (result) =>
		[result.stderr, result.stdout].filter(Boolean).join("\n");
	async function checkLocal(model, dir, state) {
		const result = await cli({
			command: "check",
			model,
			context: referenceContext({ dir, model, state }),
		});
		if (result.exitCode !== 0) throw new Error(diagnostic(result));
	}
	function newState(issue, sourceId, artifact = null) {
		return {
			schema: 2,
			...repository(),
			issue,
			artifact,
			sourceId,
			diagram: null,
			base: null,
			prefix: "",
			suffix: "",
			operations: [],
		};
	}
	function overwriteMessage(state, op) {
		return `Publication overwrote another writer's v${op.overwrittenVersion}. show ${state.issue} --artifact ${state.artifact} --version ${op.overwrittenVersion} --out <overwritten.md> retrieves its raw body even if malformed. pull ${state.issue} --artifact ${state.artifact} --dir <new-empty-directory>; run diff <old-directory>/base.pfdsl <old-directory>/model.pfdsl and apply your edits and the recovered raw body to the new directory before publishing.`;
	}
	function compactOperation(op) {
		if (
			op.body === undefined ||
			!Number.isSafeInteger(op.artifact) ||
			!Number.isSafeInteger(op.version) ||
			!["applied", "superseded", "overwrote"].includes(op.status)
		)
			return false;
		let changed = false;
		if (op.bodySha256 === undefined) {
			op.bodySha256 = sha256(op.body);
			changed = true;
		}
		if (op.stage === "diagram" || op.status === "applied") {
			delete op.body;
			changed = true;
		}
		return changed;
	}
	async function reconcile(dir, state, diagram) {
		let changed = false;
		let baseChanged = false;
		const update = (object, key, value) => {
			if (object[key] !== value) {
				object[key] = value;
				changed = true;
			}
		};
		const reports = [];
		for (const op of state.operations) {
			if (
				["applied", "superseded", "overwrote", "failed"].includes(op.status)
			) {
				changed = compactOperation(op) || changed;
				continue;
			}
			try {
				if (op.stage === "diagram") {
					const target = readStamp(op.body);
					let found;
					if (op.artifact !== undefined) {
						const record = await get(state.issue, op.artifact);
						const parsed = readDiagram(selectedVersion(record).body);
						const { stamp } = parsed;
						found =
							stamp?.sourceId === state.sourceId &&
							stamp.sourceArtifact === state.artifact
								? [{ record, ...parsed }]
								: [];
					} else {
						found =
							diagram === undefined
								? await diagrams(state.issue, state.sourceId, state.artifact)
								: [await selectDiagram(state, diagram)];
						if (found.length > 1)
							throw new Error(
								"Multiple diagram candidates; select --diagram to identify the POST destination",
							);
					}
					const match = found
						.filter(
							(x) =>
								target &&
								((x.stamp.sourceVersion === target.sourceVersion &&
									x.stamp.sourceBodySha256 === target.sourceBodySha256 &&
									x.stamp.modelSha256 === target.modelSha256 &&
									x.stamp.result === target.result &&
									(target.result !== "rendered" || x.hasMatchingSvg)) ||
									x.stamp.sourceVersion > target.sourceVersion),
						)
						.sort((a, b) => b.stamp.sourceVersion - a.stamp.sourceVersion)[0];
					if (match) {
						update(
							op,
							"status",
							match.stamp.sourceVersion > target.sourceVersion
								? "superseded"
								: "applied",
						);
						update(op, "artifact", match.record.artifact.number);
						update(op, "version", selectedVersion(match.record).version);
						if (op.status === "applied") update(state, "diagram", op.artifact);
						update(
							op,
							"observedBodySha256",
							sha256(selectedVersion(match.record).body),
						);
					} else update(op, "status", "unknown");
				} else {
					let record;
					if (op.artifact !== undefined || state.artifact !== null)
						record = await get(state.issue, op.artifact ?? state.artifact);
					else {
						const found = (await sources(state.issue)).filter(
							(x) => sourceIdentity(x) === state.sourceId,
						);
						if (found.length > 1)
							throw new Error(
								"Multiple sources match sourceId; inspect artifacts manually",
							);
						[record] = found;
					}
					const versions = record
						? [...record.versions].sort((a, b) => a.version - b.version)
						: [];
					const index = versions.findIndex((v) => marker(v.body)?.op === op.id);
					const version = versions[index];
					const previous =
						index === 0 && op.baseVersion === 0
							? 0
							: versions[index - 1]?.version;
					if (
						!version ||
						lf(version.body) !== op.body ||
						marker(version.body).base !== op.baseVersion ||
						previous === undefined
					)
						update(op, "status", "unknown");
					else {
						update(state, "artifact", record.artifact.number);
						update(op, "artifact", record.artifact.number);
						update(op, "version", version.version);
						if (previous !== op.baseVersion) {
							update(op, "status", "overwrote");
							update(op, "overwrittenVersion", previous);
						} else {
							update(op, "status", "applied");
							if ((state.base?.version ?? 0) <= op.baseVersion) {
								if (op.kind === "restore") update(state, "retired", true);
								setBase(state, { ...version, body: op.body });
								baseChanged = true;
								changed = true;
							}
						}
					}
				}
			} catch (error) {
				update(op, "status", "unknown");
				if (changed) persist(dir, state, baseChanged);
				if (op.stage !== "diagram") throw error;
			}
			changed = compactOperation(op) || changed;
			reports.push({
				id: op.id,
				stage: op.stage,
				status: op.status,
				version: op.version,
				overwrittenVersion: op.overwrittenVersion,
				abandoned: op.abandoned === true,
			});
		}
		if (changed) persist(dir, state, baseChanged);
		return reports;
	}
	function requireResolved(state, reports) {
		const overwritten = reports.find(
			(op) => op.stage === "source" && op.status === "overwrote",
		);
		if (overwritten) throw new Error(overwriteMessage(state, overwritten));
		if (
			state.operations.some(
				(op) =>
					op.stage === "source" &&
					["sent", "unknown"].includes(op.status) &&
					!op.abandoned,
			)
		)
			throw new Error(
				"Operation result unknown; no new publication or automatic resend. Inspect history, rerun status, or resolve --abandon <op>.",
			);
	}
	async function sendSource(dir, state, op, create = false) {
		const initial = create && state.operations.length === 0;
		op.bodySha256 = sha256(op.body);
		if (!create) op.artifact = state.artifact;
		state.operations.push(op);
		persist(dir, state, false, initial);
		let sent = !create;
		try {
			assertRepository(state);
			if (create) {
				const existing = (await sources(state.issue)).filter((record) =>
					record.versions.some(
						(version) => marker(version.body)?.sourceId === state.sourceId,
					),
				);
				if (existing.length)
					throw new Error(
						`SourceId already exists in artifacts ${existing.map((record) => record.artifact.number).join(", ")}; refusing another POST. Preserve this directory and pull into a new empty directory with --artifact.`,
					);
				sent = true;
				state.artifact = (
					await github.createArtifact({
						issue: state.issue,
						type: "generic",
						name: "Issue PFD source",
						body: op.body,
					})
				).number;
			} else
				await github.updateArtifact({
					issue: state.issue,
					artifact: state.artifact,
					body: op.body,
				});
		} catch (error) {
			op.status =
				!sent ||
				error.unsent === true ||
				isGitHubUnavailableError(error) ||
				(error.httpStatus >= 400 && error.httpStatus < 500)
					? "failed"
					: "unknown";
			persist(dir, state);
			throw error;
		}
		const reports = await reconcile(dir, state);
		requireResolved(state, reports);
		return reports;
	}
	async function generate(selected, state) {
		const body = lf(selected.version.body);
		const stamp = {
			schema: 2,
			sourceId: state.sourceId,
			sourceArtifact: state.artifact,
			sourceVersion: selected.version.version,
			sourceBodySha256: modelHash(body),
			result: "invalid-source",
			cliVersion: cli.cliVersion ?? "injected",
			generatedAt: now(),
		};
		let parsed;
		let output;
		try {
			parsed = parseSource(body);
		} catch (error) {
			output = error.message;
		}
		if (parsed) {
			stamp.modelSha256 = modelHash(parsed.model);
			const context = referenceContext({
				state,
				version: selected.version.version,
			});
			const check = await cli({
				command: "check",
				model: parsed.model,
				context,
			});
			const render =
				check.exitCode === 0
					? await cli({ command: "render", model: parsed.model, context })
					: check;
			stamp.cliVersion = render.cliVersion;
			stamp.result = render.exitCode === 0 ? "rendered" : "failed";
			output =
				stamp.result === "rendered"
					? svgElement(render.stdout)
					: diagnostic(render);
			if (stamp.result === "rendered" && output === null) {
				stamp.result = "failed";
				output = "CLI did not produce an SVG element";
			}
			if (stamp.result === "rendered") stamp.svgSha256 = sha256(output);
		}
		return { stamp, body: diagramBody(stamp, output, sourceUrl(state)) };
	}
	async function publishDiagram(opts, selected, state, dir) {
		state ??= {
			...repository(),
			issue: opts.issue,
			artifact: selected.record.artifact.number,
			sourceId: selected.sourceId,
		};
		const generated = await generate(selected, state);
		if (!opts.write) return { dryRun: true, ...generated.stamp };
		assertRepository(state);
		const existing = await selectDiagram(state, opts.diagram);
		if (
			opts.command === "publish" &&
			existing?.stamp.result === "rendered" &&
			[
				"sourceVersion",
				"sourceBodySha256",
				"modelSha256",
				"result",
				"cliVersion",
				"svgSha256",
			].every((key) => existing.stamp[key] === generated.stamp[key]) &&
			existing.hasMatchingSvg
		) {
			if (dir) {
				if (state.diagram !== existing.record.artifact.number) {
					state.diagram = existing.record.artifact.number;
					persist(dir, state);
				}
				await reconcile(dir, state);
			}
			return {
				skipped: "current diagram",
				diagram: existing.record.artifact.number,
			};
		}
		if (
			!existing &&
			state.operations?.some(
				(op) =>
					op.stage === "diagram" &&
					op.kind === "create" &&
					["sent", "unknown"].includes(op.status),
			)
		)
			throw new Error(
				"Diagram create result unknown; will not recreate. Run status and publish-diagram to check for the existing artifact before creating another diagram.",
			);
		if (existing?.stamp.sourceVersion > selected.version.version)
			return {
				skipped: "newer diagram",
				diagram: existing.record.artifact.number,
			};
		let op;
		if (dir) {
			op = {
				id: uuid(),
				kind: existing ? "publish-diagram" : "create",
				stage: "diagram",
				status: "sent",
				baseVersion: selected.version.version,
				body: generated.body,
				bodySha256: sha256(generated.body),
				...(existing ? { artifact: existing.record.artifact.number } : {}),
			};
			state.operations.push(op);
			persist(dir, state);
		}
		let artifact = existing?.record.artifact.number;
		let accepted = false;
		try {
			assertRepository(state);
			if (existing)
				await github.updateArtifact({
					issue: state.issue,
					artifact,
					body: generated.body,
				});
			else
				artifact = (
					await github.createArtifact({
						issue: state.issue,
						type: "embedded_html",
						name: "Issue PFD diagram",
						body: generated.body,
					})
				).number;
			accepted = true;
			if (op) op.artifact = artifact;
			const readbackVersion = selectedVersion(await get(state.issue, artifact));
			const readback = readbackVersion.body;
			const observed = readDiagram(readback);
			if (
				JSON.stringify(observed.stamp) !== JSON.stringify(generated.stamp) ||
				(generated.stamp.result === "rendered" && !observed.hasMatchingSvg)
			)
				throw new Error(
					"Diagram readback mismatch; run status and publish-diagram again",
				);
			if (op) {
				op.version = readbackVersion.version;
				op.observedBodySha256 = sha256(readback);
			}
		} catch (error) {
			if (op) {
				op.status =
					!accepted &&
					(isGitHubUnavailableError(error) ||
						error.unsent === true ||
						(error.httpStatus >= 400 && error.httpStatus < 500))
						? "failed"
						: "unknown";
				persist(dir, state);
			}
			throw error;
		}
		if (dir) {
			if (op) op.status = "applied";
			state.diagram = artifact;
			if (op) compactOperation(op);
			persist(dir, state);
			await reconcile(dir, state);
		}
		return { ...generated.stamp, diagram: artifact };
	}
	async function publish(opts) {
		const state = readState(opts.dir);
		assertRepository(state);

		if (opts.write)
			requireResolved(state, await reconcile(opts.dir, state, opts.diagram));
		else if (
			state.operations.some(
				(op) =>
					op.stage === "source" &&
					["sent", "unknown"].includes(op.status) &&
					!op.abandoned,
			)
		)
			return { dryRun: true, operations: state.operations };
		if (
			state.retired ||
			state.operations.some(
				(op) =>
					op.stage === "source" &&
					op.kind === "restore" &&
					op.status === "applied" &&
					op.artifact === state.artifact &&
					op.version === state.base?.version,
			)
		)
			throw new Error(
				"Working directory retired after restore; preserve local edits and pull into a new empty directory.",
			);
		if (
			opts.command === "restore" &&
			lf(readModel(resolve(opts.dir, "model.pfdsl"))) !==
				parseSource(state.base.body).model
		)
			throw new Error(
				"Save unpublished edits outside this working directory before restore; model.pfdsl must match its base model. Nothing was published.",
			);
		const raw =
			opts.command === "restore"
				? selectedVersion(await get(state.issue, state.artifact), opts.version)
						.body
				: readModel(resolve(opts.dir, "model.pfdsl"));
		const restored = opts.command === "restore" ? parseSource(raw) : null;
		const model = restored ? restored.model : raw;
		if (model && !model.endsWith("\n"))
			throw new Error(
				"model.pfdsl must end with LF to preserve the closing fence",
			);
		await checkLocal(model, opts.dir, state);
		const record = await get(state.issue, state.artifact);
		const current = selectedVersion(record);
		if (
			opts.command !== "restore" &&
			(current.version !== state.base.version ||
				modelHash(current.body) !== state.base.sourceBodySha256)
		)
			throw new Error(
				`Conflict: source changed. show ${state.issue} --artifact ${state.artifact} --version ${current.version} --out <current-source.md> retrieves raw source even if malformed. pull ${state.issue} --artifact ${state.artifact} --dir <new-empty-directory>; run diff <old-directory>/base.pfdsl <old-directory>/model.pfdsl and apply those edits to the new directory before publishing.`,
			);
		const candidate = restored
			? lf(raw)
			: sourceBody(state.prefix, lf(model), state.suffix);
		if (!opts.write)
			return { dryRun: true, sourceBodySha256: modelHash(candidate) };
		if (opts.command === "restore" || candidate !== state.base.body) {
			const baseVersion =
				opts.command === "restore" ? current.version : state.base.version;
			const id = uuid();
			const body = candidate.replace(
				markerPattern,
				`<!-- pfdsl:issue-pfd source id=${state.sourceId} op=${id} base=${baseVersion} -->\n`,
			);
			await sendSource(opts.dir, state, {
				id,
				kind: opts.command,
				stage: "source",
				status: "sent",
				baseVersion,
				body,
			});
		}
		return publishDiagram(
			{
				...opts,
				issue: state.issue,
				diagram: opts.diagram ?? state.diagram ?? undefined,
			},
			{
				record,
				sourceId: state.sourceId,
				version: { version: state.base.version, body: state.base.body },
			},
			state,
			opts.dir,
		);
	}
	async function create(opts) {
		const path = resolve(opts.dir, "issue-pfd.json");
		let state;
		if (existsSync(path)) {
			state = readState(opts.dir);
			assertRepository(state);
			if (state.issue !== opts.issue || state.operations[0]?.kind !== "create")
				throw new Error("Directory is not a create for this issue");
			if (!opts.write) return { dryRun: true, operations: state.operations };
			const reports = await reconcile(opts.dir, state, opts.diagram);
			try {
				requireResolved(state, reports);
			} catch (error) {
				throw new Error(
					`Create result unknown or overwritten; will not recreate. ${error.message}`,
				);
			}
		} else {
			if (!opts.write) return { dryRun: true };
			ensureEmpty(opts.dir, true);
			state = newState(opts.issue, uuid());
			const id = uuid();
			const prefix = `<!-- pfdsl:issue-pfd source id=${state.sourceId} op=${id} base=0 -->\n\n\`\`\`pfdsl\n`;
			const body = sourceBody(prefix, lf(opts.input), "```\n");
			saveFile(resolve(opts.dir, "model.pfdsl"), opts.input, true);
			await sendSource(
				opts.dir,
				state,
				{
					id,
					kind: "create",
					stage: "source",
					status: "sent",
					baseVersion: 0,
					sourceId: state.sourceId,
					body,
				},
				true,
			);
		}
		if (!state.base) {
			const failed = [...state.operations]
				.reverse()
				.find((op) => op.stage === "source" && op.status === "failed");
			if (
				!failed ||
				state.operations.some(
					(op) =>
						op.stage === "source" &&
						op.kind === "create" &&
						op.status !== "failed",
				)
			)
				throw new Error(
					"Create result unknown; will not recreate without a definite rejection",
				);
			const id = uuid();
			const body = failed.body.replace(
				markerPattern,
				`<!-- pfdsl:issue-pfd source id=${state.sourceId} op=${id} base=0 -->\n`,
			);
			await sendSource(
				opts.dir,
				state,
				{
					id,
					kind: "create",
					stage: "source",
					status: "sent",
					baseVersion: 0,
					body,
				},
				true,
			);
		}
		if (state.diagram === null) {
			const recovered = state.operations.findLast(
				(op) =>
					op.stage === "diagram" &&
					op.status === "applied" &&
					op.artifact !== undefined,
			);
			if (recovered) {
				state.diagram = recovered.artifact;
				persist(opts.dir, state);
			}
		}
		if (state.diagram !== null)
			return { artifact: state.artifact, diagram: state.diagram };
		return publishDiagram(
			{ ...opts, issue: state.issue },
			{
				sourceId: state.sourceId,
				version: { version: state.base.version, body: state.base.body },
			},
			state,
			opts.dir,
		);
	}
	async function status(opts) {
		let reports = [];
		if (opts.dir && existsSync(resolve(opts.dir, "issue-pfd.json"))) {
			const state = readState(opts.dir);
			assertRepository(state);
			if (
				state.issue !== opts.issue ||
				(opts.artifact !== undefined && state.artifact !== opts.artifact)
			)
				throw new Error("State target does not match status target");
			try {
				reports = await reconcile(opts.dir, state, opts.diagram);
			} catch (error) {
				if (isGitHubUnavailableError(error)) throw error;
				return { classification: "unavailable", diagnostic: error.message };
			}
			opts = { ...opts, artifact: state.artifact ?? opts.artifact };
		}
		let selected;
		try {
			selected = await selectSource(opts);
		} catch (error) {
			if (
				isGitHubUnavailableError(error) ||
				error.code === SOURCE_SELECTION_ERROR
			)
				throw error;
			return { classification: "unavailable", diagnostic: error.message };
		}
		const state = {
			...repository(),
			issue: opts.issue,
			artifact: selected.record.artifact.number,
			sourceId: selected.sourceId,
		};
		const diagram = await selectDiagram(state, opts.diagram);
		let after;
		try {
			after = selectedVersion(await get(opts.issue, state.artifact));
		} catch (error) {
			if (isGitHubUnavailableError(error)) throw error;
			return { classification: "unavailable", diagnostic: error.message };
		}
		const result = {
			sourceVersion: selected.version.version,
			diagramVersion: diagram?.stamp.sourceVersion,
			diagram: diagram?.record.artifact.number,
			operations: reports,
		};
		if (after.version !== selected.version.version)
			return {
				...result,
				classification: "changed-during-check",
				sourceVersion: after.version,
			};
		let parsed;
		try {
			parsed = parseSource(selected.version.body);
		} catch {
			const lastGood = diagram?.record.versions
				.map((v) => readDiagram(v.body))
				.filter(({ hasMatchingSvg }) => hasMatchingSvg)
				.map(({ stamp }) => stamp)
				.sort((a, b) => b.sourceVersion - a.sourceVersion)[0];
			return {
				...result,
				classification: "invalid-source",
				lastGoodVersion: lastGood?.sourceVersion,
			};
		}
		const stamp = diagram?.stamp;
		let classification;
		if (!stamp) classification = "missing";
		else if (stamp.result === "rendered" && !diagram.hasMatchingSvg)
			classification = "stale";
		else if (
			stamp.sourceVersion === selected.version.version &&
			stamp.sourceBodySha256 === modelHash(selected.version.body) &&
			stamp.modelSha256 === modelHash(parsed.model)
		)
			classification =
				stamp.result === "rendered"
					? "current"
					: stamp.result === "failed"
						? "failed"
						: "stale";
		else if (
			stamp.result === "rendered" &&
			stamp.sourceVersion < selected.version.version &&
			stamp.modelSha256 === modelHash(parsed.model)
		)
			classification = "current-model";
		else classification = "stale";
		return {
			...result,
			classification,
			modelSha256: modelHash(parsed.model),
			sourceBodySha256: modelHash(selected.version.body),
		};
	}
	async function dispatch(opts) {
		switch (opts.command) {
			case "show": {
				const record = await get(opts.issue, opts.artifact);
				const version = selectedVersion(record, opts.version);
				if (opts.out) {
					requireRegularOutput(opts.out);
					const temp = resolve(
						dirname(resolve(opts.out)),
						`.issue-pfd-${uuid()}.tmp`,
					);
					const mode = existsSync(opts.out)
						? statSync(opts.out).mode & 0o7777
						: 0o600;
					try {
						writeFileSync(temp, version.body, { flag: "wx", mode: 0o600 });
						if (mode !== 0o600) chmodSync(temp, mode);
						requireRegularOutput(opts.out);
						renameSync(temp, opts.out);
					} finally {
						rmSync(temp, { force: true });
					}
					return {
						artifact: opts.artifact,
						version: version.version,
						out: opts.out,
					};
				}
				return { output: version.body };
			}
			case "create":
				return create(opts);
			case "publish":
			case "restore":
				return publish(opts);
			case "resolve": {
				const state = readState(opts.dir);
				assertRepository(state);
				const reports = await reconcile(opts.dir, state);
				const op = state.operations.find((op) => op.id === opts.abandon);
				if (!op) throw new Error(`Unknown operation: ${opts.abandon}`);
				if (["sent", "unknown"].includes(op.status)) {
					op.abandoned = true;
					persist(opts.dir, state);
				}
				return { operations: state.operations, reports };
			}
			case "pull": {
				ensureEmpty(opts.dir, true);
				const selected = await selectSource(opts);
				const parsed = parseSource(selected.version.body);
				const state = newState(
					opts.issue,
					parsed.sourceId,
					selected.record.artifact.number,
				);
				setBase(state, selected.version);
				const diagram = await selectDiagram(state, opts.diagram);
				state.diagram = diagram?.record.artifact.number ?? null;
				assertRepository(state);
				saveFile(resolve(opts.dir, "model.pfdsl"), parsed.model, true);
				saveFile(resolve(opts.dir, "base.pfdsl"), parsed.model, true);
				saveState(opts.dir, state, true);
				return {
					artifact: state.artifact,
					sourceVersion: state.base.version,
					modelSha256: state.base.modelSha256,
				};
			}
			case "check":
			case "render": {
				const state = readState(opts.dir);
				const model = readModel(resolve(opts.dir, "model.pfdsl"));
				if (opts.command === "render") requireRegularOutput(opts.out);
				const result = await cli({
					command: opts.command,
					out: opts.out,
					model,
					context: referenceContext({ state, model, dir: opts.dir }),
				});
				if (result.exitCode !== 0) throw new Error(diagnostic(result));
				if (opts.command === "render") {
					requireRegularOutput(opts.out);
					saveFile(opts.out, result.stdout);
					return { out: opts.out };
				}
				return { output: result.stdout };
			}
			case "publish-diagram": {
				let state;
				if (opts.dir && existsSync(resolve(opts.dir, "issue-pfd.json"))) {
					state = readState(opts.dir);
					assertRepository(state);
					if (
						state.issue !== opts.issue ||
						(opts.artifact !== undefined && state.artifact !== opts.artifact)
					)
						throw new Error("State target does not match diagram target");
					if (opts.write)
						requireResolved(
							state,
							await reconcile(opts.dir, state, opts.diagram),
						);
					opts = { ...opts, artifact: state.artifact };
				}
				return publishDiagram(
					opts,
					await selectSource(opts),
					state,
					opts.write && state ? opts.dir : undefined,
				);
			}
			case "status":
				return status(opts);
			default:
				throw new Error(`Unknown command: ${opts.command}`);
		}
	}
	async function run(options) {
		if (options.command !== "show") await cli.preflight?.();
		const opts = { ...options };
		if (
			["status", "publish-diagram"].includes(opts.command) &&
			opts.dir !== undefined &&
			!existsSync(resolve(opts.dir, "issue-pfd.json"))
		)
			throw new Error(
				`State file missing: ${resolve(opts.dir, "issue-pfd.json")}; check --dir`,
			);
		if (
			["status", "publish-diagram"].includes(opts.command) &&
			!opts.dir &&
			existsSync(resolve(process.cwd(), "issue-pfd.json"))
		)
			opts.dir = process.cwd();
		if (
			opts.command === "create" &&
			!existsSync(resolve(opts.dir, "issue-pfd.json"))
		) {
			ensureEmpty(opts.dir);
			const input = readModel(opts.file);
			if (input && !input.endsWith("\n"))
				throw new Error("Source model must end with LF");
			await checkLocal(input, opts.dir);
			opts.input = input;
			if (!opts.write) return { dryRun: true };
		}
		const stateDir =
			opts.dir && existsSync(resolve(opts.dir, "issue-pfd.json"));
		const needsLock =
			opts.write ||
			["pull", "resolve", "render"].includes(opts.command) ||
			(stateDir && opts.command !== "show");
		const execute = async () => {
			if (stateDir && opts.command !== "show") {
				const state = readState(opts.dir);
				assertRepository(state);
				if (state.base) {
					const path = resolve(opts.dir, "base.pfdsl");
					const model = parseSource(state.base.body).model;
					if (!existsSync(path) || readFileSync(path, "utf8") !== model)
						saveFile(path, model);
				}
			}
			const result = await dispatch(opts);
			if (
				opts.dir &&
				!["check", "render"].includes(opts.command) &&
				existsSync(resolve(opts.dir, "issue-pfd.json"))
			) {
				result.operations = readState(opts.dir).operations.map(
					({ id, stage, status, version, overwrittenVersion, abandoned }) => ({
						id,
						stage,
						status,
						version,
						overwrittenVersion,
						abandoned,
					}),
				);
			}
			return result;
		};
		if (!needsLock) return execute();
		const dir =
			["create", "pull", "resolve", "publish", "restore", "render"].includes(
				opts.command,
			) || stateDir
				? opts.dir
				: root;
		if (["create", "pull"].includes(opts.command))
			mkdirSync(dir, { recursive: true });
		return withLock(dir, opts.command, execute);
	}
	return { run };
}
