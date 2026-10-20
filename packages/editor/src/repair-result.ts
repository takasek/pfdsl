import { analyzeSource } from "@pfdsl/core";
import type { PreviewEditRequest } from "./preview-edit.js";

/** Describe the removed connection and diagnostics introduced by this edit. */
export function repairResultMessage(
	request: Extract<PreviewEditRequest, { type: "deleteConnector" }>,
	beforeSource: string,
	afterSource: string,
): string {
	const input = request.kind === "input";
	const removed = `Removed the ${input ? "normal input" : "feedback"} '${request.artifact}' ${input ? ">>" : ">>?"} '${request.process}'.`;
	const key = (d: { code: string; message: string }) =>
		JSON.stringify([d.code, d.message]);
	const before = new Set(analyzeSource(beforeSource).diagnostics.map(key));
	const added = analyzeSource(afterSource)
		.diagnostics.filter((d) => !before.has(key(d)))
		.map((d) => `${d.code}: ${d.message}`);
	return [removed, ...added].join(" ");
}
