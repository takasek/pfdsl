// check-skill-wiring.mjs orchestration: analysing the two .pfdsl files,
// consulting gen-plugin's bundle manifest, and turning findings into lines.
// Kept out of the script itself so the report shape and the exit-code branch
// are testable (#645).
//
// `analyzeFile` is injected because @pfdsl/core lives in packages/core/dist,
// which the entrypoint imports dynamically (as gen-samples.mjs does) — the
// tests supply parsed structures directly and need no build.

import { PLUGIN_MIRRORS } from "./gen-plugin.mjs";
import { findUnwiredSkills } from "./skill-wiring-check.mjs";

const WORKFLOW = ".pfdsl/workflow.pfdsl";
const PIPELINE = ".pfdsl/pipeline.pfdsl";

/**
 * @param {{
 *   readFile: (file: string) => string,
 *   analyzeFile: (text: string) => {document: object, frontmatter: {artifact?: object}, edges: Array<object>},
 *   locate: (document: object, source: string, id: string, kind: string) => {declarationLine: number | null},
 *   mirrors?: Array<object>,
 * }} deps readFile is root-bound, so paths are repo-relative. locate is @pfdsl/core's locateNode (#842)
 * @returns {{exitCode: 0|1, stdoutLines: string[], stderrLines: string[]}}
 */
export function runSkillWiringCheck({
	readFile,
	analyzeFile,
	locate,
	mirrors = PLUGIN_MIRRORS,
}) {
	/** What `locate` needs to anchor a finding in the file it was declared in. */
	const readGraph = (path) => {
		const text = readFile(path);
		return { ...analyzeFile(text), text, path };
	};
	const workflow = readGraph(WORKFLOW);
	const pipeline = readGraph(PIPELINE);

	const findings = findUnwiredSkills({
		workflowArtifacts: workflow.frontmatter.artifact ?? {},
		pipelineArtifacts: pipeline.frontmatter.artifact ?? {},
		workflowEdges: workflow.edges,
		pipelineEdges: pipeline.edges,
		mirrors,
	});

	if (findings.length === 0) {
		return {
			exitCode: 0,
			stdoutLines: ["check-skill-wiring: OK"],
			stderrLines: [],
		};
	}

	const stderrLines = findings.map((finding) => {
		const graph = finding.declaredIn === "pipeline" ? pipeline : workflow;
		const line = locate(
			graph.document,
			graph.text,
			finding.id,
			"artifact",
		).declarationLine;
		const anchor = line === null ? graph.path : `${graph.path}:${line}`;
		const location = Array.isArray(finding.location)
			? finding.location.join(", ")
			: finding.location;
		const problems = finding.missing.map((missing) => {
			if (missing === "workflow producer") return "has no workflow producer";
			return "does not reach gen_plugin";
		});
		return `${anchor}: '${finding.id}' is bundled (${location}) but ${problems.join(" and ")}`;
	});
	// Only the edges some finding is actually missing: a pipeline-declared
	// artifact is never eligible for workflow production (#944), so naming that
	// edge for it sends the reader to write one the check goes on rejecting.
	const missingEdges = new Set(findings.flatMap((finding) => finding.missing));
	if (missingEdges.size > 0) {
		stderrLines.push("");
		if (missingEdges.has("workflow producer"))
			stderrLines.push(`Add exactly one output edge for it in ${WORKFLOW}.`);
		if (missingEdges.has("reach gen_plugin"))
			stderrLines.push(
				`Make it reach \`gen_plugin\` through primary input/output edges in ${PIPELINE} (it is bundled material).`,
			);
	}
	return { exitCode: 1, stdoutLines: [], stderrLines };
}
