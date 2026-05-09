import type {
	ArtifactExpr,
	ChainSegment,
	Diagnostic,
	Document,
	IdNode,
	NodeDeclStatement,
	Statement,
	Token,
	TokenType,
} from "./types/index.js";

export interface ParseResult {
	document: Document;
	diagnostics: Diagnostic[];
}

export function parseTokens(tokens: Token[]): ParseResult {
	const diagnostics: Diagnostic[] = [];
	let pos = 0;

	function peek(offset = 0): Token {
		const idx = pos + offset;
		return tokens[Math.min(idx, tokens.length - 1)]!;
	}

	function advance(): Token {
		const t = tokens[pos]!;
		if (pos < tokens.length - 1) pos++;
		return t;
	}

	function skipSeparators(): void {
		while (
			peek().type === "NEWLINE" ||
			peek().type === "SEMICOLON" ||
			peek().type === "COMMENT"
		)
			advance();
	}

	// Skip NEWLINE/COMMENT run. blankLine = 2+ consecutive NEWLINEs (COMMENT
	// resets the count, so `NEWLINE COMMENT NEWLINE` is not a blank line).
	function scanContinuation(start: number): {
		next: number;
		blankLine: boolean;
	} {
		let i = start;
		let consecutive = 0;
		let maxConsecutive = 0;
		while (i < tokens.length) {
			const t = tokens[i]?.type;
			if (t === "NEWLINE") {
				consecutive++;
				if (consecutive > maxConsecutive) maxConsecutive = consecutive;
			} else if (t === "COMMENT") {
				consecutive = 0;
			} else {
				break;
			}
			i++;
		}
		return { next: i, blankLine: maxConsecutive > 1 };
	}

	// Consume a NEWLINE/COMMENT run only if the next significant token is one
	// of `ops` AND no blank line sits inside the run. Otherwise pos untouched
	// so the NEWLINE remains a statement terminator.
	function tryContinuation(...ops: TokenType[]): boolean {
		const { next, blankLine } = scanContinuation(pos);
		if (
			next > pos &&
			next < tokens.length &&
			!blankLine &&
			ops.includes(tokens[next]!.type)
		) {
			pos = next;
			return true;
		}
		return false;
	}

	// Lookahead: ID then ARROW_OUTPUT (single NEWLINE / inline COMMENTs allowed)
	function isOutputEdgeStart(): boolean {
		if (peek().type !== "ID") return false;
		const { next, blankLine } = scanContinuation(pos + 1);
		return (
			!blankLine &&
			next < tokens.length &&
			tokens[next]?.type === "ARROW_OUTPUT"
		);
	}

	// Lookahead: ID stands alone (no operator follows, accounting for line continuation)
	function isNodeDeclStart(): boolean {
		if (peek().type !== "ID") return false;
		const afterId = pos + 1;
		if (afterId >= tokens.length) return true;
		const t = tokens[afterId]?.type;
		// Immediately followed by operator → not node-decl
		if (t === "ARROW_INPUT" || t === "ARROW_FEEDBACK" || t === "ARROW_OUTPUT")
			return false;
		// Followed by NEWLINE/COMMENT → check for line continuation
		if (t === "NEWLINE" || t === "COMMENT") {
			const { next, blankLine } = scanContinuation(afterId);
			if (!blankLine && next < tokens.length) {
				const nt = tokens[next]?.type;
				if (
					nt === "ARROW_INPUT" ||
					nt === "ARROW_FEEDBACK" ||
					nt === "ARROW_OUTPUT"
				)
					return false;
			}
		}
		return (
			t === "NEWLINE" || t === "SEMICOLON" || t === "EOF" || t === "COMMENT"
		);
	}

	function parseId(): IdNode | null {
		const t = peek();
		if (t.type !== "ID") return null;
		advance();
		return {
			type: "id",
			value: t.value,
			raw: t.raw,
			start: t.start,
			end: t.end,
		};
	}

	function parseArtifactExpr(): ArtifactExpr | null {
		const t = peek();

		if (t.type === "LBRACKET") {
			const start = t.start;
			advance();
			skipSeparators();
			const ids: IdNode[] = [];
			const first = parseId();
			if (!first) {
				diagnostics.push({
					severity: "error",
					code: "P002",
					message: "Expected identifier in artifact set",
					range: { start: peek().start, end: peek().end },
				});
				while (peek().type !== "RBRACKET" && peek().type !== "EOF") advance();
				const end = peek().end;
				if (peek().type === "RBRACKET") advance();
				return { type: "artifact-expr", ids: [], start, end };
			}
			ids.push(first);
			while (peek().type === "COMMA") {
				advance();
				skipSeparators();
				const id = parseId();
				if (!id) {
					diagnostics.push({
						severity: "error",
						code: "P003",
						message: "Expected identifier after comma in set",
						range: { start: peek().start, end: peek().end },
					});
					break;
				}
				ids.push(id);
			}
			skipSeparators();
			const rb = peek();
			if (rb.type === "RBRACKET") {
				advance();
				return { type: "artifact-expr", ids, start, end: rb.end };
			}
			diagnostics.push({
				severity: "error",
				code: "P011",
				message: "Expected ] to close artifact set",
				range: { start: rb.start, end: rb.end },
			});
			return { type: "artifact-expr", ids, start, end: rb.start };
		}

		const id = parseId();
		if (!id) return null;
		return { type: "artifact-expr", ids: [id], start: id.start, end: id.end };
	}

	function skipToStatementEnd(): void {
		while (
			peek().type !== "NEWLINE" &&
			peek().type !== "SEMICOLON" &&
			peek().type !== "EOF"
		)
			advance();
	}

	function parseStatement(): Statement | null {
		if (isNodeDeclStart()) {
			const id = parseId()!;
			return {
				type: "node-decl",
				id,
				start: id.start,
				end: id.end,
			} satisfies NodeDeclStatement;
		}

		if (isOutputEdgeStart()) {
			const processId = parseId()!;
			tryContinuation("ARROW_OUTPUT");
			advance();
			const artifact = parseArtifactExpr();
			if (!artifact) {
				diagnostics.push({
					severity: "error",
					code: "P004",
					message: "Expected artifact expression after ->",
					range: { start: peek().start, end: peek().end },
				});
				return null;
			}
			return {
				type: "output-edge",
				process: processId,
				artifact,
				start: processId.start,
				end: artifact.end,
			};
		}

		const head = parseArtifactExpr();
		if (!head) {
			diagnostics.push({
				severity: "error",
				code: "P001",
				message: `Unexpected token: ${peek().type} (${peek().raw})`,
				range: { start: peek().start, end: peek().end },
			});
			return null;
		}

		tryContinuation("ARROW_INPUT", "ARROW_FEEDBACK");
		const opToken = peek();
		if (opToken.type !== "ARROW_INPUT" && opToken.type !== "ARROW_FEEDBACK") {
			diagnostics.push({
				severity: "error",
				code: "P005",
				message: `Expected >> or >>? after artifact, got ${opToken.type}`,
				range: { start: opToken.start, end: opToken.end },
			});
			return null;
		}

		const op: ">>" | ">>?" = opToken.type === "ARROW_INPUT" ? ">>" : ">>?";
		advance();

		const processId = parseId();
		if (!processId) {
			diagnostics.push({
				severity: "error",
				code: "P006",
				message: "Expected process identifier",
				range: { start: peek().start, end: peek().end },
			});
			return null;
		}

		tryContinuation("ARROW_OUTPUT");
		if (peek().type !== "ARROW_OUTPUT") {
			if (op === ">>") {
				return {
					type: "input-edge",
					artifact: head,
					process: processId,
					start: head.start,
					end: processId.end,
				};
			} else {
				return {
					type: "feedback-edge",
					artifact: head,
					process: processId,
					start: head.start,
					end: processId.end,
				};
			}
		}

		advance(); // consume ->
		const firstOutput = parseArtifactExpr();
		if (!firstOutput) {
			diagnostics.push({
				severity: "error",
				code: "P007",
				message: "Expected artifact expression after -> in chain",
				range: { start: peek().start, end: peek().end },
			});
			return null;
		}

		const segments: ChainSegment[] = [
			{ op, process: processId, output: firstOutput },
		];

		while (true) {
			tryContinuation("ARROW_INPUT", "ARROW_FEEDBACK");
			if (peek().type !== "ARROW_INPUT" && peek().type !== "ARROW_FEEDBACK")
				break;
			const segOp: ">>" | ">>?" = peek().type === "ARROW_INPUT" ? ">>" : ">>?";
			advance();
			const segProcess = parseId();
			if (!segProcess) {
				diagnostics.push({
					severity: "error",
					code: "P008",
					message: "Expected process identifier in chain continuation",
					range: { start: peek().start, end: peek().end },
				});
				skipToStatementEnd();
				break;
			}
			tryContinuation("ARROW_OUTPUT");
			if (peek().type !== "ARROW_OUTPUT") {
				// Chain ends with bare `>> process` — output defined elsewhere (semantic check)
				segments.push({ op: segOp, process: segProcess, output: null });
				break;
			}
			advance();
			const segOutput = parseArtifactExpr();
			if (!segOutput) {
				diagnostics.push({
					severity: "error",
					code: "P010",
					message: "Expected artifact expression in chain continuation",
					range: { start: peek().start, end: peek().end },
				});
				skipToStatementEnd();
				break;
			}
			segments.push({ op: segOp, process: segProcess, output: segOutput });
		}

		const last = segments[segments.length - 1]!;
		return {
			type: "chain",
			head,
			segments,
			start: head.start,
			end: last.output?.end ?? last.process.end,
		};
	}

	const statements: Statement[] = [];
	skipSeparators();

	while (peek().type !== "EOF") {
		const stmt = parseStatement();
		if (stmt) {
			statements.push(stmt);
		} else {
			skipToStatementEnd();
		}
		skipSeparators();
	}

	return { document: { type: "document", statements }, diagnostics };
}
