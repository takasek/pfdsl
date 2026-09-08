/**
 * Named GitHub operations: the sole entry point for production calls that
 * promise gh/HTTP fallback parity. Each fallback-supported operation has a
 * gh-CLI implementation and an HTTP (REST/GraphQL) implementation, and both
 * return the same parsed JS value — callers never JSON.parse the result
 * themselves. Operations that enter through this module but cannot fall back
 * fail under their own name. Production calls that intentionally require gh
 * and make no fallback promise remain outside this module.
 *
 * Backend selection keeps the discipline execGh (gh-exec.mjs) always had:
 * try gh first; when it's missing (ENOENT) and a GH_TOKEN/GITHUB_TOKEN is
 * available, fall back to HTTP; otherwise rethrow the original ENOENT so a
 * caller's isGhUnavailableError(e) still recognizes "truly unavailable" and
 * can degrade gracefully (#489, #492).
 */

import { execFileSync } from "node:child_process";
import { isGhUnavailableError } from "./gh-compat.mjs";
import { execGh } from "./gh-exec.mjs";
import {
	DESIGN_RECORD_EDIT_QUERY,
	fetchAllIssues,
	fetchAllLabels,
	fetchDesignRecordEditInfo,
	fetchIssueView,
	fetchOpenPrs,
	fetchPullRequestView,
	mapLabelsResponse,
	normalizeDesignRecordEditResponse,
	parseHost,
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
const ISSUE_LIST_LIMIT = 1000;
const PR_LIST_LIMIT = 100;

async function rejectSaturatedList(operation, limit, itemsPromise) {
	// A result with exactly `limit` entries may be the complete list or a
	// cap-truncated list; neither backend reports which one it is. Rejecting
	// both cases keeps a cap-bound result from being mistaken for a full list.
	const items = await itemsPromise;
	if (items.length >= limit)
		throw new Error(
			`github-ops: ${operation} hit its list limit of ${limit}; refusing a possibly truncated result`,
		);
	return items;
}

function commentDatabaseIdFromUrl(url) {
	const match = typeof url === "string" && url.match(/#issuecomment-(\d+)$/);
	if (!match) return undefined;
	const databaseId = Number(match[1]);
	return Number.isSafeInteger(databaseId) ? databaseId : undefined;
}

function normalizeIssueViewComments(issue) {
	if (!Array.isArray(issue?.comments)) return issue;
	return {
		...issue,
		comments: issue.comments.map((comment) => {
			const normalized = {
				id: comment.id,
				databaseId: comment.databaseId ?? commentDatabaseIdFromUrl(comment.url),
				author: comment.author,
				body: comment.body ?? "",
				createdAt: comment.createdAt,
				url: comment.url,
			};
			return Object.fromEntries(
				Object.entries(normalized).filter(([, value]) => value !== undefined),
			);
		}),
	};
}

/**
 * @param {string} cwd
 * @returns {{host: string, owner: string, repo: string}}
 */
function repositoryFromGitRemote(cwd) {
	const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
		cwd,
		encoding: "utf-8",
	}).trim();
	const ownerRepo = parseOwnerRepo(remoteUrl);
	const host = parseHost(remoteUrl);
	if (!ownerRepo || !host)
		throw new Error(
			`could not determine host/owner/repo from git remote: ${remoteUrl}`,
		);
	return { host, ...ownerRepo };
}

/**
 * The GraphQL query that reads the selected design-selection record comment's
 * edit timestamp. REST's `updated_at` is not used because it also changes
 * when a comment is added.
 * @param {{nodeId: string}} params
 * @returns {string[]} argv for execGh
 */
export function buildDesignRecordEditQuery({ nodeId }) {
	return [
		"api",
		"graphql",
		"-F",
		`nodeId=${nodeId}`,
		"-f",
		`query=${DESIGN_RECORD_EDIT_QUERY}`,
	];
}

/**
 * Parse buildDesignRecordEditQuery's response into the shape
 * designRecordEditInfo returns.
 * @param {string} jsonText - execGh's stdout for the graphql call
 * @returns {{status: "edited" | "unedited", editedAtIso: string | null}}
 */
export function parseDesignRecordEditResponse(jsonText) {
	return normalizeDesignRecordEditResponse(JSON.parse(jsonText));
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
	/** @type {{host: string, owner: string, repo: string} | undefined} */
	let repositoryCache;
	const repository = () => (repositoryCache ??= repositoryFromGitRemote(cwd));
	const ownerRepo = () => {
		const { owner, repo } = repository();
		return { owner, repo };
	};

	/**
	 * Runs `ghCall`, and on a genuine gh-unavailable ENOENT with a token
	 * present, resolves this repo's owner/repo unless the operation is already
	 * addressed by an opaque identifier, then runs `httpCall` with it.
	 * Every other case (no ENOENT, or ENOENT with no token) rethrows the
	 * original error unchanged, so isGhUnavailableError keeps working for
	 * callers. `httpCall` undefined means this operation has no HTTP
	 * implementation: once gh is confirmed unavailable and a token is
	 * present (so HTTP fallback would otherwise be attempted), that is
	 * reported as a named, operation-specific error rather than the
	 * misleading original ENOENT.
	 * @param {string} operation
	 * @param {() => Promise<any>} ghCall
	 * @param {((ctx: {owner?: string, repo?: string, token: string}) => Promise<any>) | undefined} httpCall
	 * @param {{resolveOwnerRepo?: boolean}} [options]
	 */
	async function withFallback(
		operation,
		ghCall,
		httpCall,
		{ resolveOwnerRepo = true } = {},
	) {
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
			const context = resolveOwnerRepo ? ownerRepo() : {};
			return await httpCall({ ...context, token });
		}
	}

	function withListFallback(operation, limit, ghCall, httpCall) {
		return rejectSaturatedList(
			operation,
			limit,
			withFallback(operation, ghCall, httpCall),
		);
	}

	return {
		/** @returns {Promise<{name: string, description: string}[]>} */
		listLabels: () =>
			withListFallback(
				"listLabels",
				LABEL_LIST_LIMIT,
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
			withListFallback(
				"listIssues",
				ISSUE_LIST_LIMIT,
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
					return normalizeIssueViewComments(JSON.parse(out));
				},
				({ owner, repo, token }) =>
					fetchIssueView(owner, repo, token, number, fields, fetchImpl),
			),

		/** @returns {{host: string, owner: string, repo: string}} */
		repository,

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

		/** @returns {Promise<Array<{number: number, title: string}>>} */
		listOpenPrs: () =>
			withListFallback(
				"listOpenPrs",
				PR_LIST_LIMIT,
				async () => {
					const out = await runGh([
						"pr",
						"list",
						"--state",
						"open",
						"--json",
						"number,title",
						"--limit",
						String(PR_LIST_LIMIT),
					]);
					return JSON.parse(out);
				},
				({ owner, repo, token }) =>
					fetchOpenPrs(owner, repo, token, fetchImpl, PR_LIST_LIMIT),
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
		 * The selected design-selection record comment's edit history.
		 * @param {{nodeId: string}} params
		 * @returns {Promise<{status: "edited" | "unedited", editedAtIso: string | null}>}
		 */
		designRecordEditInfo: ({ nodeId }) =>
			withFallback(
				"designRecordEditInfo",
				async () => {
					const out = await runGh(buildDesignRecordEditQuery({ nodeId }));
					return parseDesignRecordEditResponse(out);
				},
				({ token }) => fetchDesignRecordEditInfo(nodeId, token, fetchImpl),
				{ resolveOwnerRepo: false },
			),
	};
}
