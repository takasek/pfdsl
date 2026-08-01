#!/usr/bin/env node
// Fails when the bundle adopters currently hold has never been walked by an
// adoption-day probe (ADR-0029). See scripts/lib/probe-currency.mjs for why the
// trigger sits at the publish boundary rather than on every cycle.
//
// Run: node scripts/check-probe-currency.mjs [--report]
//   --report  print the same verdict but always exit 0 (for status output)

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkProbeCurrency } from "./lib/probe-currency.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG = "docs/adr/0029-adoption-day-probe/execution-log.md";

const reportOnly = process.argv.includes("--report");

const published = JSON.parse(
	readFileSync(resolve(root, "plugin/pfdsl/.claude-plugin/plugin.json"), "utf-8"),
).version;
const result = checkProbeCurrency(readFileSync(resolve(root, LOG), "utf-8"), published);

if (result.ok) {
	console.log(`check-probe-currency: OK (probed v${result.probed}, published v${result.published})`);
	process.exit(0);
}

const say = reportOnly ? console.log : console.error;
say(`check-probe-currency: ${result.reason}.`);
say(
	`\nRun the adoption-day probe (ADR-0029) against the current bundle and append the run to\n  ${LOG}\nwith a '- 対象バージョン: ... vX.Y.Z' line.`,
);
say(
	"Observation 1's repo-local-path rule is already automated as check-bundle-paths, so the\nmanual part is guidance executability and idempotency — smaller than when the ADR was written.",
);
process.exit(reportOnly ? 0 : 1);
