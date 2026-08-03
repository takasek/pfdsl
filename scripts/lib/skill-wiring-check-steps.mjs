// check-skill-wiring.mjs orchestration: analysing the two .pfdsl files,
// consulting gen-plugin's bundle manifest, and turning findings into lines.
// Kept out of the script itself so the report shape and the exit-code branch
// are testable (#645).
//
// `analyzeFile` is injected because @pfdsl/core lives in packages/core/dist,
// which the entrypoint imports dynamically (as gen-samples.mjs does) — the
// tests supply parsed structures directly and need no build.

import { PLUGIN_MIRRORS } from "./gen-plugin.mjs";
import { declarationLine, findUnwiredSkills } from "./skill-wiring-check.mjs";

const WORKFLOW = ".pfdsl/workflow.pfdsl";
const PIPELINE = ".pfdsl/runtime-pipeline.pfdsl";

/**
 * @param {{
 *   readFile: (file: string) => string,
 *   analyzeFile: (text: string) => {frontmatter: {artifact?: object}, edges: Array<object>},
 *   mirrors?: Array<object>,
 * }} deps readFile is root-bound, so paths are repo-relative
 * @returns {{exitCode: 0|1, stdoutLines: string[], stderrLines: string[]}}
 */
export function runSkillWiringCheck({ readFile, analyzeFile, mirrors = PLUGIN_MIRRORS }) {
	const workflowText = readFile(WORKFLOW);
	const workflow = analyzeFile(workflowText);
	const pipeline = analyzeFile(readFile(PIPELINE));

	const findings = findUnwiredSkills({
		artifacts: workflow.frontmatter.artifact ?? {},
		workflowEdges: workflow.edges,
		pipelineEdges: pipeline.edges,
		mirrors,
	});

	if (findings.length === 0) {
		return { exitCode: 0, stdoutLines: ["check-skill-wiring: OK"], stderrLines: [] };
	}

	const stderrLines = findings.map((finding) => {
		const line = declarationLine(workflowText, finding.id);
		const anchor = line === null ? WORKFLOW : `${WORKFLOW}:${line}`;
		return `${anchor}: '${finding.id}' is bundled (${finding.location}) but missing from ${finding.missing.join(" and ")}`;
	});
	stderrLines.push(
		"",
		`Add it to \`distill_ops -> [...]\` in ${WORKFLOW} (it is produced there) and to`,
		`\`[...] >> gen_plugin\` in ${PIPELINE} (it is bundled material).`,
	);
	return { exitCode: 1, stdoutLines: [], stderrLines };
}
