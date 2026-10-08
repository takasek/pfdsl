import { basename } from "node:path";
import { GLOBAL_FLAGS_WITH_VALUE, parseGhCommand } from "./gh-command.mjs";

// Explicitly reviewed read capabilities. Unknown/compound names fail closed.
const READ_GITHUB_TOOLS = new Set([
	"get_issue",
	"get_pull_request",
	"get_pull_request_files",
	"get_pull_request_comments",
	"get_file_contents",
	"list_issues",
	"list_pull_requests",
	"list_commits",
	"list_branches",
	"search_issues",
	"search_prs",
	"search_pull_requests",
	"search_code",
	"search_repositories",
	"fetch",
	"fetch_blob",
	"fetch_commit",
	"fetch_commit_workflow_runs",
	"fetch_file",
	"fetch_issue",
	"fetch_issue_comments",
	"fetch_pr",
	"fetch_pr_comments",
	"fetch_pr_file_patch",
	"fetch_pr_patch",
	"fetch_workflow_job_logs",
	"fetch_workflow_job_steps",
	"fetch_workflow_run_artifacts",
	"fetch_workflow_run_jobs",
	"get_pr_info",
	"get_repository",
	"get_authenticated_user",
	"get_user",
	"get_me",
	"issue_read",
	"pull_request_read",
	"download_user_content",
	"search",
	"compare_commits",
	"download_workflow_artifact",
	"get_commit_combined_status",
	"get_issue_comment_reactions",
	"get_pr_diff",
	"get_pr_reactions",
	"get_pr_review_comment_reactions",
	"get_profile",
	"get_repo",
	"get_repo_collaborator_permission",
	"get_user_login",
	"get_users_recent_prs_in_repo",
	"list_installations",
	"list_installed_accounts",
	"list_pr_changed_filenames",
	"list_pull_request_review_threads",
	"list_pull_request_reviews",
	"list_recent_issues",
	"list_repositories",
	"list_repositories_by_affiliation",
	"list_repositories_by_installation",
	"list_user_org_memberships",
	"list_user_orgs",
	"search_branches",
	"search_commits",
	"search_installed_repositories_streaming",
	"search_installed_repositories_v2",
]);

export function githubToolEffect(name) {
	if (typeof name !== "string") return null;
	const match = name.match(/^mcp__.*?github(?:__|_)(.+)$/i);
	if (!match) return /^mcp__.*github/i.test(name) ? "write-or-unknown" : null;
	const verb = match[1].toLowerCase();
	if (
		[
			"merge_pull_request",
			"enable_auto_merge",
			"enable_pull_request_auto_merge",
		].includes(verb)
	)
		return "merge";
	return READ_GITHUB_TOOLS.has(verb) ? "read" : "write-or-unknown";
}

// Flag tables from the gh 2.102 help output. pflag has no abbreviations, so
// only exact names are flags.
const GH_MERGE_HELP_FLAGS = {
	"pr merge": {
		booleans: [
			"--admin",
			"--auto",
			"-d",
			"--delete-branch",
			"--disable-auto",
			"-m",
			"--merge",
			"-r",
			"--rebase",
			"-s",
			"--squash",
		],
		values: [
			"-A",
			"--author-email",
			"-b",
			"--body",
			"-F",
			"--body-file",
			"--match-head-commit",
			"-t",
			"--subject",
			"-R",
			"--repo",
		],
	},
	api: {
		booleans: [
			"--allow-escape-sequences",
			"-i",
			"--include",
			"--paginate",
			"--silent",
			"--slurp",
			"--verbose",
		],
		values: [
			"--cache",
			"-F",
			"--field",
			"-H",
			"--header",
			"--hostname",
			"--input",
			"-q",
			"--jq",
			"-X",
			"--method",
			"-p",
			"--preview",
			"-f",
			"--raw-field",
			"-t",
			"--template",
		],
	},
};

/**
 * Whether gh would print usage for `args` instead of running the command:
 * `--help` counts only as a standalone flag, reached while every earlier token
 * is a positional, a known boolean flag, a known value flag with its value, or
 * a `--flag=value` form of a known flag. A value flag consumes `--help` as its
 * value, and `--` or an unknown flag stops the scan (gh then runs or rejects
 * the command). Only the long form is honored: gh binds `-h` to value flags on
 * some commands and to help on others.
 * @param {string[]} args every token after `gh`
 * @param {{booleans: string[], values: string[]}} table
 */
function hasStandaloneHelp(args, table) {
	const booleans = new Set(table.booleans);
	const values = new Set([...table.values, ...GLOBAL_FLAGS_WITH_VALUE]);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--") return false;
		if (arg === "--help") return true;
		if (!arg.startsWith("-") || arg === "-") continue;
		if (arg.startsWith("--")) {
			const name = arg.split("=", 1)[0];
			if (!booleans.has(name) && !values.has(name)) return false;
			if (arg === name && !booleans.has(name)) i++;
			continue;
		}
		// A shorthand cluster: booleans may combine, and a value flag takes the
		// rest of the token or, at the end, the next one.
		for (let j = 1; j < arg.length; j++) {
			const flag = `-${arg[j]}`;
			if (booleans.has(flag)) continue;
			if (!values.has(flag)) return false;
			if (j === arg.length - 1) i++;
			break;
		}
	}
	return false;
}

export function findMergeCommand(
	command,
	{ readShellCommands, stripLeadingNoise },
) {
	if (typeof command !== "string") return null;
	for (const { tokens: raw } of readShellCommands(command)) {
		const tokens = stripLeadingNoise(raw);
		if (!tokens.length || basename(tokens[0].value) !== "gh") continue;
		const parsed = parseGhCommand([
			{ ...tokens[0], value: "gh", quoted: false },
			...tokens.slice(1),
		]);
		if (!parsed) continue;
		if (parsed.group === "pr" && parsed.verb === "merge") {
			if (hasStandaloneHelp(parsed.args, GH_MERGE_HELP_FLAGS["pr merge"]))
				continue;
			return "gh pr merge";
		}
		if (parsed.group !== "api") continue;
		if (hasStandaloneHelp(parsed.args, GH_MERGE_HELP_FLAGS.api)) continue;
		if (
			parsed.args.some((arg) => /(?:^|\/)pulls\/[^/]+\/merge(?:$|\?)/.test(arg))
		)
			return "gh api pull request merge";
		if (parsed.args.includes("graphql")) {
			if (
				parsed.args.some(
					(arg) =>
						/\bmutation\b/.test(arg) &&
						/\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/.test(arg),
				)
			)
				return "gh api GraphQL merge";
			if (
				parsed.args.some(
					(arg) =>
						arg === "--input" ||
						arg.startsWith("--input=") ||
						/^(?:(?:--field|--raw-field)=|-[Ff])?(?:query|mutation)=@/.test(
							arg,
						),
				)
			)
				return "gh api opaque GraphQL input";
		}
	}
	return null;
}

export function mergeDecision(matched, supportsAsk) {
	return {
		decision: supportsAsk ? "ask" : "deny",
		matched,
		reason: `Blocked '${matched}': merging and enabling auto-merge require the human's final review. Keep the pull request open for that review.`,
	};
}
