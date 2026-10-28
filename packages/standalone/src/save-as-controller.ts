import { type DocumentRecords, documentName } from "./document-records.js";
import type {
	DiskSnapshot,
	OperationPlan,
	SaveResult,
} from "./document-session.js";

export interface DocumentFiles {
	chooseSaveTarget(name: string): Promise<DiskSnapshot | null>;
	save(request: {
		id: number;
		source: string;
		expected: string | null;
	}): Promise<SaveResult>;
	release(id: number): Promise<void>;
}
export interface SaveDecisions {
	replace(
		request: {
			readonly kind: "replace";
			readonly document: string;
			readonly target: Readonly<DiskSnapshot>;
			readonly editor: string;
			readonly editorVersion: number | string;
		},
		signal: AbortSignal,
	): Promise<"replace" | "another" | "cancel">;
}
export interface SaveAsResult {
	kind: "cancelled" | "saved" | "blocked" | "unresolved" | "stale";
	document: string;
	message?: string;
	editorVersion?: number | string;
	cleanupErrors?: readonly string[];
}

/** Save As decisions depend only on the current document, native files and explicit choices. */
export function createSaveAsController({
	documents,
	files,
	decisions,
}: {
	documents: DocumentRecords;
	files: DocumentFiles;
	decisions: SaveDecisions;
}) {
	return {
		async saveAs(
			key: string,
			{
				signal,
				confirmation,
			}: { signal: AbortSignal; confirmation?: OperationPlan },
		): Promise<SaveAsResult> {
			const record = documents.get(key);
			const cancelled = (): SaveAsResult => ({
				kind: "cancelled",
				document: key,
			});
			if (!record || signal.aborted) return cancelled();
			const { session } = record;
			const current = () => !signal.aborted && documents.get(key) === record;
			const retained: (() => void)[] = [];
			const perform = async (): Promise<SaveAsResult> => {
				while (current()) {
					let target: DiskSnapshot | null;
					try {
						const name = documentName(record);
						target = await files.chooseSaveTarget(
							name.endsWith(".pfdsl") ? name : `${name}.pfdsl`,
						);
					} catch (error) {
						if (!current()) return cancelled();
						return {
							kind: "blocked",
							document: key,
							message: `Could not select the save target: ${String(error)}. The save was not attempted. Editor content is retained; try Save As again.`,
						};
					}
					if (!target) return cancelled();
					retained.push(documents.retain(target.id));
					if (!current()) return cancelled();
					const selected = { ...target };
					const other = documents.otherTarget(key, selected);
					if (other)
						return {
							kind: "blocked",
							document: key,
							message: `The target is already open as ${documentName(other)}. Both editor buffers are retained. Choose another file or close that tab explicitly.`,
						};
					if (confirmation && !session.holds(confirmation, "editor"))
						return {
							kind: "stale",
							document: key,
							message:
								"The document changed after the decision was asked. Editor content is retained; close it again.",
						};
					const plan = session.plan("save", selected);
					// A chosen target has no acknowledged content. Missing chosen targets need no recreate confirmation.
					const review =
						selected.source !== null && selected.source !== plan.editor;
					if (review) {
						const decision = await decisions.replace(
							{
								kind: "replace",
								document: key,
								target: Object.freeze({ ...selected }),
								editor: plan.editor,
								editorVersion: plan.editorVersion,
							},
							signal,
						);
						if (!current()) return cancelled();
						if (decision === "another") continue;
						if (decision !== "replace") return cancelled();
					}
					const outcome = await session.save(plan, (request) =>
						files.save({
							id: request.target!.id,
							source: request.editor,
							expected: request.revision,
						}),
					);
					if (!current()) return cancelled();
					if (outcome.stale)
						return {
							kind: "stale",
							document: key,
							message:
								"The document changed while the review was open. Editor content is retained; review it again.",
						};
					return {
						kind: outcome.saved ? "saved" : "unresolved",
						document: key,
						message:
							outcome.message ||
							(outcome.saved
								? "Saved."
								: "The save was not accepted. Editor content is retained."),
						editorVersion: plan.editorVersion,
					};
				}
				return cancelled();
			};
			const outcome = await perform().then(
				(value) => ({ ok: true as const, value }),
				(error) => ({ ok: false as const, error }),
			);
			for (const relinquish of retained) relinquish();
			const cleanupErrors: string[] = [];
			try {
				await documents.releaseUnused(files.release);
			} catch (error) {
				cleanupErrors.push(
					`Could not release unused file access: ${String(error)}`,
				);
			}
			if (!outcome.ok) {
				if (cleanupErrors.length)
					throw new AggregateError(
						[outcome.error, ...cleanupErrors],
						"Save As failed; unused file access also could not be released.",
						{ cause: outcome.error },
					);
				throw outcome.error;
			}
			return {
				...outcome.value,
				...(cleanupErrors.length ? { cleanupErrors } : {}),
			};
		},
	};
}
