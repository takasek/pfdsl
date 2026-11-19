#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { git, withoutGitTargetEnvironment } from "./lib/run-exec.mjs";
import { generate, publish } from "./lib/wiki-roadmap-generate.mjs";

try {
	const { values } = parseArgs({
		options: {
			wiki: { type: "string" },
			repository: { type: "string" },
			"repository-root": { type: "string" },
			publish: { type: "boolean", default: false },
			help: { type: "boolean" },
		},
		strict: true,
		allowPositionals: false,
	});
	const usage =
		"Usage: node scripts/wiki-roadmap-run.mjs --wiki <new-checkout> --repository <owner/name> [--repository-root <checkout>] [--publish]";
	if (values.help) {
		console.log(
			`${usage}\n\nClone the trial Wiki, resolve fixed references and generate its preview.\nWith --publish, push the generated pair using the existing conflict checks.`,
		);
	} else {
		if (!values.wiki || !/^[\w-]+\/[\w.-]+$/.test(values.repository ?? ""))
			throw new Error(usage);
		const root = resolve(
			values["repository-root"] ?? resolve(import.meta.dirname, ".."),
		);
		const wiki = resolve(values.wiki);
		const wikiSource = `https://github.com/${values.repository}.wiki.git`;
		const repositorySource = `https://github.com/${values.repository}.git`;
		// Keep authentication process-local, as in the former workflow shell step.
		process.env.GIT_TERMINAL_PROMPT = "0";
		if (process.env.GH_TOKEN) {
			process.env.GIT_CONFIG_COUNT = "1";
			process.env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
			process.env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString("base64")}`;
		}
		const runGit = (cwd, ...args) =>
			git(["-C", cwd, ...args], {
				env: withoutGitTargetEnvironment(process.env),
				captureStderr: true,
			}).trim();
		const implementationRevision = runGit(
			resolve(import.meta.dirname, ".."),
			"rev-parse",
			"HEAD",
		);
		const referenceRepositoryRevision = runGit(root, "rev-parse", "HEAD");
		runGit(root, "clone", wikiSource, wiki);
		const wikiRevision = runGit(wiki, "rev-parse", "HEAD");
		console.error(
			`Acquired Wiki revision: ${wikiRevision}; implementation revision: ${implementationRevision}; reference repository revision: ${referenceRepositoryRevision}`,
		);
		const result = generate({
			wiki,
			repository: values.repository,
			cli: resolve(import.meta.dirname, "../packages/cli/dist/cli.js"),
			expectedRevision: wikiRevision,
			roadmapSource: {
				adapter: "local-git",
				source: wikiSource,
				revision: wikiRevision,
				documentId: "roadmap.pfdsl",
				companionId: "roadmap.md",
				logicalPath: "roadmap.pfdsl",
				basis: { source: wikiSource, revision: wikiRevision },
			},
			localSources: { [wikiSource]: wiki, [repositorySource]: root },
		});
		console.log(
			JSON.stringify(
				{
					...(values.publish
						? publish({ wiki, result, expectedRemote: wikiSource })
						: result),
					acquiredWikiRevision: wikiRevision,
					implementationRevision,
					referenceRepositoryRevision,
				},
				null,
				2,
			),
		);
	}
} catch (error) {
	console.error(String(error.stderr || error.message));
	process.exitCode = 1;
}
