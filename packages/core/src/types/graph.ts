export type NodeKind = "artifact" | "process" | "group";

export interface PrimaryEdge {
	from: string;
	to: string;
	kind: "input" | "output";
}

export interface FeedbackEdge {
	artifact: string;
	process: string;
}

export interface Graph {
	nodes: Map<string, NodeKind>;
	primaryEdges: PrimaryEdge[];
	feedbackEdges: FeedbackEdge[];
}
