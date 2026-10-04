import { Graphviz } from "@hpcc-js/wasm";

type GraphvizInstance = Awaited<ReturnType<typeof Graphviz.load>>;

let graphvizInstance: Promise<GraphvizInstance> | null = null;

function getGraphviz(): Promise<GraphvizInstance> {
	if (!graphvizInstance) {
		graphvizInstance = Graphviz.load();
	}
	return graphvizInstance;
}

export async function renderDotToSvg(dot: string): Promise<string> {
	const gv = await getGraphviz();
	return gv.dot(dot, "svg");
}
