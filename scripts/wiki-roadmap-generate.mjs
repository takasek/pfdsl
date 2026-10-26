#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { generate, publish } from "./lib/wiki-roadmap-generate.mjs";

try {
	const { values } = parseArgs({
		options: {
			wiki: { type: "string" },
			repository: { type: "string" },
			"expected-revision": { type: "string" },
			publish: { type: "boolean", default: false },
		},
	});
	if (!values.wiki || !values.repository)
		throw new Error(
			"Required options: --wiki <checkout> --repository <owner/name> [--expected-revision <commit>] [--publish]",
		);
	const wiki = resolve(values.wiki);
	const result = generate({
		wiki,
		repository: values.repository,
		expectedRevision: values["expected-revision"],
		cli: resolve(import.meta.dirname, "../packages/cli/dist/cli.js"),
	});
	console.log(
		JSON.stringify(
			values.publish
				? publish({
						wiki,
						result,
						expectedRemote: `https://github.com/${values.repository}.wiki.git`,
					})
				: result,
			null,
			2,
		),
	);
} catch (error) {
	console.error(String(error.stderr || error.message));
	process.exitCode = 1;
}
