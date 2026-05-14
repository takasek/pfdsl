import { formatAsFlows, formatEdges } from "./formatter.js";
import { loadFrontmatter } from "./frontmatter.js";
import { buildGraph } from "./graph.js";
import { lex } from "./lexer.js";
import { normalize } from "./normalizer.js";
import { parseTokens } from "./parser.js";
import { sortEdges, sortIsolated } from "./sorter.js";
import type {
	Diagnostic,
	Document,
	Frontmatter,
	Graph,
	NodeKind,
	NormalizedEdge,
} from "./types/index.js";
import { validate } from "./validator.js";

export type { LexResult } from "./lexer.js";
export { ID_PATTERN } from "./lexer.js";
export type { NormalizeResult } from "./normalizer.js";
export type { ParseResult } from "./parser.js";
export type {
	ArtifactExpr,
	ArtifactMeta,
	ChainSegment,
	ChainStatement,
	Diagnostic,
	DiagnosticSeverity,
	Document,
	FeedbackEdge,
	FeedbackEdgeStatement,
	Frontmatter,
	Graph,
	GroupMeta,
	IdNode,
	InputEdgeStatement,
	LoadResult,
	NodeDeclStatement,
	NodeKind,
	NodeStyle,
	NormalizedEdge,
	OutputEdgeStatement,
	Position,
	PrimaryEdge,
	ProcessMeta,
	Range,
	Statement,
	Status,
	StyleAttr,
	Token,
	TokenType,
} from "./types/index.js";
export { STATUS_VALUES, STYLE_ATTRS } from "./types/index.js";

export interface ParseDocResult {
	document: Document;
	frontmatter: Frontmatter | null;
	diagnostics: Diagnostic[];
}

export interface FormatResult {
	output: string;
	diagnostics: Diagnostic[];
}

export interface AnalyzeResult {
	document: Document;
	frontmatter: Frontmatter | null;
	edges: NormalizedEdge[];
	nodeKinds: Map<string, NodeKind>;
	isolatedNodes: Set<string>;
	graph: Graph;
	diagnostics: Diagnostic[];
}

export function parse(source: string): ParseDocResult {
	const {
		frontmatter,
		body,
		diagnostics: fmDiags,
		bodyStartLine,
	} = loadFrontmatter(source);
	const { tokens, diagnostics: lexDiags } = lex(body);
	const lineOffset = bodyStartLine - 1;
	if (lineOffset > 0) {
		for (const t of tokens) {
			t.start.line += lineOffset;
			t.end.line += lineOffset;
		}
	}
	const { document, diagnostics: parseDiags } = parseTokens(tokens);
	return {
		document,
		frontmatter,
		diagnostics: [...fmDiags, ...lexDiags, ...parseDiags],
	};
}

export {
	buildGraph,
	formatAsFlows,
	formatEdges,
	normalize as normalizeDocument,
	sortEdges,
	sortIsolated,
	validate as validateGraph,
};

export function hasErrors(diags: readonly Diagnostic[]): boolean {
	return diags.some((d) => d.severity === "error");
}

export function analyze(source: string): AnalyzeResult {
	const { document, frontmatter, diagnostics: parseDiags } = parse(source);
	const {
		edges,
		nodeKinds,
		isolatedNodes,
		diagnostics: normDiags,
	} = normalize(document, frontmatter);
	const valDiags = validate(edges, nodeKinds, frontmatter);
	const graph = buildGraph(edges, nodeKinds);
	return {
		document,
		frontmatter,
		edges,
		nodeKinds,
		isolatedNodes,
		graph,
		diagnostics: [...parseDiags, ...normDiags, ...valDiags],
	};
}

export interface FormatOptions {
	style?: "flat" | "flows";
}

export function format(source: string, opts: FormatOptions = {}): FormatResult {
	const {
		frontmatter,
		body,
		diagnostics: fmDiags,
		bodyStartLine,
	} = loadFrontmatter(source);
	const { tokens, diagnostics: lexDiags } = lex(body);
	const lineOffset = bodyStartLine - 1;
	if (lineOffset > 0) {
		for (const t of tokens) {
			t.start.line += lineOffset;
			t.end.line += lineOffset;
		}
	}
	const { document, diagnostics: parseDiags } = parseTokens(tokens);
	const {
		edges,
		nodeKinds,
		isolatedNodes,
		diagnostics: normDiags,
	} = normalize(document, frontmatter);
	const graph = buildGraph(edges, nodeKinds);
	const valDiags = validate(edges, nodeKinds, frontmatter);
	const sorted = sortEdges(edges, graph);
	const isolated = sortIsolated(isolatedNodes);
	const formattedBody =
		opts.style === "flows"
			? formatAsFlows(sorted, isolated)
			: formatEdges(sorted, isolated);
	const frontmatterSection = source.slice(0, source.length - body.length);
	return {
		output: frontmatterSection + formattedBody,
		diagnostics: [
			...fmDiags,
			...lexDiags,
			...parseDiags,
			...normDiags,
			...valDiags,
		],
	};
}
