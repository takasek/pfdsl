/**
 * Thin wrapper around `execFileSync("gh", args)`: the gh-CLI backend
 * github-ops.mjs's named operations run against (#1044). GH_HOST and GH_REPO
 * are pinned to the shared repository selection used for location matching.
 *
 * Genuine binary absence preserves execFileSync's ENOENT; a missing cwd or
 * an installed command's launch failure remains a real error. github-ops.mjs
 * recognizes backend absence and decides whether to fall back to HTTP.
 *
 * Production code must reach this only through github-ops.mjs — see
 * scripts/check-script-imports.mjs, which enforces that boundary.
 */

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { resolveRepository } from "./repository-identity.mjs";

/** Check presence without running a repository-dependent operation. */
function ghInstalled(cwd, env) {
	const names = process.platform === "win32" ? ["gh.exe", "gh"] : ["gh"];
	return (env.PATH ?? "").split(delimiter).some((dir) =>
		names.some((name) => {
			try {
				return statSync(resolve(cwd, dir, name)).isFile();
			} catch {
				return false;
			}
		}),
	);
}

/**
 * @param {string[]} args - the same argv you'd pass to execFileSync("gh", args)
 * @param {{cwd?: string, repository?: () => {host: string, owner: string, repo: string}}} [opts]
 * @returns {Promise<string>}
 */
export async function execGh(args, opts = {}) {
	const cwd = opts.cwd ?? process.cwd();
	try {
		statSync(cwd);
	} catch (cause) {
		throw new Error(
			`could not access gh working directory ${cwd}: ${cause.message}`,
			{ cause },
		);
	}
	// Resolve only when a CLI exists. True absence must retain the operation's
	// unavailable/HTTP fallback behavior even outside a usable Git checkout.
	const repository = ghInstalled(cwd, process.env)
		? (opts.repository?.() ?? resolveRepository(cwd).identity)
		: null;
	const env = repository
		? {
				...process.env,
				GH_HOST: repository.host,
				GH_REPO: `${repository.host}/${repository.owner}/${repository.repo}`,
			}
		: process.env;
	try {
		return execFileSync("gh", args, { cwd, encoding: "utf-8", env });
	} catch (error) {
		if (error.code === "ENOENT") {
			// spawn uses ENOENT for a deleted cwd too; it is a caller failure.
			try {
				statSync(cwd);
			} catch (cause) {
				throw new Error(
					`could not access gh working directory ${cwd}: ${cause.message}`,
					{ cause },
				);
			}
			const installed = ghInstalled(cwd, env);
			if (installed)
				throw new Error(`installed gh CLI could not start: ${error.message}`, {
					cause: error,
				});
		}
		throw error;
	}
}
