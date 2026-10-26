import { analyzeSource } from "@pfdsl/core";
import type { PreviewEditMessage } from "./messages.js";

/** One rename intent per host; Undo cannot revive it by reusing the same ID. */
export class RenameTracking {
	private pending:
		| {
				requestId: string;
				newId: string;
				kind: string | undefined;
				expected: string;
				applied: boolean;
		  }
		| undefined;
	invalidatedRequestId: string | undefined;

	begin(request: PreviewEditMessage, expected: string) {
		this.pending = undefined;
		this.invalidatedRequestId = undefined;
		if (
			request.type === "renameNode" &&
			request.nodeId !== request.newId &&
			request.requestId
		) {
			this.pending = {
				requestId: request.requestId,
				newId: request.newId,
				kind: analyzeSource(expected).nodeKinds.get(request.newId),
				expected,
				applied: false,
			};
		}
	}

	observe(source: string, isUndo = false) {
		const pending = this.pending;
		if (!pending) return;
		if (!pending.applied) {
			pending.applied = source === pending.expected;
			return;
		}
		if (
			isUndo &&
			analyzeSource(source).nodeKinds.get(pending.newId) !== pending.kind
		) {
			this.invalidatedRequestId = pending.requestId;
			this.pending = undefined;
		}
	}
}
