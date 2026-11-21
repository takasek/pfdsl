#!/usr/bin/env node
// Optional per-Issue PFDs. Canonical source remains in the Issue artifact.
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireGitHubIssues } from "./lib/github-issues-config.mjs";
import {
	createGitHubOps,
	GITHUB_UNAVAILABLE_EXIT_CODE,
	isGitHubUnavailableError,
} from "./lib/github-ops.mjs";
import { createIssuePfd } from "./lib/issue-pfd.mjs";
import {
	createIssuePfdCli,
	formatIssuePfdHelp,
	parseIssuePfdArgs,
} from "./lib/issue-pfd-cli.mjs";
import { resolveRepository } from "./lib/repository-identity.mjs";

process.stdout.on("error", (error) => {
	if (error.code !== "EPIPE") throw error;
});

const root = realpathSync(
	resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
);
let options;
try {
	options = parseIssuePfdArgs(process.argv.slice(2));
} catch (error) {
	console.error(`issue-pfd: ${error.message}`);
	process.exit(2);
}
if (options.help) {
	console.log(formatIssuePfdHelp(options.command));
	process.exit(0);
}
requireGitHubIssues(root, "issue-pfd");
try {
	const runner = createIssuePfd({
		root,
		github: createGitHubOps({ cwd: root }),
		repository: () => resolveRepository(root).identity,
		cli: options.command === "show" ? undefined : createIssuePfdCli({ root }),
	});
	const result = await runner.run(options);
	if (result.output !== undefined) process.stdout.write(result.output);
	else console.log(JSON.stringify(result, null, 2));
} catch (error) {
	console.error(`issue-pfd: ${error.message}`);
	process.exitCode = isGitHubUnavailableError(error)
		? GITHUB_UNAVAILABLE_EXIT_CODE
		: (error.exitCode ?? 1);
}
