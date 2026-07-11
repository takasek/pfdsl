import type { NormalizedEdge } from "./types/index.js";

export interface EdgeGroups {
	/** input edges only, process -> artifact ids */
	processInputs: Map<string, string[]>;
	/** output edges only, process -> artifact ids */
	processOutputs: Map<string, string[]>;
	/** feedback edges only, process -> artifact ids */
	processFeedback: Map<string, string[]>;
	/** input edges only, artifact -> process ids (reverse of processInputs) */
	artifactConsumers: Map<string, string[]>;
	/** output edges only, artifact -> process ids (reverse of processOutputs) */
	artifactProducers: Map<string, string[]>;
}

function pushTo(map: Map<string, string[]>, key: string, value: string): void {
	const arr = map.get(key);
	if (arr) {
		arr.push(value);
	} else {
		map.set(key, [value]);
	}
}

/**
 * Group normalized edges by process/artifact and edge kind. Consolidates a
 * grouping pattern that used to be reimplemented independently at each call
 * site (validator V002/V003, validator W003, cli computeReadyIdsCore, cli
 * runReady --best, audit normalConsumers) with subtly different feedback
 * handling and value shapes (issue #432).
 */
export function groupEdges(edges: NormalizedEdge[]): EdgeGroups {
	const processInputs = new Map<string, string[]>();
	const processOutputs = new Map<string, string[]>();
	const processFeedback = new Map<string, string[]>();
	const artifactConsumers = new Map<string, string[]>();
	const artifactProducers = new Map<string, string[]>();

	for (const e of edges) {
		if (e.kind === "input") {
			pushTo(processInputs, e.process, e.artifact);
			pushTo(artifactConsumers, e.artifact, e.process);
		} else if (e.kind === "output") {
			pushTo(processOutputs, e.process, e.artifact);
			pushTo(artifactProducers, e.artifact, e.process);
		} else {
			pushTo(processFeedback, e.process, e.artifact);
		}
	}

	return {
		processInputs,
		processOutputs,
		processFeedback,
		artifactConsumers,
		artifactProducers,
	};
}
