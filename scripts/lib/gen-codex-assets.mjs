import { isAlias, isMap, isScalar, parseDocument, visit } from "yaml";

const READ_ONLY_TOOLS = "Read, Grep, Bash";

export function skillMarkdownToCodex(source) {
	const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!header) return source;
	const document = parseDocument(header[1], { merge: true });
	if (document.errors.length) throw document.errors[0];
	if (!document.has("summary")) return source;
	// Materialized strings must remain strings in YAML 1.1 consumers too
	// (e.g. the standard validator treats unquoted yes/no/on as booleans).
	const literalNode = (value) => {
		const node = document.createNode(value);
		visit(node, {
			Scalar(_key, scalar) {
				if (typeof scalar.value === "string") scalar.type = "QUOTE_DOUBLE";
			},
		});
		return node;
	};
	const decoded = document.toJS();
	const summary = decoded.summary;
	const summaryNode = document.get("summary", true);
	if (typeof summary !== "string" || !summary.trim()) {
		throw new Error("Codex skill summary must be a non-empty string.");
	}
	const metadataNode = document.get("metadata", true);
	const metadata = isAlias(metadataNode)
		? metadataNode.resolve(document)
		: (metadataNode ??
			(Object.hasOwn(decoded, "metadata")
				? literalNode(decoded.metadata)
				: undefined));
	if (metadata && !isMap(metadata)) {
		throw new Error("Codex skill metadata must be a mapping.");
	}
	const hasMetadataSummary =
		metadata && Object.hasOwn(decoded.metadata, "summary");
	if (hasMetadataSummary && decoded.metadata.summary !== summary) {
		throw new Error("Codex skill metadata.summary conflicts with summary.");
	}
	// Detach aliases before changing their target so unrelated fields retain
	// their decoded values. Mapping aliases also need a writable metadata node.
	if (isAlias(metadataNode) || (!metadataNode && metadata)) {
		document.set("metadata", literalNode(decoded.metadata));
	}
	if (summaryNode.anchor || (metadata?.anchor && !hasMetadataSummary)) {
		visit(document, {
			Alias(_key, node) {
				if (node.resolve(document) === summaryNode) return literalNode(summary);
				if (!hasMetadataSummary && node.resolve(document) === metadata)
					return literalNode(decoded.metadata);
			},
		});
	}
	if (!hasMetadataSummary) {
		const renderedSummary = isScalar(summaryNode)
			? summaryNode.clone()
			: literalNode(summary);
		delete renderedSummary.anchor;
		document.setIn(["metadata", "summary"], renderedSummary);
		if (!metadata) {
			const pairs = document.contents.items;
			const metadataIndex = pairs.findIndex(
				({ key }) => key.value === "metadata",
			);
			const summaryIndex = pairs.findIndex(
				({ key }) => key.value === "summary",
			);
			pairs.splice(summaryIndex, 0, pairs.splice(metadataIndex, 1)[0]);
		}
	}
	document.delete("summary");
	// Removing an explicit key can expose a merge donor's summary. Only that
	// case needs the effective root mapping materialized to remove the key.
	const rendered = document.toJS();
	if (Object.hasOwn(rendered, "summary")) {
		delete rendered.summary;
		document.contents = literalNode(rendered);
	}
	const newline = header[0].startsWith("---\r\n") ? "\r\n" : "\n";
	const yaml = document.toString().replace(/\n/g, newline);
	return `---${newline}${yaml}---${newline}${source.slice(header[0].length)}`;
}
const WORKSPACE_WRITE_TOOLS = "Bash, Read, Edit, Write, Grep, Glob, Skill";
const MARKDOWN_GENERATED_NOTICE =
	/^<!--(?=[^\r\n]*DO NOT EDIT)(?=[^\r\n]*Authoritative source:)[^\r\n]*-->$|^#{1,6}[ \t]+(?=[^\r\n]*DO NOT EDIT)(?=[^\r\n]*Authoritative source:)[^\r\n]*$/gm;
