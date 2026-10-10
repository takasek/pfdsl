import { formatEdges, sortEdges } from "@pfdsl/core";
import type { DocumentModel } from "./document.js";

/** Edge-only inspection output; null blocks errors, while an empty string succeeds. */
export function computeNormalizedEdgesOutput(
	model: Pick<DocumentModel, "edges" | "graph" | "diagnostics">,
): string | null {
	if (model.diagnostics.some((d) => d.severity === "error")) return null;
	return formatEdges(sortEdges(model.edges, model.graph));
}
