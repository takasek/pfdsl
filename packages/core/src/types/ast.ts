import type { Position } from "./token.js";

export interface IdNode {
	type: "id";
	value: string;
	raw: string;
	start: Position;
	end: Position;
}

export interface ArtifactExpr {
	type: "artifact-expr";
	ids: IdNode[];
	start: Position;
	end: Position;
}

export interface ChainSegment {
	op: ">>" | ">>?";
	process: IdNode;
	output: ArtifactExpr;
}

export interface ChainStatement {
	type: "chain";
	head: ArtifactExpr;
	segments: ChainSegment[];
	start: Position;
	end: Position;
}

export interface InputEdgeStatement {
	type: "input-edge";
	artifact: ArtifactExpr;
	process: IdNode;
	start: Position;
	end: Position;
}

export interface FeedbackEdgeStatement {
	type: "feedback-edge";
	artifact: ArtifactExpr;
	process: IdNode;
	start: Position;
	end: Position;
}

export interface OutputEdgeStatement {
	type: "output-edge";
	process: IdNode;
	artifact: ArtifactExpr;
	start: Position;
	end: Position;
}

export interface NodeDeclStatement {
	type: "node-decl";
	id: IdNode;
	start: Position;
	end: Position;
}

export type Statement =
	| ChainStatement
	| InputEdgeStatement
	| FeedbackEdgeStatement
	| OutputEdgeStatement
	| NodeDeclStatement;

export interface Document {
	type: "document";
	statements: Statement[];
}
