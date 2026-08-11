import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertEntriesDescribed,
	parseCommandGroups,
	parseCommandSection,
	renderCommandTables,
} from "./readme-cli.mjs";

const HELP = `pfdsl <command> [options]

Commands:
  check <file|-> [--strict] [--hints] [--json] [--no-color]
                           Validate a .pfdsl file (- = stdin)
  explain <code>           Print the summary and spec section for a diagnostic code (e.g. V021)
  render <file|-> [--format dot|svg|pdf|png] [--no-color]
                           Render as Graphviz DOT (default), SVG, PDF, or PNG (- = stdin)
                           PDF/PNG requires puppeteer in the CLI's own Node env (npm install puppeteer)

Command groups (run \`pfdsl <group>\` for their subcommands):
  graph summary|io|stats
                           Read-only queries on the graph topology
  meta get|set
                           Read and write frontmatter metadata

  help                     Show this help

Exit codes:
  0  success (warnings are non-fatal)
`;

const GRAPH_HELP = `usage: pfdsl graph <subcommand> ...

Read-only queries on the graph topology. Run
\`pfdsl graph <subcommand> --help\` for details on each.

Subcommands:
  summary <file|->            Print artifact/process/edge counts
  path <file|-> <from> <to> [--limit]
                              All simple paths between two nodes

All subcommands accept --json and --no-color.
`;

// The descriptions are column-aligned, not separated by a fixed run of
// spaces: `status`'s longest usage leaves exactly one space before its
// description.
const STATUS_HELP = `usage: pfdsl status <subcommand> ...

Subcommands:
  ready <file|-> [--best]           List ready-to-start processes
  list <file|-> --status <s[,s...]> List artifacts by status

All subcommands accept --json and --no-color.
`;

describe("parseCommandSection", () => {
	it("splits at the description column even when one space separates them", () => {
		assert.deepEqual(parseCommandSection(STATUS_HELP, "Subcommands:"), [
			{
				usage: "ready <file|-> [--best]",
				description: "List ready-to-start processes",
			},
			{
				usage: "list <file|-> --status <s[,s...]>",
				description: "List artifacts by status",
			},
		]);
	});

	it("reads a one-line entry as usage plus description", () => {
		const entries = parseCommandSection(HELP, "Commands:");
		assert.deepEqual(entries[1], {
			usage: "explain <code>",
			description:
				"Print the summary and spec section for a diagnostic code (e.g. V021)",
		});
	});

	it("attaches a wrapped description to the entry above it", () => {
		const entries = parseCommandSection(HELP, "Commands:");
		assert.deepEqual(entries[0], {
			usage: "check <file|-> [--strict] [--hints] [--json] [--no-color]",
			description: "Validate a .pfdsl file (- = stdin)",
		});
	});

	it("joins a description spilling over more than one line", () => {
		const entries = parseCommandSection(HELP, "Commands:");
		assert.equal(
			entries[2].description,
			"Render as Graphviz DOT (default), SVG, PDF, or PNG (- = stdin) PDF/PNG requires puppeteer in the CLI's own Node env (npm install puppeteer)",
		);
	});

	it("stops at the blank line ending the section", () => {
		const entries = parseCommandSection(HELP, "Commands:");
		assert.equal(entries.length, 3);
	});

	it("reads a group help's Subcommands section the same way", () => {
		const entries = parseCommandSection(GRAPH_HELP, "Subcommands:");
		assert.deepEqual(entries, [
			{
				usage: "summary <file|->",
				description: "Print artifact/process/edge counts",
			},
			{
				usage: "path <file|-> <from> <to> [--limit]",
				description: "All simple paths between two nodes",
			},
		]);
	});

	it("throws when the section is absent, rather than emitting an empty table", () => {
		assert.throws(
			() => parseCommandSection(HELP, "Nonexistent:"),
			/Nonexistent:/,
		);
	});
});

describe("assertEntriesDescribed", () => {
	it("passes entries that all carry a description through unchanged", () => {
		const entries = parseCommandSection(STATUS_HELP, "Subcommands:");
		assert.equal(assertEntriesDescribed(entries, "status"), entries);
	});

	it("names the undescribed entry, since a misparse shows up as an empty cell", () => {
		assert.throws(
			() =>
				assertEntriesDescribed(
					[{ usage: "list <file|->", description: "" }],
					"status",
				),
			/status.*list <file\|->/,
		);
	});
});

describe("parseCommandGroups", () => {
	it("names each group and keeps its description, dropping the subcommand list", () => {
		assert.deepEqual(parseCommandGroups(HELP), [
			{ name: "graph", description: "Read-only queries on the graph topology" },
			{ name: "meta", description: "Read and write frontmatter metadata" },
		]);
	});
});

describe("renderCommandTables", () => {
	const block = renderCommandTables({
		commands: [
			{ usage: "explain <code>", description: "Print the summary" },
			{ usage: "check <file|->", description: "Validate a .pfdsl file" },
		],
		groups: [
			{
				name: "graph",
				description: "Read-only queries on the graph topology",
				subcommands: [
					{ usage: "summary <file|->", description: "Print counts" },
				],
			},
		],
	});

	it("puts the top-level commands in one table", () => {
		assert.match(block, /\| Command \| Description \|\n\|---\|---\|\n/);
		assert.match(block, /\| `pfdsl explain <code>` \| Print the summary \|/);
	});

	it("escapes pipes inside usage, which would otherwise split the row", () => {
		assert.match(
			block,
			/\| `pfdsl check <file\\\|->` \| Validate a \.pfdsl file \|/,
		);
	});

	it("gives each group a heading carrying its own description", () => {
		assert.match(
			block,
			/### `graph` — Read-only queries on the graph topology/,
		);
	});

	it("prefixes a group's subcommands with the group name", () => {
		assert.match(
			block,
			/\| `pfdsl graph summary <file\\\|->` \| Print counts \|/,
		);
	});
});
