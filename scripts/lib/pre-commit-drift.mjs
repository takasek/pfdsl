/**
 * Runs the pre-commit drift gates — the "regenerate the derived output and fail
 * if it changed" checks — and reports every stale one at once.
 *
 * The gates used to be a sh function that ran `exit 1` on the first failure, so
 * a commit with two stale outputs cost two commit attempts to discover: the
 * second gate's hint only appeared once the first was cleared (takasek/pfdsl#755).
 * Evaluating them all costs nothing extra — each gate's own commands run either
 * way — and turns the discovery into one pass.
 *
 * The runner takes its process execution as a parameter so the accumulation can
 * be tested without a repo in a particular state.
 */

import { matchesTrigger } from "./gate-check.mjs";

/**
 * @typedef {object} DriftGate
 * @property {string} id - names the gate in a failure, and in tests
 * @property {RegExp} trigger - staged paths that make this gate relevant
 * @property {string[]} requireDist - build outputs the commands read
 * @property {[string, string[]][]} commands - executable and argv, run in order
 * @property {string} hint - what the operator runs to clear it
 */

/**
 * @param {DriftGate[]} gates
 * @param {object} deps
 * @param {string[]} deps.stagedFiles
 * @param {(path: string) => boolean} deps.isDistFresh
 * @param {(file: string, args: string[]) => boolean} deps.runCommand
 * @returns {{failures: {id: string, hint: string}[], notes: string[]}}
 */
export function runDriftGates(gates, { stagedFiles, isDistFresh, runCommand }) {
	const failures = [];
	const notes = [];

	for (const gate of gates) {
		// Same matcher gate-check.mjs applies to these same trigger patterns, so
		// the two cannot come to disagree about what a trigger covers.
		if (!matchesTrigger(stagedFiles, gate.trigger)) {
			continue;
		}
		const staleDist = gate.requireDist.find((path) => !isDistFresh(path));
		if (staleDist) {
			notes.push(
				`note: skipping drift check (${staleDist} missing or stale vs its src/) — run 'pnpm -r build' to enable locally; CI verifies it.`,
			);
			continue;
		}
		// The commands were a shell `&&` chain — regenerate, then diff — so a
		// failed regeneration must not be followed by a diff of what it didn't
		// write.
		const ok = gate.commands.every(([file, args]) => runCommand(file, args));
		if (!ok) {
			failures.push({ id: gate.id, hint: gate.hint });
		}
	}

	return { failures, notes };
}
