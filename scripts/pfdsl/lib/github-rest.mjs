/**
 * GitHub REST API fallback for the small subset of `gh` operations this
 * repo's scripts use. Used by gh-exec.mjs's execGh when the `gh` binary is
 * missing but a GH_TOKEN/GITHUB_TOKEN is available (Claude Code Remote
 * sessions: no `gh` binary, but the GitHub MCP server's token is exported
 * into the environment). See #489, #492.
 *
 * Response-mapping functions below are pure (testable without network); the
 * fetch* functions accept a fetchImpl for injection in tests.
 */

import { proxyAwareFetch } from "./proxy-fetch.mjs";

const API_ROOT = "https://api.github.com";
const PER_PAGE = 100;

/**
 * Extract {owner, repo} from a git remote URL. Handles https, git@ scp-like,
 * and reverse-proxied remotes (this environment's origin is rewritten to a
 * local proxy, e.g. "http://local_proxy@127.0.0.1:41729/git/owner/repo") —
 * in every case the last two path segments are owner/repo.
 * @param {string} remoteUrl
 * @returns {{owner: string, repo: string} | null}
 */
export function parseOwnerRepo(remoteUrl) {
	const stripped = remoteUrl.trim().replace(/\.git$/, "");
	const scpMatch = stripped.match(/^[\w.-]+@[\w.-]+:(.+)$/);
	const pathPart = scpMatch ? scpMatch[1] : stripped.replace(/^\w+:\/\/(?:[^/@]+@)?[^/]+/, "");
	const segments = pathPart.split("/").filter(Boolean);
	if (segments.length < 2) return null;
	return { owner: segments[segments.length - 2], repo: segments[segments.length - 1] };
}

/**
 * Extract the host (authority minus userinfo, keeping an explicit port) from a
 * git remote URL. Handles https, ssh://, and git@ scp-like forms. This is the
 * host `gh` must target: deriving it from the repo's own remote lets callers
 * pin GH_HOST to the repo, neutralizing an ambient GH_HOST that points at a
 * different host (a multi-host `gh` login otherwise fails with "none of the
 * git remotes ... correspond to the GH_HOST environment variable").
 * @param {string} remoteUrl
 * @returns {string | null}
 */
export function parseHost(remoteUrl) {
	const url = remoteUrl.trim();
	const scp = url.match(/^[\w.-]+@([\w.-]+(?::\d+)?):/);
	if (scp) return scp[1];
	const schemeMatch = url.match(/^\w+:\/\/(?:[^/@]+@)?([^/]+)/);
	if (schemeMatch) return schemeMatch[1];
	return null;
}

/**
 * @param {{name: string, description?: string|null}[]} apiLabels
 * @returns {{name: string, description: string}[]}
 */
export function mapLabelsResponse(apiLabels) {
	return apiLabels.map((l) => ({ name: l.name, description: l.description ?? "" }));
}

/**
 * Maps GitHub REST `GET /issues` entries to the shape gh CLI's
 * `issue list --json number,state,stateReason,labels,updatedAt` produces.
 * The REST issues endpoint also returns pull requests — those carry a
 * `pull_request` key and are filtered out, matching gh's own `issue list`.
 * @param {Array<Record<string, unknown>>} apiIssues
 * @returns {Array<{number: number, state: string, stateReason: string|null, labels: {name: string}[], updatedAt: string}>}
 */
export function mapIssuesResponse(apiIssues) {
	return apiIssues
		.filter((i) => !i.pull_request)
		.map((i) => ({
			number: i.number,
			state: String(i.state).toUpperCase(),
			stateReason: i.state_reason ? String(i.state_reason).toUpperCase() : null,
			labels: (i.labels ?? []).map((l) => ({ name: typeof l === "string" ? l : l.name })),
			updatedAt: i.updated_at,
		}));
}

/**
 * Maps a GitHub REST check-runs list into gh's statusCheckRollup shape
 * (an array of {conclusion}). Approximates gh's GraphQL rollup — it only
 * considers check-runs (GitHub Actions), not legacy commit statuses.
 * @param {Array<{status: string, conclusion: string|null}>} checkRuns
 * @returns {{conclusion: string|null}[]}
 */
export function mapCheckRunsToRollup(checkRuns) {
	return checkRuns.map((run) => ({
		conclusion: run.status === "completed" && run.conclusion ? run.conclusion.toUpperCase() : null,
	}));
}

/**
 * @param {{token: string}} auth
 * @returns {Record<string, string>}
 */
function authHeaders({ token }) {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"User-Agent": "pfdsl-scripts-gh-fallback",
	};
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} init
 */
async function request(fetchImpl, url, init) {
	const res = await fetchImpl(url, init);
	if (!res.ok) {
		throw new Error(`GitHub REST API ${init?.method ?? "GET"} ${url} failed: ${res.status} ${await res.text()}`);
	}
	return res;
}