const JAVASCRIPT_GENERATED_NOTICE =
	/^\/\/(?=[^\r\n]*DO NOT EDIT)(?=[^\r\n]*Authoritative source:)[^\r\n]*$/gm;

function tomlString(value) {
	return JSON.stringify(value);
}

function tomlMultilineString(value) {
	return JSON.stringify(value).slice(1, -1);
}

function generatedNotice(authoritativeSource) {
	return `DO NOT EDIT. Authoritative source: ${authoritativeSource}.`;
}

export function generatedMarkdownNoticeCount(source) {
	return (source.match(MARKDOWN_GENERATED_NOTICE) ?? []).length;
}

export function generatedSourceCommentCount(source) {
	return (source.match(JAVASCRIPT_GENERATED_NOTICE) ?? []).length;
}

export function addGeneratedMarkdownNotice(source, authoritativeSource) {
	const frontmatter =
		source.match(/^---\r?\n(?:[^\r\n]*\r?\n)*?---(?:\r?\n|$)/)?.[0] ?? "";
	const body = source.slice(frontmatter.length);
	// Only the document header declares ownership; body examples do not.
	const header = frontmatter + body.split(/\r?\n/, 1)[0];
	if (generatedMarkdownNoticeCount(header) > 0) {
		return source;
	}
	const notice = `<!-- ${generatedNotice(authoritativeSource)} -->`;
	if (!frontmatter) return `${notice}\n\n${source}`;
	const separator = frontmatter.endsWith("\n") ? "" : "\n";
	return `${frontmatter}${separator}${notice}\n${body}`;
}

export function addGeneratedSourceComment(source, authoritativeSource) {
	const shebang = source.match(/^#![^\r\n]*\r?\n/)?.[0] ?? "";
	const body = source.slice(shebang.length);
	if (generatedSourceCommentCount(body.split(/\r?\n/, 1)[0]) > 0) {
		return source;
	}
	const comment = `// ${generatedNotice(authoritativeSource)}\n`;
	return `${shebang}${comment}${body}`;
}

function capabilitySourcePath(record) {
	return record?.source?.path ?? "<unknown-source>";
}

function semanticRecord(record, kind) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = record?.semantic;
	if (!semantic || Array.isArray(semantic) || typeof semantic !== "object") {
		throw new Error(
			`${sourcePath}: ${kind} semantic record must be an object.`,
		);
	}
	return semantic;
}

function requiredSemanticString(
	record,
	semantic,
	field,
	{ nonEmpty = true } = {},
) {
	const sourcePath = capabilitySourcePath(record);
	const value = semantic[field];
	if (typeof value !== "string" || (nonEmpty && !value.trim())) {
		const qualifier = nonEmpty ? "non-empty string" : "string";
		throw new Error(`${sourcePath}: ${field} must be a ${qualifier}.`);
	}
	return value;
}

function manifestSurfaceFields(mapping, sourcePath) {
	const outputs = Array.isArray(mapping) ? mapping : mapping?.outputs;
	if (!Array.isArray(outputs)) {
		throw new Error(
			`${sourcePath}: codex-plugin manifest mapping outputs must be an array.`,
		);
	}
	if (outputs.some((surface) => typeof surface !== "string")) {
		throw new Error(
			`${sourcePath}: codex-plugin manifest mapping outputs must be strings.`,
		);
	}
	const prefix = "manifest:.codex-plugin/plugin.json:";
	const fields = outputs
		.filter((surface) => surface.startsWith(prefix))
		.map((surface) => surface.slice(prefix.length));
	if (fields.length === 0 || fields.some((field) => !field)) {
		throw new Error(
			`${sourcePath}: codex-plugin manifest fields are required.`,
		);
	}
	return new Set(fields);
}

