// DO NOT EDIT. Authoritative source: .claude/skills/pfd-ops/install/scripts/pfdsl/lib/github-rest.mjs.
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
// Safety bound on any paginated walk (see fetchAllPages). 100 pages x 100
// per page covers this repo's feeds by a wide margin; exceeding it means the
// `page` parameter isn't advancing, not that the repo got big.
const MAX_PAGES = 100;

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
	const pathPart = scpMatch
		? scpMatch[1]
		: stripped.replace(/^\w+:\/\/(?:[^/@]+@)?[^/]+/, "");
	const segments = pathPart.split("/").filter(Boolean);
	if (segments.length < 2) return null;
	return {
		owner: segments[segments.length - 2],
		repo: segments[segments.length - 1],
	};
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
	return apiLabels.map((l) => ({
		name: l.name,
		description: l.description ?? "",
	}));
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
			labels: (i.labels ?? []).map((l) => ({
				name: typeof l === "string" ? l : l.name,
			})),
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
		conclusion:
			run.status === "completed" && run.conclusion
				? run.conclusion.toUpperCase()
				: null,
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
		throw new Error(
			`GitHub REST API ${init?.method ?? "GET"} ${url} failed: ${res.status} ${await res.text()}`,
		);
	}
	return res;
}

/**
 * Fetch every page of a paginated list endpoint and concatenate the results.
 *
 * Terminates on a page shorter than `per_page`, per GitHub's pagination
 * contract — the transport delivers each page whole or throws
 * (proxy-fetch-worker.mjs parses the full body, so a partial array can't
 * reach us), and page numbering is offset-based, so a truncated page could
 * not be recovered by advancing anyway.
 *
 * `maxPages` bounds the walk so a layer that ignores the `page` parameter
 * (an over-eager stub or cache serving page 1 forever) can't spin here. It
 * throws rather than returning what it has: silently returning a truncated
 * list is exactly the failure #543 was about, and a caller that believes a
 * short list is complete makes wrong decisions from it.
 *
 * `getPageItems` extracts the array to accumulate from each response body
 * (identity for endpoints returning a bare array; a key selector for
 * enveloped ones like check-runs). Termination is keyed on that array, so
 * callers must pass the endpoint's raw page array and apply any
 * domain-specific filtering to the concatenated result — filtering here
 * would shorten a full page and stop the walk early.
 *
 * @param {typeof fetch} fetchImpl
 * @param {(page: number) => string} buildUrl  builds the endpoint URL for a 1-based page
 * @param {string} token
 * @param {(body: any) => any[]} [getPageItems]
 * @param {number} [maxPages]
 * @returns {Promise<any[]>}
 */
async function fetchAllPages(
	fetchImpl,
	buildUrl,
	token,
	getPageItems = (body) => body,
	maxPages = MAX_PAGES,
) {
	const all = [];
	for (let page = 1; page <= maxPages; page++) {
		const res = await request(fetchImpl, buildUrl(page), {
			headers: authHeaders({ token }),
		});
		const batch = getPageItems(await res.json());
		all.push(...batch);
		if (batch.length < PER_PAGE) return all;
	}
	throw new Error(
		`GitHub REST pagination exceeded ${maxPages} pages for ${buildUrl(1)} — no page shorter than ${PER_PAGE} was returned`,
	);
}

/**
 * `gh issue view --json <fields>` field names, and how to read each one out of
 * the REST issue payload. A field absent from here is one this fallback cannot
 * answer, and fetchIssueView says so rather than omitting the key: an object
 * missing a field the caller asked for is the silent shape mismatch that made
 * the fallback unusable in the first place (#745).
 *
 * `comments` is not here — it comes from its own endpoint, below.
 */
/**
 * Refuse a `--json` field this fallback has no mapping for, rather than
 * omitting it: an object missing a field the caller asked for is the silent
 * shape mismatch that made the fallback unusable in the first place (#745).
 * @param {string} verb gh's group and verb, for the message
 * @param {string[]} fields gh's --json field names
 * @param {Record<string, Function>} map the field map to check against
 * @param {string[]} [alsoKnown] answerable fields that live outside the map
 */
