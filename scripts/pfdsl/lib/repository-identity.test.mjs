import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { createGitHubOps } from "./github-ops.mjs";
import { parseRepositoryIdentity } from "./github-rest.mjs";
import { issueNumbersOfLocation } from "./issues-flow-audit.mjs";

for (const selection of [
	"GH_REPO",
	"GH_REPO-www",
	"GH_REPO-url",
	"default-remote",
	"default-repository",
	"ssh-port",
	"ssh-alias",
	"ssh-public-alternate",
]) {
	it(`uses one repository for CLI, HTTP and links: ${selection}`, async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pfd-repository-selection-"));
		const saved = {
			GH_REPO: process.env.GH_REPO,
			GH_HOST: process.env.GH_HOST,
			GH_TOKEN: process.env.GH_TOKEN,
			PATH: process.env.PATH,
		};
		try {
			delete process.env.GH_REPO;
			delete process.env.GH_HOST;
			process.env.GH_TOKEN = "fixture-token";
			execFileSync("git", ["init", "-q", cwd]);
			let remote = "https://github.com/fork/app.git";
			if (selection === "ssh-port")
				remote = "ssh://git@github.com:2222/upstream/app.git";
			if (selection === "ssh-alias")
				remote = "git@work-github:upstream/app.git";
			if (selection === "ssh-public-alternate")
				remote = "ssh://git@ssh.github.com:443/upstream/app.git";
			execFileSync("git", ["-C", cwd, "remote", "add", "origin", remote]);
			if (selection === "GH_REPO")
				process.env.GH_REPO = "github.com/upstream/app";
			if (selection === "GH_REPO-www")
				process.env.GH_REPO = "www.github.com/upstream/app";
			if (selection === "GH_REPO-url")
				process.env.GH_REPO = "https://github.com/upstream/app.git";
			if (selection === "default-remote") {
				execFileSync("git", [
					"-C",
					cwd,
					"remote",
					"add",
					"upstream",
					"https://github.com/upstream/app.git",
				]);
				execFileSync("git", [
					"-C",
					cwd,
					"config",
					"remote.upstream.gh-resolved",
					"base",
				]);
			}
			if (selection === "default-repository")
				execFileSync("git", [
					"-C",
					cwd,
					"config",
					"remote.origin.gh-resolved",
					"upstream/app",
				]);
			// No personal SSH settings or network: only this fixture's hostname output.
			writeFileSync(
				join(cwd, "ssh"),
				`#!/bin/sh\nprintf 'hostname ${selection === "ssh-public-alternate" ? "ssh.github.com" : "github.com"}\\nport 2222\\n'\n`,
				{ mode: 0o755 },
			);
			process.env.PATH = `${cwd}:${saved.PATH}`;
			const expected = { host: "github.com", owner: "upstream", repo: "app" };
			const cli = createGitHubOps({
				cwd,
				execGhImpl: async (_args, opts) => {
					assert.deepEqual(
						typeof opts.repository === "function"
							? opts.repository()
							: opts.repository,
						expected,
					);
					return '{"number":7}';
				},
			});
			assert.deepEqual(cli.repository(), expected);
			assert.deepEqual(
				issueNumbersOfLocation(
					"https://github.com/upstream/app/issues/7",
					cli.repository(),
				),
				[7],
			);
			await cli.viewIssue({ number: 7, fields: ["number"] });
			const http = createGitHubOps({
				cwd,
				execGhImpl: async () => {
					throw Object.assign(new Error("absent"), { code: "ENOENT" });
				},
				fetchImpl: async (url) => {
					assert.equal(
						url,
						"https://api.github.com/repos/upstream/app/issues/7",
					);
					return { ok: true, json: async () => ({ number: 7 }) };
				},
			});
			await http.viewIssue({ number: 7, fields: ["number"] });
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			rmSync(cwd, { recursive: true, force: true });
		}
	});
}

it("keeps HTTPS authority ports separate from SSH transport ports", () => {
	assert.equal(
		parseRepositoryIdentity("https://enterprise.example:8443/acme/app.git")
			.identity.host,
		"enterprise.example:8443",
	);
	assert.equal(
		parseRepositoryIdentity("ssh://git@enterprise.example:2222/acme/app.git")
			.identity.host,
		"enterprise.example",
	);
});

for (const selection of [
	"invalid-explicit",
	"conflicting-defaults",
	"invalid-default",
]) {
	it(`rejects ${selection} without querying origin's issues`, async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pfd-repository-invalid-"));
		const saved = process.env.GH_REPO;
		try {
			delete process.env.GH_REPO;
			execFileSync("git", ["init", "-q", cwd]);
			execFileSync("git", [
				"-C",
				cwd,
				"remote",
				"add",
				"origin",
				"https://github.com/fork/app.git",
			]);
			if (selection === "invalid-explicit") process.env.GH_REPO = "invalid";
			else {
				execFileSync("git", [
					"-C",
					cwd,
					"config",
					"remote.origin.gh-resolved",
					selection === "invalid-default" ? "invalid" : "base",
				]);
				if (selection === "conflicting-defaults")
					execFileSync("git", [
						"-C",
						cwd,
						"config",
						"remote.upstream.gh-resolved",
						"base",
					]);
			}
			const ops = createGitHubOps({ cwd });
			assert.throws(
				() => ops.repository(),
				/invalid repository selection|multiple default repositories/,
			);
		} finally {
			if (saved === undefined) delete process.env.GH_REPO;
			else process.env.GH_REPO = saved;
			rmSync(cwd, { recursive: true, force: true });
		}
	});
}
