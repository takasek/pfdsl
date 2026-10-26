#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { publishEdit } from "./lib/wiki-roadmap-edit-publish.mjs";

try {
	const { values } = parseArgs({
		options: {
			wiki: { type: "string" },
			repository: { type: "string" },
			"expected-revision": { type: "string" },
			message: { type: "string" },
			help: { type: "boolean" },
		},
	});
	const usage =
		"Usage: node scripts/wiki-roadmap-publish.mjs --wiki <checkout> --repository <owner/name> [--expected-revision <commit>] [--message <commit message>]";
	if (values.help)
		console.log(
			`${usage}\n\nPublish unstaged roadmap edits with validation and generated previews.\nRequires a built CLI, a default-branch HTTPS Wiki clone and Git author identity.\nSee docs/wiki-roadmap-spike.md for setup and recovery instructions.`,
		);
	else {
		if (!values.wiki || !values.repository) throw new Error(usage);
		console.log(
			JSON.stringify(
				publishEdit({
					wiki: resolve(values.wiki),
					repository: values.repository,
					expectedRevision: values["expected-revision"],
					message: values.message,
					cli: resolve(import.meta.dirname, "../packages/cli/dist/cli.js"),
				}),
				null,
				2,
			),
		);
	}
} catch (error) {
	console.error(String(error.stderr || error.message));
	if (error.recovery)
		console.error(
			JSON.stringify(
				{
					message:
						"Prepared candidate retained. Inspect the remote before retrying after an uncertain push result.",
					recovery: error.recovery,
				},
				null,
				2,
			),
		);
	if (error.cleanupWarning)
		console.error(
			JSON.stringify({
				cleanupWarning: error.cleanupWarning,
				cleanupPath: error.cleanupPath,
			}),
		);
	process.exitCode = 1;
}
