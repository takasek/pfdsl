#!/usr/bin/env node

// Regenerates the CLI command listings from `pfdsl help` output: README.md's
// `## CLI` block (raw help paste) and packages/cli/README.md's command tables
// (#850). Run from repo root: node scripts/gen-readme-cli.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertEntriesDescribed,
	parseCommandGroups,
	parseCommandSection,
	renderCommandTables,
} from "./lib/readme-cli.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const cliPath = resolve(root, "packages/cli/dist/cli.js");
if (!existsSync(cliPath)) {
	console.error(
		"Error: packages/cli/dist/cli.js not found. Run 'pnpm -r build' first.",
	);
	process.exit(1);
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function runCli(args) {
	return execFileSync(process.execPath, [cliPath, ...args], {
		encoding: "utf-8",
	}).replace(/\s+$/, "");
}

const startMarker = "<!-- gen-readme-cli:start -->";
const endMarker = "<!-- gen-readme-cli:end -->";

/**
 * @param {string} relativePath
 * @param {string} block - the replacement text, sentinels excluded
 */
function writeSentinelBlock(relativePath, block) {
	const path = resolve(root, relativePath);
	const content = readFileSync(path, "utf-8");
	const startIdx = content.indexOf(startMarker);
	const endIdx = content.indexOf(endMarker);

	if (startIdx === -1 || endIdx === -1) {
		console.error(
			`Error: ${relativePath} is missing gen-readme-cli sentinel comments. See scripts/gen-readme-cli.mjs.`,
		);
		process.exit(1);
	}

	const before = content.slice(0, startIdx + startMarker.length);
	const after = content.slice(endIdx);
	writeFileSync(path, `${before}\n\n${block}\n\n${after}`);
	console.log(`${relativePath} CLI section ← \`pfdsl help\``);
}

const helpOutput = runCli(["help"]);

writeSentinelBlock("README.md", `\`\`\`bash\n${helpOutput}\n\`\`\``);

// A group's own `--help` is the source for its subcommands. `pfdsl <group>`
// with no subcommand prints the same text but on stderr with exit 2, which
// execFileSync reports as a failure.
const groups = parseCommandGroups(helpOutput).map((group) => ({
	...group,
	subcommands: assertEntriesDescribed(
		parseCommandSection(runCli([group.name, "--help"]), "Subcommands:"),
		`pfdsl ${group.name} --help`,
	),
}));

writeSentinelBlock(
	"packages/cli/README.md",
	renderCommandTables({
		commands: assertEntriesDescribed(
			parseCommandSection(helpOutput, "Commands:"),
			"pfdsl help",
		),
		groups,
	}),
);
