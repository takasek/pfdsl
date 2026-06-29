import { zeroRange } from "./position.js";
import type {
	ArtifactExpr,
	Diagnostic,
	Document,
	Frontmatter,
	NormalizedEdge,
	Statement,
} from "./types/index.js";

export interface NormalizeResult {
	edges: NormalizedEdge[];
	nodeKinds: Map<string, "artifact" | "process" | "group">;
	isolatedNodes: Set<string>;
	diagnostics: Diagnostic[];
}

function edgeKey(edge: NormalizedEdge): string {
	return edge.kind === "output"
		? `output\0${edge.process}\0${edge.artifact}`
		: `${edge.kind}\0${edge.artifact}\0${edge.process}`;
}

export function normalize(
	doc: Document,
	fm: Frontmatter | null,
): NormalizeResult {
	const diagnostics: Diagnostic[] = [];
	const rawEdges: NormalizedEdge[] = [];
	const seenEdges = new Set<string>();
	const nodeKinds = new Map<string, "artifact" | "process" | "group">();
	const declaredNodes = new Set<string>(); // node-decl で宣言されたID（孤立候補）
	const edgeNodes = new Set<string>(); // edge に参加したID

	// Pre-populate from front matter (takes priority)
	for (const id of Object.keys(fm?.artifact ?? {})) {
		nodeKinds.set(id, "artifact");
	}
	for (const id of Object.keys(fm?.group ?? {})) {
		if (!nodeKinds.has(id)) nodeKinds.set(id, "group");
	}
	for (const id of Object.keys(fm?.process ?? {})) {
		if (nodeKinds.has(id)) {
			diagnostics.push({
				severity: "error",
				code: "N001",
				message: `'${id}' declared as both artifact and process in front matter`,
				range: zeroRange(),
			});
		} else {
			nodeKinds.set(id, "process");
		}
	}

	function inferKind(id: string, kind: "artifact" | "process"): void {
		const existing = nodeKinds.get(id);
		if (existing === undefined) {
			nodeKinds.set(id, kind);
			return;
		}
		if (existing !== kind) {
			diagnostics.push({
				severity: "error",
				code: "N002",
				message: `'${id}' used as both artifact and process`,
				range: zeroRange(),
			});
		}
	}

	function addEdge(edge: NormalizedEdge): void {
		const key = edgeKey(edge);
		if (seenEdges.has(key)) {
			diagnostics.push({
				severity: "warning",
				code: "N003",
				message: "Duplicate edge",
				range: zeroRange(),
			});
			return;
		}
		seenEdges.add(key);
		rawEdges.push(edge);
		if (edge.kind === "output") {
			edgeNodes.add(edge.process);
			edgeNodes.add(edge.artifact);
		} else {
			edgeNodes.add(edge.artifact);
			edgeNodes.add(edge.process);
		}
	}

	function ids(expr: ArtifactExpr): string[] {
		return expr.ids.map((i) => i.value);
	}

	function addEdgesFor(
		kind: NormalizedEdge["kind"],
		artifactIds: readonly string[],
		proc: string,
	): void {
		inferKind(proc, "process");
		for (const a of artifactIds) {
			inferKind(a, "artifact");
			addEdge(
				kind === "output"
					? { kind, process: proc, artifact: a }
					: { kind, artifact: a, process: proc },
			);
		}
	}

	function processStmt(stmt: Statement): void {
		switch (stmt.type) {
			case "chain": {
				let currentArtifacts = ids(stmt.head);
				for (const seg of stmt.segments) {
					const proc = seg.process.value;
					addEdgesFor(
						seg.op === ">>" ? "input" : "feedback",
						currentArtifacts,
						proc,
					);
					if (seg.output !== null) {
						const outArtifacts = ids(seg.output);
						addEdgesFor("output", outArtifacts, proc);
						currentArtifacts = outArtifacts;
					}
				}
				break;
			}
			case "input-edge":
				addEdgesFor("input", ids(stmt.artifact), stmt.process.value);
				break;
			case "feedback-edge":
				addEdgesFor("feedback", ids(stmt.artifact), stmt.process.value);
				break;
			case "output-edge":
				addEdgesFor("output", ids(stmt.artifact), stmt.process.value);
				break;
			case "node-decl": {
				const id = stmt.id.value;
				declaredNodes.add(id);
				// kind: front matter優先、なければArtifact既定（§5.1.3）
				if (!nodeKinds.has(id)) nodeKinds.set(id, "artifact");
				break;
			}
		}
	}

	for (const stmt of doc.statements) processStmt(stmt);

	// 孤立node: node-declで宣言 or front matter定義 かつ edge参加なし
	const isolatedNodes = new Set<string>();
	for (const id of declaredNodes) {
		if (!edgeNodes.has(id)) isolatedNodes.add(id);
	}
	// front matter宣言のみのnodeも孤立扱い（groupは除外 — エッジ参加しない設計）
	for (const [id, kind] of nodeKinds) {
		if (kind !== "group" && !edgeNodes.has(id) && !isolatedNodes.has(id))
			isolatedNodes.add(id);
	}

	return { edges: rawEdges, nodeKinds, isolatedNodes, diagnostics };
}