function requireMappableFields(verb, fields, map, alsoKnown = []) {
	const unknown = fields.filter((f) => !alsoKnown.includes(f) && !(f in map));
	if (unknown.length > 0) {
		throw new Error(
			`gh REST fallback cannot answer '${verb} --json' field(s): ${unknown.join(", ")}`,
		);
	}
}

const ISSUE_VIEW_FIELDS = {
	author: (issue) => ({ login: issue.user?.login }),
	body: (issue) => issue.body ?? "",
	createdAt: (issue) => issue.created_at,
	number: (issue) => issue.number,
	state: (issue) => issue.state,
	title: (issue) => issue.title,
	url: (issue) => issue.html_url,
};

/**
 * The REST equivalent of `gh issue view <n> --json <fields>`, shaped the way gh
 * would have printed it so callers parse one thing either way.
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {number} issueNumber
 * @param {string[]} fields gh's --json field names
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fetchIssueView(
	owner,
	repo,
	token,
	issueNumber,
	fields,
	fetchImpl = proxyAwareFetch,
) {
	// `comments` is answerable but comes from its own endpoint, so it is not in
	// the field map the rest are read from.
	requireMappableFields("issue view", fields, ISSUE_VIEW_FIELDS, ["comments"]);

	// The issue itself is only worth a request when something other than the
	// comments was asked for, and the two endpoints are independent — the
	// gh-less environment this serves pays for every extra round-trip, and the
	// one production caller asks for both together.
	const wantsIssue = fields.some((f) => f !== "comments");
	const [issue, comments] = await Promise.all([
		wantsIssue
			? request(
					fetchImpl,
					`${API_ROOT}/repos/${owner}/${repo}/issues/${issueNumber}`,
					{ headers: authHeaders({ token }) },
				).then((res) => res.json())
			: null,
		fields.includes("comments")
			? fetchAllPages(
					fetchImpl,
					(page) =>
						`${API_ROOT}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=${PER_PAGE}&page=${page}`,
					token,
				)
			: null,
	]);

	const result = {};
	for (const field of fields) {
		if (field !== "comments") result[field] = ISSUE_VIEW_FIELDS[field](issue);
	}
	if (comments) {
		result.comments = comments.map((c) => ({
			author: { login: c.user?.login },
			body: c.body ?? "",
			createdAt: c.created_at,
		}));
	}

	return result;
}

/**
 * `gh pr view --json <fields>` field names, for the subset this fallback can
 * answer. Same contract as ISSUE_VIEW_FIELDS: a field absent here is refused
 * rather than omitted.
 */
const PR_VIEW_FIELDS = {
	body: (pr) => pr.body ?? "",
	headRefName: (pr) => pr.head?.ref,
	number: (pr) => pr.number,
	state: (pr) => pr.state,
	title: (pr) => pr.title,
	url: (pr) => pr.html_url,
};

/**
 * The REST equivalent of `gh pr view --json <fields>` with no PR named — the
 * form that asks about the current branch's open PR.
 *
 * gh resolves the branch itself; over REST the branch has to be handed in and
 * looked up as a head ref. A branch with no open PR throws, matching gh's own
 * non-zero exit: the terminal gate distinguishes "no Size-Override written"
 * from "the body could not be read", and an empty body for the second case is
 * what collapsed them (#749).
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {string} branch head ref of the PR to find
 * @param {string[]} fields gh's --json field names
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fetchCurrentPrView(
	owner,
	repo,
	token,
	branch,
	fields,
	fetchImpl = proxyAwareFetch,
) {
	requireMappableFields("pr view", fields, PR_VIEW_FIELDS);

	const head = encodeURIComponent(`${owner}:${branch}`);
	const prs = await request(
		fetchImpl,
		`${API_ROOT}/repos/${owner}/${repo}/pulls?head=${head}&state=open`,
		{ headers: authHeaders({ token }) },
	).then((res) => res.json());

	const [pr] = prs;
	if (!pr) throw new Error(`no open pull request for branch '${branch}'`);

	const result = {};
	for (const field of fields) result[field] = PR_VIEW_FIELDS[field](pr);
	return result;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{name: string, description: string}[]>}
 */
