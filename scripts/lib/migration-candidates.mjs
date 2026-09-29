/**
 * Lists the commits release preparation must classify for the migration guide.
 * Classification stays with a person; this only enumerates the interval.
 *
 * The distributed roots come from `DISTRIBUTION_ROOTS` rather than a copy, so a change to them reaches the listing without a second edit. `packages/` and `docs/spec/` are added for CLI and specification changes, which the plugin roots do not carry.
 */

import { parseArgs } from "node:util";

import { DISTRIBUTION_ROOTS } from "./distribution-review.mjs";
import { git } from "./run-exec.mjs";

const EXTRA_PATHS = ["packages/", "docs/spec/"];

/** @returns {string[]} */
export function migrationCandidatePaths() {
	return [...DISTRIBUTION_ROOTS, ...EXTRA_PATHS];
}

/**
 * @param {string[]} args
 * @returns {{from: string, to: string}}
 */
export function parseMigrationCandidateArgs(args) {
	const { values, tokens } = parseArgs({
		args,
		options: {
			from: { type: "string" },
			to: { type: "string" },
		},
		strict: true,
		allowPositionals: false,
		tokens: true,
	});
	// parseArgs keeps the last of a repeated flag, which would hide a mistyped interval.
	for (const flag of ["from", "to"]) {
		const given = tokens.filter(
			(token) => token.kind === "option" && token.name === flag,
		);
		if (given.length > 1) {
			throw new Error(`--${flag} was given more than once`);
		}
	}
	const to = values.to ?? "HEAD";
	// An empty value is rejected, not defaulted: `--to "$UNSET"` would otherwise list `from..` up to HEAD.
	for (const [flag, value] of [
		["--from", values.from],
		["--to", to],
	]) {
		if (value === undefined || value === "") {
			throw new Error(
				flag === "--from" ? "--from is required" : "--to must not be empty",
			);
		}
		// The revisions reach git as positional arguments, where a leading dash would be read as one of its options.
		if (value.startsWith("-")) {
			throw new Error(`${flag} must not start with '-'`);
		}
	}
	return { from: values.from, to };
}

/**
 * @param {{from: string, to: string}} interval
 * @returns {string[]}
 */
export function migrationCandidateGitArgs({ from, to }) {
	return [
		"log",
		"--no-merges",
		"--format=%h %s",
		`${from}..${to}`,
		"--",
		...migrationCandidatePaths(),
	];
}

/**
 * @param {{from: string, to: string}} interval
 * @param {{cwd?: string, exec?: (args: string[], options: {cwd?: string}) => string}} [deps]
 * @returns {string}
 */
export function listMigrationCandidates(interval, { cwd, exec = git } = {}) {
	return exec(migrationCandidateGitArgs(interval), { cwd });
}
