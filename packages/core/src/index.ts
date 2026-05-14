import {
	formatAsFlows,
	formatEdges,
	splitBodyIntoSegments,
} from "./formatter.js";
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
	loadFrontmatter,
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
	skipValidation?: boolean;
}

export function format(source: string, opts: FormatOptions = {}): FormatResult {
	const {
		frontmatter,
		body,
		diagnostics: fmDiags,
		bodyStartLine,
	} = loadFrontmatter(source);

	// Parse full body for diagnostics and nodeKinds (needed for per-segment sort)
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
		diagnostics: normDiags,
	} = normalize(document, frontmatter);
	const valDiags = opts.skipValidation
		? []
		: validate(edges, nodeKinds, frontmatter);

	const frontmatterSection = source.slice(0, source.length - body.length);

	// Format segment by segment to preserve comment lines
	const segments = splitBodyIntoSegments(body);
	const formattedBody = segments
		.map((seg) => {
			if (seg.kind === "comment") return seg.text;
			const { tokens: segToks } = lex(seg.text);
			const { document: segDoc } = parseTokens(segToks);
			const { edges: segEdges, isolatedNodes: segIsolated } = normalize(
				segDoc,
				frontmatter,
			);
			const segGraph = buildGraph(segEdges, nodeKinds);
			const segSorted = sortEdges(segEdges, segGraph);
			const segIso = sortIsolated(segIsolated);
			return opts.style === "flows"
				? formatAsFlows(segSorted, segIso)
				: formatEdges(segSorted, segIso);
		})
		.join("");

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
