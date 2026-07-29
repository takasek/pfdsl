/**
 * Shared exit path for CI-gating scripts whose step function returns
 * {exitCode, stdoutLines, stderrLines}: print each line to its stream in
 * order, then exit with the given code. check-companion-bindings.mjs,
 * check-spec-ids.mjs and check-diag-registry.mjs each repeated this same
 * three-line trailer (#645 code review).
 * @param {{exitCode: number, stdoutLines: string[], stderrLines: string[]}} result
 */
export function emitLinesAndExit({ exitCode, stdoutLines, stderrLines }) {
	for (const line of stdoutLines) console.log(line);
	for (const line of stderrLines) console.error(line);
	process.exit(exitCode);
}
