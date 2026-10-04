/**
 * Thin wrapper around `execFileSync("gh", args)`: the gh-CLI backend
 * github-ops.mjs's named operations run against (#1044). GH_HOST is pinned
 * to this repo's own remote host, so an ambient GH_HOST pointing at a
 * different host (a multi-host `gh` login) doesn't make gh reject the repo.
 * Falls back to the ambient env when the host can't be determined.
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
import { parseHost } from "./github-rest.mjs";

/**
 * The host `gh` should target for this repo, derived from its origin remote.
 * Returns null if it can't be determined (no git, no origin) — callers then
 * leave the ambient environment untouched.
 * @param {string} cwd
 * @returns {string | null}
 */
function hostFromGitRemote(cwd) {
	try {
		const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
			cwd,
			encoding: "utf-8",
		}).trim();
		return parseHost(remoteUrl);
	} catch {
		return null;
	}
}

/**
 * @param {string[]} args - the same argv you'd pass to execFileSync("gh", args)
 * @param {{cwd?: string}} [opts]
 * @returns {Promise<string>}
 */
export async function execGh(args, opts = {}) {
	const cwd = opts.cwd ?? process.cwd();
	const host = hostFromGitRemote(cwd);
	const env = host ? { ...process.env, GH_HOST: host } : process.env;
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
			const names = process.platform === "win32" ? ["gh.exe", "gh"] : ["gh"];
			const installed = (env.PATH ?? "").split(delimiter).some((dir) =>
				names.some((name) => {
					try {
						return statSync(resolve(cwd, dir, name)).isFile();
					} catch {
						return false;
					}
				}),
			);
			if (installed)
				throw new Error(`installed gh CLI could not start: ${error.message}`, {
					cause: error,
				});
		}
		throw error;
	}
}
