import { resolve } from "node:path";

/** Explicit opt-in only. Local consumers do not need the source adapter's build. */
export async function acquireConfiguredRoadmap({ root, sourceConfig }) {
	if (sourceConfig === undefined) {
		return { file: resolve(root, ".pfdsl/roadmap.pfdsl"), dispose() {} };
	}
	const { acquireRoadmapSource, readRoadmapSourceConfig } = await import(
		"./roadmap-source.mjs"
	);
	const settings = readRoadmapSourceConfig(sourceConfig);
	return acquireRoadmapSource({
		repositoryRoot: root,
		descriptor: settings.roadmapSource,
		localSources: settings.localSources,
	});
}
