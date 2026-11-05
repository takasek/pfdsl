import { compareDocumentSources, type MessageToWebview } from "@pfdsl/editor";

export interface ComparisonBaseline {
	source: string;
	label: string;
}

/** A baseline belongs to one tab; pending reads cannot survive a newer request or editor revision. */
export function createComparison(
	getSource: () => string,
	getRevision: () => number,
	send: (message: MessageToWebview) => void,
	report: (message: string) => void,
	showLabel: (label: string | null) => void = () => {},
) {
	let generation = 0;
	let disposed = false;
	let baseline: ComparisonBaseline | undefined;
	function refresh() {
		if (disposed || !baseline) return;
		try {
			send({
				type: "diff",
				report: compareDocumentSources(baseline.source, getSource()),
			});
			showLabel(baseline.label);
			report("");
		} catch (error) {
			send({ type: "clearDiff" });
			showLabel(baseline.label);
			report(String(error));
		}
	}
	return {
		async compare(read: () => Promise<ComparisonBaseline | null>) {
			if (disposed) return;
			const request = ++generation;
			const revision = getRevision();
			try {
				const result = await read();
				if (
					disposed ||
					request !== generation ||
					revision !== getRevision() ||
					!result
				)
					return;
				// Validate before replacing a usable comparison.
				const diff = compareDocumentSources(result.source, getSource());
				baseline = result;
				send({ type: "diff", report: diff });
				showLabel(result.label);
				report("");
			} catch (error) {
				if (!disposed && request === generation && revision === getRevision())
					report(String(error));
			}
		},
		refresh,
		cancelPending() {
			generation++;
		},
		clear() {
			generation++;
			baseline = undefined;
			if (!disposed) {
				send({ type: "clearDiff" });
				showLabel(null);
				report("");
			}
		},
		dispose() {
			generation++;
			disposed = true;
			baseline = undefined;
		},
	};
}
