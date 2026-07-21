/**
 * Drop-in replacement for `execFileSync("gh", args)`: tries the real gh CLI
 * first (unchanged behavior when it's installed), and falls back to the
 * GitHub REST API when gh is missing (ENOENT) and a GH_TOKEN/GITHUB_TOKEN is
 * available — e.g. Claude Code Remote sessions, which export the GitHub MCP
 * server's token but have no gh binary. See #489, #492.
 *
 * Callers keep parsing the returned string exactly as they did for gh's own
 * stdout (JSON text for --json flags, raw text for --jq .field).
 */

import { execFileSync } from "node:child_process";
import { isGhUnavailableError, planGhRestCall } from "./gh-compat.mjs";
import {
	parseOwnerRepo,
	parseHost,
	fetchAllLabels,
	fetchAllIssues,
	createLabel,
	editLabel,
	addIssueLabel,
	getIssueBody,
	fetchOpenPrsWithCi,
} from "./github-rest.mjs";

/**
 * @param {string} cwd
 * @returns {{owner: string, repo: string}}
 */
function ownerRepoFromGitRemote(cwd) {
	const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf-8" }).trim();
	const ownerRepo = parseOwnerRepo(remoteUrl);
	if (!ownerRepo) throw new Error(`could not determine owner/repo from git remote: ${remoteUrl}`);
	return ownerRepo;
}

/**
 * The host `gh` should target for this repo, derived from its origin remote.
 * Returns null if it can't be determined (no git, no origin) — callers then
 * leave the ambient environment untouched.
 * @param {string} cwd
 * @returns {string | null}
 */
function hostFromGitRemote(cwd) {
	try {
		const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf-8" }).trim();
		return parseHost(remoteUrl);
	} catch {
		return null;
	}
}

/**
 * @param {{op: string, [key: string]: unknown}} plan
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function runGhRestPlan(plan, cwd, token) {
	const { owner, repo } = ownerRepoFromGitRemote(cwd);

	switch (plan.op) {
		case "listLabels":
			return JSON.stringify(await fetchAllLabels(owner, repo, token));
		case "createLabel":
			await createLabel(owner, repo, token, plan.name, plan.description, plan.color);
			return "";
		case "editLabel":
			await editLabel(owner, repo, token, plan.name, plan.description);
			return "";
		case "listIssues":
			return JSON.stringify(await fetchAllIssues(owner, repo, token));
		case "addIssueLabel":
			await addIssueLabel(owner, repo, token, plan.number, plan.label);
			return "";
		case "getIssueBody":
			return await getIssueBody(owner, repo, token, plan.number);
		case "listOpenPrsWithCi":
			return JSON.stringify(await fetchOpenPrsWithCi(owner, repo, token));
		default:
			throw new Error(`unhandled gh REST plan op: ${plan.op}`);
	}
}

/**
 * @param {string[]} args - the same argv you'd pass to execFileSync("gh", args)
 * @param {{cwd?: string}} [opts]
 * @returns {Promise<string>}
 */
export async function execGh(args, opts = {}) {
	const cwd = opts.cwd ?? process.cwd();
	try {
		// Pin GH_HOST to this repo's own remote host so an ambient GH_HOST
		// pointing at a different host (a multi-host `gh` login) doesn't make
		// gh reject the repo. Falls back to the ambient env when undeterminable.
		const host = hostFromGitRemote(cwd);
		const env = host ? { ...process.env, GH_HOST: host } : process.env;
		return execFileSync("gh", args, { cwd, encoding: "utf-8", env });
	} catch (e) {
		if (!isGhUnavailableError(e)) throw e;
		// Rethrow the original ENOENT (rather than a new error) whenever REST
		// fallback isn't possible, so callers' isGhUnavailableError(e) still
		// recognizes "truly unavailable" and can degrade gracefully.
		const plan = planGhRestCall(args);
		if (!plan) throw e;
		const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
		if (!token) throw e;
		return await runGhRestPlan(plan, cwd, token);
	}
}