/**
 * Fetch every page of a paginated list endpoint and concatenate the results.
 *
 * Termination is on an **empty** page, never on a short one. GitHub's own
 * contract lets a `< per_page` page signal the end, but this repo's fallback
 * runs behind a proxy (proxy-fetch.mjs delegates each request to a child
 * process) that can return a short — but non-final — page mid-stream; a
 * `batch.length < perPage` break would then silently truncate the feed and
 * drop the oldest items (#543). Only a zero-length page reliably means the
 * end.
 *
 * `getPageItems` extracts the array to accumulate from each response body
 * (identity for endpoints that return a bare array; a key selector for
 * enveloped ones like check-runs). Termination is keyed on that same array,
 * so callers must pass the endpoint's raw page array here and do any
 * domain-specific filtering on the concatenated result — filtering inside
 * the extractor could make a non-final page look empty and stop early.
 *
 * @param {typeof fetch} fetchImpl
 * @param {(page: number) => string} buildUrl  builds the endpoint URL for a 1-based page
 * @param {string} token
 * @param {(body: any) => any[]} [getPageItems]
 * @returns {Promise<any[]>}
 */
async function fetchAllPages(fetchImpl, buildUrl, token, getPageItems = (body) => body) {
	const all = [];
	for (let page = 1; ; page++) {
		const res = await request(fetchImpl, buildUrl(page), { headers: authHeaders({ token }) });
		const batch = getPageItems(await res.json());
		if (batch.length === 0) break;
		all.push(...batch);
	}
	return all;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{name: string, description: string}[]>}
 */
export async function fetchAllLabels(owner, repo, token, fetchImpl = proxyAwareFetch) {
	const raw = await fetchAllPages(
		fetchImpl,
		(page) => `${API_ROOT}/repos/${owner}/${repo}/labels?per_page=${PER_PAGE}&page=${page}`,
		token,
	);
	return mapLabelsResponse(raw);
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @param {number} [limit]
 * @returns {Promise<ReturnType<typeof mapIssuesResponse>>}
 */
export async function fetchAllIssues(owner, repo, token, fetchImpl = proxyAwareFetch, limit = 500) {
	// The `limit` is on issues, matching `gh issue list --limit N`. It must be
	// counted *after* filtering out pull requests (the REST `/issues` feed
	// interleaves them): counting raw entries capped the feed at ~limit
	// issues+PRs, dropping the oldest issues once the repo grew past `limit`
	// combined entries (#543). Pagination terminates on an empty page, so a
	// short non-final page can no longer end the loop early.
	const issues = [];
	for (let page = 1; issues.length < limit; page++) {
		const res = await request(
			fetchImpl,
			`${API_ROOT}/repos/${owner}/${repo}/issues?state=all&per_page=${PER_PAGE}&page=${page}`,
			{ headers: authHeaders({ token }) },
		);
		const batch = await res.json();
		if (batch.length === 0) break;
		issues.push(...mapIssuesResponse(batch));
	}
	return issues.slice(0, limit);
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {string} name
 * @param {string} [description]
 * @param {string} [color]
 * @param {typeof fetch} [fetchImpl]
 */
export async function createLabel(owner, repo, token, name, description, color, fetchImpl = proxyAwareFetch) {
	await request(fetchImpl, `${API_ROOT}/repos/${owner}/${repo}/labels`, {
		method: "POST",
		headers: { ...authHeaders({ token }), "Content-Type": "application/json" },
		body: JSON.stringify({ name, description, color }),
	});
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {string} name
 * @param {string} [description]
 * @param {typeof fetch} [fetchImpl]
 */
export async function editLabel(owner, repo, token, name, description, fetchImpl = proxyAwareFetch) {
	await request(fetchImpl, `${API_ROOT}/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, {
		method: "PATCH",
		headers: { ...authHeaders({ token }), "Content-Type": "application/json" },
		body: JSON.stringify({ description }),
	});
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {number} issueNumber
 * @param {string} label
 * @param {typeof fetch} [fetchImpl]
 */
export async function addIssueLabel(owner, repo, token, issueNumber, label, fetchImpl = proxyAwareFetch) {
	await request(fetchImpl, `${API_ROOT}/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
		method: "POST",
		headers: { ...authHeaders({ token }), "Content-Type": "application/json" },
		body: JSON.stringify({ labels: [label] }),
	});
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {number} issueNumber
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function getIssueBody(owner, repo, token, issueNumber, fetchImpl = proxyAwareFetch) {
	const res = await request(fetchImpl, `${API_ROOT}/repos/${owner}/${repo}/issues/${issueNumber}`, {
		headers: authHeaders({ token }),
	});
	const issue = await res.json();
	return issue.body ?? "";
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {string} sha
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{conclusion: string|null}[]>}
 */
async function fetchCiRollupForSha(owner, repo, token, sha, fetchImpl = proxyAwareFetch) {
	const checkRuns = await fetchAllPages(
		fetchImpl,
		(page) => `${API_ROOT}/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=${PER_PAGE}&page=${page}`,
		token,
		(body) => body.check_runs ?? [],
	);
	return mapCheckRunsToRollup(checkRuns);
}

/**
 * Approximates `gh pr list --state open --json number,title,headRefName,statusCheckRollup`.
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Array<{number: number, title: string, headRefName: string, statusCheckRollup: {conclusion: string|null}[]}>>}
 */
export async function fetchOpenPrsWithCi(owner, repo, token, fetchImpl = proxyAwareFetch) {
	const prs = await fetchAllPages(
		fetchImpl,
		(page) => `${API_ROOT}/repos/${owner}/${repo}/pulls?state=open&per_page=${PER_PAGE}&page=${page}`,
		token,
	);
	return Promise.all(
		prs.map(async (pr) => ({
			number: pr.number,
			title: pr.title,
			headRefName: pr.head.ref,
			statusCheckRollup: await fetchCiRollupForSha(owner, repo, token, pr.head.sha, fetchImpl),
		})),
	);
}
