// DO NOT EDIT. Authoritative source: .claude/skills/pfd-ops/install/scripts/pfdsl/lib/github-ops.mjs.
/**
 * Named GitHub operations: the sole entry point production scripts use to
 * reach GitHub. Each operation has a gh-CLI implementation and an HTTP
 * (REST/GraphQL) implementation, and both return the same parsed JS value —
 * callers never JSON.parse the result themselves.
 *
 * Backend selection keeps the discipline execGh (gh-exec.mjs) always had:
 * try gh first; when it's missing (ENOENT) and a GH_TOKEN/GITHUB_TOKEN is
 * available, fall back to HTTP; otherwise rethrow the original ENOENT so a
 * caller's isGhUnavailableError(e) still recognizes "truly unavailable" and
 * can degrade gracefully (#489, #492). An operation with no HTTP
 * implementation (designRecordEditInfo) throws a named error instead of
 * falling back silently or rethrowing the ENOENT — see designRecordEditInfo.
 */

import { execFileSync } from "node:child_process";
import { isGhUnavailableError } from "./gh-compat.mjs";
import { execGh } from "./gh-exec.mjs";
import {
	fetchAllIssues,
	fetchAllLabels,
	fetchIssueView,
	fetchOpenPrsWithCi,
	fetchPullRequestView,
	mapLabelsResponse,
	parseOwnerRepo,
	addIssueLabel as restAddIssueLabel,
	createLabel as restCreateLabel,
	editLabel as restEditLabel,
} from "./github-rest.mjs";
import { proxyAwareFetch } from "./proxy-fetch.mjs";

// How many entries the list operations return. Each one is a single value
// used by both backends — gh reads it as `--limit`, HTTP truncates its own
// walk to it. Two separately written caps is what let the backends disagree
// about a repo past the limit while the parity claim above still stood.
const LABEL_LIST_LIMIT = 100;
const ISSUE_LIST_LIMIT = 500;

/**
 * @param {string} cwd
 * @returns {{owner: string, repo: string}}
 */
function ownerRepoFromGitRemote(cwd) {
	const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
		cwd,
		encoding: "utf-8",
	}).trim();
	const ownerRepo = parseOwnerRepo(remoteUrl);
	if (!ownerRepo)
		throw new Error(
			`could not determine owner/repo from git remote: ${remoteUrl}`,
		);
	return ownerRepo;
}

/**
 * The GraphQL query that reads a design-selection record's edit history
 * (#737 案2): the issue's own `lastEditedAt`, and every comment's, in one
 * round trip. REST's `updated_at` is not used — it moves on new comments
 * alone, so it is not evidence the record's own text changed. `gh issue view
 * --json comments` doesn't carry `lastEditedAt` at all (verified against a
 * live issue), which is why this goes through `gh api graphql` instead.
 * @param {{owner: string, repo: string, number: number}} params
 * @returns {string[]} argv for execGh
 */
export function buildDesignRecordEditQuery({ owner, repo, number }) {
	return [
		"api",
		"graphql",
		"-F",
		`owner=${owner}`,
		"-F",
		`repo=${repo}`,
		"-F",
		`number=${number}`,
		"-f",
		"query=query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ issue(number:$number){ lastEditedAt comments(first:100){ totalCount nodes { id lastEditedAt } } } } } ",
	];
}

/**
 * Parse buildDesignRecordEditQuery's response into the shape
 * designRecordEditInfo returns.
 * @param {string} jsonText - execGh's stdout for the graphql call
 * @returns {{issueLastEditedAt: string | null, comments: {totalCount: number, nodes: Array<{id: string, lastEditedAt: string | null}>}}}
 */
export function parseDesignRecordEditResponse(jsonText) {
	const issueData = JSON.parse(jsonText)?.data?.repository?.issue;
	if (!issueData)
		throw new Error(
			"unexpected GraphQL response shape for design-record edit info",
		);
	return {
		issueLastEditedAt: issueData.lastEditedAt ?? null,
		comments: {
			totalCount: issueData.comments.totalCount,
			nodes: issueData.comments.nodes,
		},
	};
}

/**
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {(args: string[], opts: {cwd: string}) => Promise<string>} [opts.execGhImpl]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Record<string, Function>}
 */
