/**
 * The release-only gates and their shared runner.
 *
 * Build, test, check-docs, and generated-plugin identity remain release checks, but are intentionally not in this registry: they are continuously covered elsewhere and are not publishing work left pending.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
	repoDeps as distributionReviewRepoDeps,
	RECORD_PATH,
	runDistributionReviewCheck,
} from "./distribution-review.mjs";
import { pendingUnreleasedHeadings } from "./migration-guide-check.mjs";
import {
	formatDistributionReviewStatus,
	formatFullReviewStatus,
	formatSpecHistoryStatus,
	latestFullReviewDate,
} from "./release-status-check.mjs";
import { tryRun } from "./run-exec.mjs";
import {
	runSpecHistoryCheck,
	repoDeps as specHistoryRepoDeps,
} from "./spec-history-check.mjs";

const statusLines = (line) => line.split("\n");

function distributionReviewGate(root, mode, exec) {
	if (mode === "release") {
		const result = exec(
			process.execPath,
			[resolve(root, "scripts/check-distribution-review.mjs")],
			{ cwd: root, captureStderr: true },
		);
		return { ok: result.ok, message: result.out.trim() };
	}

	const deps = distributionReviewRepoDeps(root);
	const result = runDistributionReviewCheck(deps);
	const logDir = resolve(root, dirname(RECORD_PATH));
	const status = {
		record: deps.readRecord() ?? { commit: null },
		// undefined means the gate could not inspect the recorded commit. It is deliberately not converted to zero, because the gate fails closed.
		unreviewedCount: result.files?.length,
		blockedReason: result.files === undefined ? result.message : null,
		lastFullReview: latestFullReviewDate(
			existsSync(logDir) ? readdirSync(logDir) : [],
		),
	};
	return { ...result, status };
}

const MIGRATION_GUIDE_PATH = "docs/migration-guide.md";
const MIGRATION_GUIDE_PROCEDURE = ".pfdsl/workflow.md#採用先への移行案内";

// Only the CLI/plugin release publishes what the guide's CLI/plugin Unreleased section describes, so the other kinds are not held for it. Status has no kind and reports the section without failing, because it is the ordinary state between releases.
function migrationGuideGate(root, mode, _exec, kind) {
	if (mode === "release" && kind === undefined) {
		throw new Error("the migration-guide gate needs the release kind");
	}
	// A release that is not gated must not depend on the guide being readable.
	if (mode === "release" && kind !== "cli") {
		return { kind, pending: [], ok: true };
	}
	let text;
	try {
		text = readFileSync(resolve(root, MIGRATION_GUIDE_PATH), "utf8");
	} catch (error) {
		// Only a gated release fails on it; status reports it and carries on.
		return {
			kind,
			pending: [],
			unreadable: error?.code ?? String(error),
			ok: mode !== "release",
		};
	}
	const pending = pendingUnreleasedHeadings(text);
	return {
		kind,
		pending,
		ok: mode !== "release" || pending.length === 0,
	};
}

function formatMigrationGuide({ kind, pending, unreadable, ok }, mode) {
	if (unreadable !== undefined && mode === "release") {
		return {
			ok,
			lines: [
				`cannot read ${MIGRATION_GUIDE_PATH} (${unreadable}), so a CLI/plugin release cannot be checked for an Unreleased section.`,
				`Restore the guide before a CLI/plugin release (${MIGRATION_GUIDE_PROCEDURE}).`,
			],
		};
	}
	if (mode === "status") {
		const name = `migration-guide (${MIGRATION_GUIDE_PATH})`;
		if (unreadable !== undefined) {
			return {
				ok,
				lines: [
					`  ${name} · cannot read ${MIGRATION_GUIDE_PATH} (${unreadable}); its Unreleased section was not checked`,
				],
			};
		}
		if (pending.length === 0) {
			return {
				ok,
				lines: [`  ${name} ✓ no CLI/plugin Unreleased section`],
			};
		}
		return {
			ok,
			lines: pending.map(
				(heading) =>
					`  ${name} · pending "${heading}": a CLI/plugin release is blocked until release preparation assigns its destination release (${MIGRATION_GUIDE_PROCEDURE})`,
			),
		};
	}
	if (kind !== "cli") {
		return {
			ok,
			lines: [`${MIGRATION_GUIDE_PATH} is not gated for a ${kind} release.`],
		};
	}
	if (ok) {
		return {
			ok,
			lines: [`${MIGRATION_GUIDE_PATH} has no CLI/plugin Unreleased section.`],
		};
	}
	return {
		ok,
		lines: [
			`${MIGRATION_GUIDE_PATH} still has the CLI/plugin Unreleased section ${pending.map((heading) => `"${heading}"`).join(", ")}.`,
			`Release preparation must assign the destination release before a CLI/plugin release (${MIGRATION_GUIDE_PROCEDURE}).`,
		],
	};
}

/**
 * The only enumeration of release-only gate definitions. `format` turns each gate's native result into the common `{ok, lines}` shape consumed by both release entry points.
 */
export const RELEASE_GATE_DEFINITIONS = [
	{
		id: "distribution-review",
		run: distributionReviewGate,
		format: (result, mode) => {
			if (mode === "release") {
				return { ok: result.ok, lines: statusLines(result.message) };
			}
			const lines = [
				formatDistributionReviewStatus(result.status),
				formatFullReviewStatus(result.status.lastFullReview),
			];
			const warnings = result.status.blockedReason
				? [`warn: ${result.status.blockedReason}`]
				: [];
			return { ok: result.ok, lines, warnings };
		},
	},
	{
		id: "spec-history",
		run: (root) => runSpecHistoryCheck(specHistoryRepoDeps(root)),
		format: (result, mode) => ({
			ok: result.ok,
			lines: statusLines(
				mode === "release" ? result.message : formatSpecHistoryStatus(result),
			),
		}),
	},
	{
		id: "migration-guide",
		run: migrationGuideGate,
		format: formatMigrationGuide,
	},
];

/**
 * Run every release-only gate in the established release order.
 * @param {string} root repository root
 * @param {{mode?: "release" | "status", kind?: string, stopOnFailure?: boolean, definitions?: Array<{id: string, run: Function, format: Function}>, exec?: Function}} [options]
 * @returns {Array<{id: string, ok: boolean, lines: string[], warnings?: string[]}>}
 */
export function runReleaseGates(
	root,
	{
		mode = "status",
		kind,
		stopOnFailure = false,
		definitions = RELEASE_GATE_DEFINITIONS,
		exec = tryRun,
	} = {},
) {
	const results = [];
	for (const gate of definitions) {
		const result = gate.run(root, mode, exec, kind);
		const normalized = { id: gate.id, ...gate.format(result, mode) };
		results.push(normalized);
		if (stopOnFailure && !normalized.ok) break;
	}
	return results;
}