export async function fetchAllLabels(
	owner,
	repo,
	token,
	fetchImpl = proxyAwareFetch,
) {
	const raw = await fetchAllPages(
		fetchImpl,
		(page) =>
			`${API_ROOT}/repos/${owner}/${repo}/labels?per_page=${PER_PAGE}&page=${page}`,
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
export async function fetchAllIssues(
	owner,
	repo,
	token,
	fetchImpl = proxyAwareFetch,
	limit = 500,
) {
	// The `limit` is on issues, matching `gh issue list --limit N`. It must be
	// counted *after* filtering out pull requests, which the REST `/issues`
	// feed interleaves: counting raw entries capped the walk at `limit`
	// issues+PRs combined, so once the repo passed that many entries the
	// oldest issues were never fetched (#543 — 500 raw entries yielded only
	// 175 issues, hiding everything below #43).
	//
	// This keeps its own loop rather than reusing fetchAllPages so that
	// "collected enough issues" and "pagination isn't advancing" stay
	// distinct: a repo whose feed is mostly PRs legitimately needs more than
	// limit/PER_PAGE pages to reach `limit` issues, so a limit-derived page
	// bound would reject a healthy walk. Short page = end of feed; MAX_PAGES
	// = the `page` parameter isn't advancing. Filtering happens per page but
	// termination keys on the raw batch, so an all-PR page can't look short.
	const issues = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const res = await request(
			fetchImpl,
			`${API_ROOT}/repos/${owner}/${repo}/issues?state=all&per_page=${PER_PAGE}&page=${page}`,
			{ headers: authHeaders({ token }) },
		);
		const batch = await res.json();
		issues.push(...mapIssuesResponse(batch));
		if (batch.length < PER_PAGE || issues.length >= limit)
			return issues.slice(0, limit);
	}
	throw new Error(
		`GitHub REST pagination exceeded ${MAX_PAGES} pages listing issues for ${owner}/${repo} — no page shorter than ${PER_PAGE} was returned`,
	);
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
export async function createLabel(
	owner,
	repo,
	token,
	name,
	description,
	color,
	fetchImpl = proxyAwareFetch,
) {
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
export async function editLabel(
	owner,
	repo,
	token,
	name,
	description,
	fetchImpl = proxyAwareFetch,
) {
	await request(
		fetchImpl,
		`${API_ROOT}/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`,
		{
			method: "PATCH",
			headers: {
				...authHeaders({ token }),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ description }),
		},
	);
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {number} issueNumber
 * @param {string} label
 * @param {typeof fetch} [fetchImpl]
 */
export async function addIssueLabel(
	owner,
	repo,
	token,
	issueNumber,
	label,
	fetchImpl = proxyAwareFetch,
) {
	await request(
		fetchImpl,
		`${API_ROOT}/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
		{
			method: "POST",
			headers: {
				...authHeaders({ token }),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ labels: [label] }),
		},
	);
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {string} sha
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{conclusion: string|null}[]>}
 */
async function fetchCiRollupForSha(
	owner,
	repo,
	token,
	sha,
	fetchImpl = proxyAwareFetch,
) {
	const checkRuns = await fetchAllPages(
		fetchImpl,
		(page) =>
			`${API_ROOT}/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=${PER_PAGE}&page=${page}`,
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
export async function fetchOpenPrsWithCi(
	owner,
	repo,
	token,
	fetchImpl = proxyAwareFetch,
) {
	const prs = await fetchAllPages(
		fetchImpl,
		(page) =>
			`${API_ROOT}/repos/${owner}/${repo}/pulls?state=open&per_page=${PER_PAGE}&page=${page}`,
		token,
	);
	return Promise.all(
		prs.map(async (pr) => ({
			number: pr.number,
			title: pr.title,
			headRefName: pr.head.ref,
			statusCheckRollup: await fetchCiRollupForSha(
				owner,
				repo,
				token,
				pr.head.sha,
				fetchImpl,
			),
		})),
	);
}