export function createGitHubOps({
	cwd = process.cwd(),
	execGhImpl = execGh,
	fetchImpl = proxyAwareFetch,
} = {}) {
	const runGh = (args) => execGhImpl(args, { cwd });

	// `cwd` is fixed for this instance, so the repo it names is too. Resolving
	// it once keeps a gate-check run that walks several issues from spawning
	// `git remote get-url origin` per operation.
	/** @type {{owner: string, repo: string} | undefined} */
	let ownerRepoCache;
	const ownerRepo = () => (ownerRepoCache ??= ownerRepoFromGitRemote(cwd));

	/**
	 * Runs `ghCall`, and on a genuine gh-unavailable ENOENT with a token
	 * present, resolves this repo's owner/repo and runs `httpCall` with it.
	 * Every other case (no ENOENT, or ENOENT with no token) rethrows the
	 * original error unchanged, so isGhUnavailableError keeps working for
	 * callers. `httpCall` undefined means this operation has no HTTP
	 * implementation: once gh is confirmed unavailable and a token is
	 * present (so HTTP fallback would otherwise be attempted), that is
	 * reported as a named, operation-specific error rather than the
	 * misleading original ENOENT.
	 * @param {string} operation
	 * @param {() => Promise<any>} ghCall
	 * @param {((ctx: {owner: string, repo: string, token: string}) => Promise<any>) | undefined} httpCall
	 */
	async function withFallback(operation, ghCall, httpCall) {
		try {
			return await ghCall();
		} catch (e) {
			if (!isGhUnavailableError(e)) throw e;
			const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
			if (!token) throw e;
			if (!httpCall)
				throw new Error(
					`github-ops: '${operation}' has no HTTP backend implementation; the gh CLI is required for this operation`,
				);
			const { owner, repo } = ownerRepo();
			return await httpCall({ owner, repo, token });
		}
	}

	return {
		/** @returns {Promise<{name: string, description: string}[]>} */
		listLabels: () =>
			withFallback(
				"listLabels",
				async () => {
					const out = await runGh([
						"label",
						"list",
						"--json",
						"name,description",
						"--limit",
						String(LABEL_LIST_LIMIT),
					]);
					// gh's `--json name,description` and the REST labels payload
					// carry the same two fields, so one mapping serves both.
					return mapLabelsResponse(JSON.parse(out));
				},
				async ({ owner, repo, token }) =>
					(await fetchAllLabels(owner, repo, token, fetchImpl)).slice(
						0,
						LABEL_LIST_LIMIT,
					),
			),

		/** @returns {Promise<Array<{number: number, state: string, stateReason: string|null, labels: {name:string}[], updatedAt: string}>>} */
		listIssues: () =>
			withFallback(
				"listIssues",
				async () => {
					const out = await runGh([
						"issue",
						"list",
						"--state",
						"all",
						"--json",
						"number,state,stateReason,labels,updatedAt",
						"--limit",
						String(ISSUE_LIST_LIMIT),
					]);
					return JSON.parse(out);
				},
				({ owner, repo, token }) =>
					fetchAllIssues(owner, repo, token, fetchImpl, ISSUE_LIST_LIMIT),
			),

		/**
		 * @param {{number: number, fields: string[]}} params
		 * @returns {Promise<Record<string, unknown>>}
		 */
		viewIssue: ({ number, fields }) =>
			withFallback(
				"viewIssue",
				async () => {
					const out = await runGh([
						"issue",
						"view",
						String(number),
						"--json",
						fields.join(","),
					]);
					return JSON.parse(out);
				},
				({ owner, repo, token }) =>
					fetchIssueView(owner, repo, token, number, fields, fetchImpl),
			),

		/**
		 * @param {{number: number, fields: string[]}} params
		 * @returns {Promise<Record<string, unknown>>}
		 */
		viewPr: ({ number, fields }) =>
			withFallback(
				"viewPr",
				async () => {
					const out = await runGh([
						"pr",
						"view",
						String(number),
						"--json",
						fields.join(","),
					]);
					return JSON.parse(out);
				},
				({ owner, repo, token }) =>
					fetchPullRequestView(owner, repo, token, number, fields, fetchImpl),
			),

		/** @returns {Promise<Array<{number: number, title: string, headRefName: string, statusCheckRollup: {conclusion: string|null}[]}>>} */
		listOpenPrs: () =>
			withFallback(
				"listOpenPrs",
				async () => {
					const out = await runGh([
						"pr",
						"list",
						"--state",
						"open",
						"--json",
						"number,title,headRefName,statusCheckRollup",
					]);
					return JSON.parse(out);
				},
				({ owner, repo, token }) =>
					fetchOpenPrsWithCi(owner, repo, token, fetchImpl),
			),

		/**
		 * @param {{number: number, label: string}} params
		 * @returns {Promise<void>}
		 */
		addIssueLabel: ({ number, label }) =>
			withFallback(
				"addIssueLabel",
				async () => {
					await runGh(["issue", "edit", String(number), "--add-label", label]);
				},
				({ owner, repo, token }) =>
					restAddIssueLabel(owner, repo, token, number, label, fetchImpl),
			),

		/**
		 * @param {{name: string, description?: string, color?: string}} params
		 * @returns {Promise<void>}
		 */
		createLabel: ({ name, description, color }) =>
			withFallback(
				"createLabel",
				async () => {
					await runGh([
						"label",
						"create",
						name,
						"--description",
						description,
						"--color",
						color,
					]);
				},
				({ owner, repo, token }) =>
					restCreateLabel(
						owner,
						repo,
						token,
						name,
						description,
						color,
						fetchImpl,
					),
			),

		/**
		 * @param {{name: string, description?: string}} params
		 * @returns {Promise<void>}
		 */
		editLabel: ({ name, description }) =>
			withFallback(
				"editLabel",
				async () => {
					await runGh(["label", "edit", name, "--description", description]);
				},
				({ owner, repo, token }) =>
					restEditLabel(owner, repo, token, name, description, fetchImpl),
			),

		/**
		 * The selected design-selection record's edit history (#737 案2). No HTTP
		 * implementation: `gh api graphql` has no REST equivalent worth
		 * reproducing for this one call site, so falling back here throws a named
		 * error instead of silently answering nothing (see withFallback).
		 * @param {{number: number}} params
		 * @returns {Promise<{issueLastEditedAt: string | null, comments: {totalCount: number, nodes: Array<{id: string, lastEditedAt: string | null}>}}>}
		 */
		designRecordEditInfo: ({ number }) =>
			withFallback(
				"designRecordEditInfo",
				async () => {
					const { owner, repo } = ownerRepo();
					const out = await runGh(
						buildDesignRecordEditQuery({ owner, repo, number }),
					);
					return parseDesignRecordEditResponse(out);
				},
				undefined,
			),
	};
}
