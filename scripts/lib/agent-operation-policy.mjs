import { classifyAgentOperations } from "./agent-operation-classifier.mjs";
import { combineDecisions, decideOperation } from "./agent-operation-table.mjs";

/** The entry and its replay corpus share this pure composition boundary. */
export function evaluateAgentOperationPolicy(payload, facts) {
	const classified = classifyAgentOperations(payload, facts);
	return combineDecisions(
		classified.operations.map((operation) =>
			decideOperation({ ...classified, ...operation }),
		),
	);
}
