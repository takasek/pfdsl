import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("documented dependency setup installs into the adopting repo, not its npm parent", () => {
	const dir = mkdtempSync(join(tmpdir(), "adopter-dependency-setup-"));
	try {
		const adopter = join(dir, "adopter");
		const source = join(dir, "fixture-yaml");
		mkdirSync(join(adopter, ".git"), { recursive: true });
		mkdirSync(source);
		writeFileSync(join(dir, "package.json"), '{"private":true}');
		mkdirSync(join(dir, "node_modules/parent-local"), { recursive: true });
		writeFileSync(join(dir, "node_modules/parent-local/keep"), "parent-owned");
		writeFileSync(
			join(source, "package.json"),
			'{"name":"yaml","version":"2.8.3"}',
		);
		const cache = join(dir, "cache");
		const pack = spawnSync(
			"npm",
			[
				"pack",
				"--ignore-scripts",
				"--json",
				"--cache",
				cache,
				"--pack-destination",
				dir,
			],
			{
				cwd: source,
				encoding: "utf8",
			},
		);
		assert.equal(pack.status, 0, pack.stdout + pack.stderr);
		const tarball = join(dir, JSON.parse(pack.stdout)[0].filename);
		const guide = readFileSync(
			join(root, ".claude/skills/pfd-ops/references/github-issues-backend.md"),
			"utf8",
		);
		const command = guide.match(/^npm install .*yaml@2\.8\.3$/m)?.[0];
		assert.ok(
			command,
			"The standalone-repo install command must be executable",
		);
		const args = command
			.split(" ")
			.slice(1)
			.map((arg) => (arg === "yaml@2.8.3" ? tarball : arg));
		// Substitute only the package source with an offline fixture; execute
		// the guide's real npm options and cwd against a parent npm project.
		const install = spawnSync("npm", [...args, "--offline", "--cache", cache], {
			cwd: adopter,
			encoding: "utf8",
		});
		assert.equal(install.status, 0, install.stdout + install.stderr);
		assert.equal(
			existsSync(join(adopter, "node_modules/yaml/package.json")),
			true,
		);
		assert.equal(existsSync(join(dir, "node_modules/yaml")), false);
		assert.equal(
			readFileSync(join(dir, "node_modules/parent-local/keep"), "utf8"),
			"parent-owned",
		);
		assert.equal(existsSync(join(adopter, "package.json")), false);
		assert.equal(existsSync(join(adopter, "package-lock.json")), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