export function buildCodexPluginManifest({
	metadata,
	record,
	mapping,
	description,
}) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = metadata ?? record?.semantic;
	if (!semantic || Array.isArray(semantic) || typeof semantic !== "object") {
		throw new Error(`${sourcePath}: plugin metadata must be an object.`);
	}
	const identity = semantic.identity;
	if (!identity || Array.isArray(identity) || typeof identity !== "object") {
		throw new Error(
			`${sourcePath}: plugin metadata identity must be an object.`,
		);
	}
	const version = requiredSemanticString(
		record ?? { source: { path: sourcePath }, semantic },
		semantic,
		"version",
	);
	if (typeof description !== "string" || !description.trim()) {
		throw new Error(`${sourcePath}: description must be a non-empty string.`);
	}
	const fields = manifestSurfaceFields(mapping, sourcePath);
	const values = {
		name: identity.name,
		version,
		description,
		author: identity.author,
		homepage: identity.homepage,
		repository: "https://github.com/takasek/pfdsl",
		license: identity.license,
		skills: "./skills/",
		interface: {
			displayName: identity.name,
			shortDescription: description,
			longDescription: description,
			developerName: identity.author?.name,
			category: "Developer Tools",
			capabilities: ["Skills"],
			defaultPrompt: ["Use pfd-ops to operate this project."],
		},
	};
	for (const field of fields) {
		if (!Object.hasOwn(values, field)) {
			throw new Error(
				`${sourcePath}: unsupported Codex manifest field ${field}.`,
			);
		}
	}
	return Object.fromEntries(
		Object.entries(values).filter(([field]) => fields.has(field)),
	);
}

export function commandCapabilityToCodexSkill(record, outputName) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = semanticRecord(record, "command");
	const description = requiredSemanticString(record, semantic, "description");
	const body = requiredSemanticString(record, semantic, "body", {
		nonEmpty: false,
	});
	const name = outputName ?? sourcePath.split("/").pop().replace(/\.md$/, "");
	if (typeof name !== "string" || !name.trim()) {
		throw new Error(`${sourcePath}: output name must be a non-empty string.`);
	}
	return addGeneratedMarkdownNotice(
		`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n${body}`,
		sourcePath,
	);
}

function sandboxMode(sourcePath, tools) {
	if (tools === READ_ONLY_TOOLS) return "read-only";
	if (tools === WORKSPACE_WRITE_TOOLS) return "workspace-write";
	throw new Error(`${sourcePath}: unsupported tools.`);
}

export function buildCodexProjectConfig() {
	return [
		`# ${generatedNotice("scripts/lib/gen-codex-assets.mjs")}`,
		"",
		'sandbox_mode = "workspace-write"',
		'approval_policy = "on-request"',
		"",
		"[sandbox_workspace_write]",
		"network_access = true",
		"",
	].join("\n");
}

export function agentCapabilityToCodexToml(record) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = semanticRecord(record, "agent");
	const name = requiredSemanticString(record, semantic, "name");
	const description = requiredSemanticString(record, semantic, "description");
	if (semantic.model !== "sonnet") {
		throw new Error(`${sourcePath}: unsupported model.`);
	}
	const sandbox = sandboxMode(sourcePath, semantic.tools);
	const body = requiredSemanticString(record, semantic, "body", {
		nonEmpty: false,
	});
	const instructions = tomlMultilineString(body);

	return [
		`# ${generatedNotice(sourcePath)}`,
		`name = ${tomlString(name)}`,
		`description = ${tomlString(description)}`,
		`sandbox_mode = ${tomlString(sandbox)}`,
		`developer_instructions = """${instructions}"""`,
		"",
	].join("\n");
}

export function hookCapabilityToCodexHooks(record) {
	const sourcePath = capabilitySourcePath(record);
	const semantic = semanticRecord(record, "hook");
	if (
		!semantic.hooks ||
		Array.isArray(semantic.hooks) ||
		typeof semantic.hooks !== "object"
	) {
		throw new Error(`${sourcePath}: hooks must be an object.`);
	}
	return `${JSON.stringify({ hooks: semantic.hooks }, null, 2)}\n`;
}
