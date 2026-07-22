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
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{name: string, description: string}[]>}
 */
export async function fetchAllLabels(owner, repo, token, fetchImpl = proxyAwareFetch) {
	const res = await request(fetchImpl, `${API_ROOT}/repos/${owner}/${repo}/labels?per_page=100`, {
		headers: authHeaders({ token }),
	});
	return mapLabelsResponse(await res.json());
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
	const perPage = 100;
	const all = [];
	for (let page = 1; all.length < limit; page++) {
		const res = await request(
			fetchImpl,
			`${API_ROOT}/repos/${owner}/${repo}/issues?state=all&per_page=${perPage}&page=${page}`,
			{ headers: authHeaders({ token }) },
		);
		const batch = await res.json();
		all.push(...batch);
		if (batch.length < perPage) break;
	}
	return mapIssuesResponse(all.slice(0, limit));
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
	const res = await request(fetchImpl, `${API_ROOT}/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, {
		headers: authHeaders({ token }),
	});
	const { check_runs } = await res.json();
	return mapCheckRunsToRollup(check_runs ?? []);
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
	const res = await request(fetchImpl, `${API_ROOT}/repos/${owner}/${repo}/pulls?state=open&per_page=100`, {
		headers: authHeaders({ token }),
	});
	const prs = await res.json();
	return Promise.all(
		prs.map(async (pr) => ({
			number: pr.number,
			title: pr.title,
			headRefName: pr.head.ref,
			statusCheckRollup: await fetchCiRollupForSha(owner, repo, token, pr.head.sha, fetchImpl),
		})),
	);
}
