import { execFileSync } from "node:child_process";
import { parseRepositoryIdentity } from "./github-rest.mjs";

const normalizeHost = (host) => host.toLowerCase().replace(/^www\./, "");

function explicitRepository(value, defaultHost) {
	const text = value
		.trim()
		.replace(/^https:\/\//, "")
		.replace(/\/$/, "");
	const parts = text.split("/");
	if (parts.length === 2) parts.unshift(defaultHost);
	if (parts.length !== 3 || !parts.every((part) => /^[\w.:-]+$/.test(part)))
		throw new Error(
			"invalid repository selection; use GH_REPO=[HOST/]OWNER/REPO",
		);
	const [rawHost, owner, rawRepo] = parts;
	const host = normalizeHost(rawHost);
	const repo = value.trim().startsWith("https://")
		? rawRepo.replace(/\.git$/, "")
		: rawRepo;
	return {
		identity: { host, owner, repo },
		httpSupported: host.toLowerCase() === "github.com",
	};
}

/** Resolve once for CLI, HTTP and location matching; never infer a fork's parent. */
export function resolveRepository(cwd) {
	if (process.env.GH_REPO)
		return explicitRepository(
			process.env.GH_REPO,
			process.env.GH_HOST || "github.com",
		);
	const git = (args) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	let defaults;
	try {
		defaults = git(["config", "--get-regexp", "^remote\\..*\\.gh-resolved$"]);
	} catch (error) {
		if (error.status !== 1)
			throw new Error(`could not read repository selection: ${error.message}`, {
				cause: error,
			});
		defaults = "";
	}
	const selections = defaults
		.split("\n")
		.filter(Boolean)
		.map((line) => line.match(/^remote\.(.+)\.gh-resolved\s+(.+)$/))
		.filter(Boolean);
	if (selections.length > 1)
		throw new Error(
			"multiple default repositories configured; select one with GH_REPO=[HOST/]OWNER/REPO",
		);
	const remote = selections[0]?.[1] ?? "origin";
	let remoteUrl;
	try {
		remoteUrl = git(["remote", "get-url", remote]);
	} catch (error) {
		throw new Error(
			`could not read the git remote '${remote}' to resolve owner/repo: ${error.message}`,
			{ cause: error },
		);
	}
	const resolved = parseRepositoryIdentity(remoteUrl);
	if (!resolved)
		throw new Error(
			"could not determine host/owner/repo from git remote; set GH_REPO=[HOST/]OWNER/REPO",
		);
	if (/^ssh:\/\//.test(remoteUrl) || /^[\w.-]+@[^:]+:/.test(remoteUrl)) {
		const host = resolved.identity.host;
		try {
			const output = execFileSync("ssh", ["-G", "--", host], {
				cwd,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			const hostname = output.match(/^hostname\s+(\S+)\s*$/m)?.[1];
			if (!hostname) throw new Error("SSH hostname is missing");
			resolved.identity.host =
				hostname.toLowerCase() === "ssh.github.com" ? "github.com" : hostname;
		} catch (error) {
			throw new Error(
				`could not resolve SSH host '${host}'; set GH_REPO=[HOST/]OWNER/REPO: ${error.message}`,
				{ cause: error },
			);
		}
		resolved.httpSupported =
			resolved.identity.host.toLowerCase() === "github.com";
	}
	const selection = selections[0]?.[2];
	resolved.identity.host = normalizeHost(resolved.identity.host);
	resolved.httpSupported = resolved.identity.host === "github.com";
	return selection && selection !== "base"
		? explicitRepository(selection, resolved.identity.host)
		: resolved;
}
