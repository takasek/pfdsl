import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	acquireSetupLock,
	isSetupCurrent,
	setupFingerprint,
	setupInputs,
	setupLockPath,
	writeSetupMarker,
} from "../setup-completion.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const makefile = join(root, "Makefile");
const sentinel = "node_modules/.pfdsl-setup-complete";
const cp = "/bin/cp";
const chmod = "/bin/chmod";
const fixtures = [];

function sessionStartCommand(path) {
	const settings = JSON.parse(readFileSync(join(root, path), "utf8"));
	return settings.hooks.SessionStart[0].hooks[0].command;
}

function fixture() {
	const cwd = mkdtempSync(join(tmpdir(), "setup-completion-"));
	fixtures.push(cwd);
	assert.equal(spawnSync("/usr/bin/git", ["init", "-q", cwd]).status, 0);
	const bin = join(cwd, "bin");
	const log = join(cwd, "setup.log");
	mkdirSync(join(cwd, "scripts/hooks"), { recursive: true });
	mkdirSync(join(cwd, "scripts/lib"), { recursive: true });
	mkdirSync(bin);
	symlinkSync(makefile, join(cwd, "Makefile"));
	const shim = readFileSync(join(root, "scripts/hooks/pre-commit-shim"));
	writeFileSync(join(cwd, "scripts/hooks/pre-commit-shim"), shim);
	writeFileSync(join(cwd, ".git/hooks/pre-commit"), shim, {
		mode: 0o755,
	});
	writeFileSync(join(cwd, "scripts/pre-commit"), "#!/bin/sh\n", {
		mode: 0o755,
	});
	for (const entry of ["scripts/hooks/check-default-branch"]) {
		writeFileSync(join(cwd, entry), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	}
	for (const path of [
		"scripts/shared-hooks.mjs",
		"scripts/link-repo-skill.mjs",
		"scripts/lib/repo-skill-link.mjs",
	])
		writeFileSync(join(cwd, path), readFileSync(join(root, path)));
	installSkill(cwd);
	writeFileSync(
		join(cwd, "scripts/setup-completion.mjs"),
		readFileSync(join(root, "scripts/setup-completion.mjs")),
	);
	writeFileSync(
		join(cwd, "scripts/lib/cli-entrypoint.mjs"),
		readFileSync(join(root, "scripts/lib/cli-entrypoint.mjs")),
	);
	writeFileSync(join(cwd, "package.json"), "{}\n");
	writeFileSync(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
	writeFileSync(join(cwd, "pnpm-workspace.yaml"), "packages: []\n");

	for (const [name, source] of Object.entries({
		pnpm: '#!/bin/sh\nprintf \'pnpm\\n\' >> "$SETUP_LOG"\n[ -d "$SETUP_EXPECT_LOCK" ] || exit 97\n[ -n "$SETUP_READY_FILE" ] && : > "$SETUP_READY_FILE"\nif [ -n "$SETUP_RELEASE_FILE" ]; then while [ ! -f "$SETUP_RELEASE_FILE" ]; do /bin/sleep 0.02; done; fi\n[ "$SETUP_FAIL_STAGE" = pnpm ] && exit 1\nmkdir -p node_modules\nif [ -n "$SETUP_LINK_PATH" ]; then mkdir -p "$SETUP_LINK_PATH"; printf "%s\\n" "{\\"bin\\":{\\"fixture-command\\":\\"cli.js\\"}}" > "$SETUP_LINK_PATH/package.json"; mkdir -p "$(dirname "$SETUP_LINK_PATH")/.bin"; : > "$(dirname "$SETUP_LINK_PATH")/.bin/fixture-command"; "$REAL_CHMOD" 755 "$(dirname "$SETUP_LINK_PATH")/.bin/fixture-command"; fi\n[ -d "$SETUP_EXPECT_LOCK" ] || exit 98\n',
		// setup-completion.mjs reads Git state through the real git; only the
		// Makefile's own common-dir lookup is logged and can be failed.
		git: '#!/bin/sh\ncase "$1 $2" in "config "*|"rev-parse --path-format=absolute") exec /usr/bin/git "$@";; esac\nprintf \'git\\n\' >> "$SETUP_LOG"\n[ "$SETUP_FAIL_STAGE" = git ] && exit 1\nprintf \'.git\\n\'\n',
		cp: '#!/bin/sh\nprintf \'cp\\n\' >> "$SETUP_LOG"\n[ "$SETUP_FAIL_STAGE" = cp ] && exit 1\nexec "$REAL_CP" "$@"\n',
		chmod:
			'#!/bin/sh\nprintf \'chmod\\n\' >> "$SETUP_LOG"\n[ "$SETUP_FAIL_STAGE" = chmod ] && exit 1\nexec "$REAL_CHMOD" "$@"\n',
		node: '#!/bin/sh\nif [ "$1" = scripts/setup-completion.mjs ]; then [ "$2" = write ] && [ "$SETUP_FAIL_STAGE" = write ] && exit 1; exec "$REAL_NODE" "$@"; fi\nprintf \'node\\n\' >> "$SETUP_LOG"\n[ "$SETUP_FAIL_STAGE" = node ] && exit 1\nexec "$REAL_NODE" "$@"\n',
	})) {
		const command = join(bin, name);
		writeFileSync(command, source);
		chmodSync(command, 0o755);
	}

	return { cwd, bin, log, marker: join(cwd, sentinel) };
}

function installSkill(cwd) {
	mkdirSync(join(cwd, "generated/skills/pfdsl"), { recursive: true });
	writeFileSync(
		join(cwd, "generated/skills/pfdsl/SKILL.md"),
		"fixture skill\n",
	);
	mkdirSync(join(cwd, ".claude/skills"), { recursive: true });
	symlinkSync(
		"../../generated/skills/pfdsl",
		join(cwd, ".claude/skills/pfdsl"),
	);
}

function writeInstalledDependency(
	context,
	name,
	packageJson,
	shimNames = [],
	shimMode = 0o755,
) {
	const dependencyDirectory = join(context.cwd, "node_modules", name);
	mkdirSync(dependencyDirectory, { recursive: true });
	writeFileSync(
		join(dependencyDirectory, "package.json"),
		`${JSON.stringify(packageJson)}\n`,
	);
	if (shimNames.length > 0)
		mkdirSync(join(context.cwd, "node_modules/.bin"), { recursive: true });
	for (const shimName of shimNames) {
		const shimPath = join(context.cwd, "node_modules/.bin", shimName);
		mkdirSync(dirname(shimPath), { recursive: true });
		writeFileSync(shimPath, "");
		chmodSync(shimPath, shimMode);
	}
}

function environment(context, failureStage = "", extra = {}) {
	return {
		...process.env,
		PATH: `${context.bin}:${process.env.PATH}`,
		REAL_CHMOD: chmod,
		REAL_CP: cp,
		REAL_NODE: process.execPath,
		SETUP_FAIL_STAGE: failureStage,
		SETUP_EXPECT_LOCK: setupLockPath(context.cwd),
		SETUP_LOG: context.log,
		GIT_CONFIG_GLOBAL: join(context.cwd, "global-gitconfig"),
		GIT_CONFIG_SYSTEM: "/dev/null",
		...extra,
	};
}

function runSetup(context, failureStage, extra) {
	return spawnSync("make", ["-f", makefile, "setup"], {
		cwd: context.cwd,
		encoding: "utf8",
		env: environment(context, failureStage, extra),
	});
}

function runCheck(context) {
	return spawnSync(
		process.execPath,
		[join(context.cwd, "scripts/setup-completion.mjs"), "check"],
		{
			cwd: context.cwd,
			encoding: "utf8",
			env: environment(context),
		},
	);
}

function startSetup(context, failureStage, extra) {
	const child = spawn("make", ["-f", makefile, "setup"], {
		cwd: context.cwd,
		env: environment(context, failureStage, extra),
	});
	const result = new Promise((resolveResult, rejectResult) => {
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", rejectResult);
		child.on("close", (status) => resolveResult({ status, stderr }));
	});
	return { child, result };
}

async function waitForFile(path, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(path)) {
		if (Date.now() >= deadline)
			throw new Error(`timed out waiting for ${path}`);
		await new Promise((resolveWait) => setTimeout(resolveWait, 10));
	}
}

function runSessionStart(context, command) {
	return spawnSync("/bin/sh", ["-c", command], {
		cwd: context.cwd,
		encoding: "utf8",
		env: environment(context),
	});
}

function assertSucceeded(result) {
	assert.equal(result.status, 0, result.stderr);
}

afterEach(() => {
	for (const path of fixtures.splice(0))
		rmSync(path, { force: true, recursive: true });
});

describe("setup completion sentinel", () => {
	for (const state of ["missing", "wrong", "legacy directory"])
		it(`rejects and repairs a ${state} owned skill link with a current marker`, () => {
			const context = fixture();
			const link = join(context.cwd, ".claude/skills/pfdsl");
			writeSetupMarker(context.cwd);
			assert.equal(isSetupCurrent(context.cwd), true);
			rmSync(link);
			if (state === "wrong") symlinkSync("../../wrong-skill", link);
			if (state === "legacy directory") {
				mkdirSync(link);
				writeFileSync(join(link, "SKILL.md"), "old skill\n");
			}
			assert.equal(isSetupCurrent(context.cwd), false);
			assert.notEqual(runCheck(context).status, 0);
			assertSucceeded(runSetup(context));
			assert.equal(readlinkSync(link), "../../generated/skills/pfdsl");
			assert.equal(isSetupCurrent(context.cwd), true);
			assert.equal(runCheck(context).status, 0);
			assert.doesNotMatch(
				readFileSync(context.log, "utf8"),
				/pnpm/,
				"artifact repair must reuse prepared dependencies",
			);
		});

	for (const missing of [
		"generated/skills/pfdsl",
		"generated/skills/pfdsl/SKILL.md",
	])
		it(`diagnoses missing tracked ${missing} without generating or restoring it`, () => {
			const context = fixture();
			writeSetupMarker(context.cwd);
			rmSync(join(context.cwd, missing), { recursive: true });
			assert.equal(isSetupCurrent(context.cwd), false);
			for (const result of [runCheck(context), runSetup(context)]) {
				assert.notEqual(result.status, 0);
				assert.match(result.stderr, /generated\/skills\/pfdsl\/SKILL\.md/);
				assert.match(result.stderr, /tracked|Git/);
				assert.match(result.stderr, /gen-skill/);
			}
			assert.equal(existsSync(join(context.cwd, missing)), false);
			assert.equal(existsSync(context.log), false);
		});

	it("repairs a deleted owned skill link through each SessionStart hook", () => {
		for (const path of [".claude/settings.json", ".codex/hooks.json"]) {
			const context = fixture();
			writeSetupMarker(context.cwd);
			rmSync(join(context.cwd, ".claude/skills/pfdsl"));
			assertSucceeded(runSessionStart(context, sessionStartCommand(path)));
			assert.equal(runCheck(context).status, 0);
			assert.equal(
				readlinkSync(join(context.cwd, ".claude/skills/pfdsl")),
				"../../generated/skills/pfdsl",
			);
		}
	});

	for (const broken of [".claude/skills/pfdsl", "generated/skills/pfdsl"])
		it(`rejects a successful setup stage that leaves ${broken} missing and clears its marker`, () => {
			const context = fixture();
			writeFileSync(
				join(context.cwd, "scripts/link-repo-skill.mjs"),
				`import { rmSync } from "node:fs"; rmSync(${JSON.stringify(broken)}, { recursive: true });\n`,
			);
			const result = runSetup(context);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /skill|SKILL/);
			assert.equal(existsSync(context.marker), false);
			assert.equal(isSetupCurrent(context.cwd), false);
			assert.equal(existsSync(setupLockPath(context.cwd)), false);
		});

	for (const reachable of [false, true])
		it(`rejects an owned link through a relocated parent with a ${reachable ? "different" : "dangling"} target`, () => {
			const context = fixture();
			const parent = join(context.cwd, ".claude/skills");
			const relocated = join(context.cwd, "relocated/nested/skills");
			rmSync(parent, { recursive: true });
			mkdirSync(relocated, { recursive: true });
			symlinkSync("../relocated/nested/skills", parent);
			symlinkSync("../../generated/skills/pfdsl", join(relocated, "pfdsl"));
			if (reachable) {
				mkdirSync(join(context.cwd, "relocated/generated/skills/pfdsl"), {
					recursive: true,
				});
				writeFileSync(
					join(context.cwd, "relocated/generated/skills/pfdsl/SKILL.md"),
					"different skill\n",
				);
			}
			writeSetupMarker(context.cwd);
			assert.equal(isSetupCurrent(context.cwd), false);
			for (const result of [runCheck(context), runSetup(context)]) {
				assert.notEqual(result.status, 0);
				assert.match(result.stderr, /\.claude\/skills/);
				assert.match(result.stderr, /parent|directory/);
			}
			assert.equal(readlinkSync(parent), "../relocated/nested/skills");
			assert.equal(existsSync(context.log), false);
		});

	it("fingerprints dependency inputs independently of hook and link runtime inputs", () => {
		const cwd = mkdtempSync(join(tmpdir(), "setup-fingerprint-"));
		fixtures.push(cwd);
		for (const path of [
			"Makefile",
			"package.json",
			"pnpm-lock.yaml",
			"pnpm-workspace.yaml",
			"scripts/hooks/pre-commit-shim",
			"scripts/lib/cli-entrypoint.mjs",
			"scripts/lib/repo-skill-link.mjs",
			"scripts/link-repo-skill.mjs",
			"scripts/setup-completion.mjs",
			"packages/zeta/package.json",
			"packages/alpha/package.json",
		]) {
			mkdirSync(dirname(join(cwd, path)), { recursive: true });
			writeFileSync(
				join(cwd, path),
				path.endsWith("package.json") ? "{}\n" : `${path}\n`,
			);
		}

		// Currency also requires the installed shim, so give the fixture one.
		writeFileSync(
			join(cwd, "scripts/hooks/pre-commit-shim"),
			readFileSync(join(root, "scripts/hooks/pre-commit-shim")),
		);
		assert.equal(spawnSync("/usr/bin/git", ["init", "-q", cwd]).status, 0);
		writeFileSync(
			join(cwd, ".git/hooks/pre-commit"),
			readFileSync(join(cwd, "scripts/hooks/pre-commit-shim")),
			{ mode: 0o755 },
		);
		writeFileSync(join(cwd, "scripts/pre-commit"), "#!/bin/sh\n", {
			mode: 0o755,
		});
		for (const entry of ["scripts/hooks/check-default-branch"]) {
			writeFileSync(join(cwd, entry), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		}
		installSkill(cwd);

		const inputs = setupInputs(cwd);
		assert.deepEqual(
			inputs.filter((path) => path.endsWith("package.json")),
			[
				"package.json",
				"packages/alpha/package.json",
				"packages/zeta/package.json",
			],
		);
		for (const path of [".npmrc", ".pnpmfile.cjs", "pnpm-workspace.yaml"])
			assert.equal(inputs.includes(path), true, path);

		writeSetupMarker(cwd);
		assert.equal(isSetupCurrent(cwd), true);
		for (const path of [
			".npmrc",
			".pnpmfile.cjs",
			"packages/alpha/package.json",
		]) {
			writeFileSync(
				join(cwd, path),
				path.endsWith("package.json")
					? `{"changed":"${path}"}\n`
					: `changed ${path}\n`,
			);
			assert.equal(isSetupCurrent(cwd), false, path);
			writeSetupMarker(cwd);
		}
	});

	it("fingerprints an arbitrary missing input deterministically and distinctly from an empty file", () => {
		const cwd = mkdtempSync(join(tmpdir(), "setup-missing-input-"));
		fixtures.push(cwd);
		const inputs = ["config/not-present"];
		const missing = setupFingerprint(cwd, inputs);
		assert.equal(setupFingerprint(cwd, inputs), missing);
		mkdirSync(join(cwd, "config"));
		writeFileSync(join(cwd, inputs[0]), "");
		assert.notEqual(setupFingerprint(cwd, inputs), missing);
	});

	it("fails check when a current marker lacks a declared root dependency link", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"devDependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		writeSetupMarker(context.cwd);

		const result = runCheck(context);
		assert.notEqual(result.status, 0);
	});

	it("fails check when a current marker lacks a declared workspace dependency link", () => {
		const context = fixture();
		const manifest = join(context.cwd, "packages/core/package.json");
		mkdirSync(dirname(manifest), { recursive: true });
		writeFileSync(
			manifest,
			'{"dependencies":{"workspace-dependency":"1.0.0"}}\n',
		);
		writeSetupMarker(context.cwd);

		const result = runCheck(context);
		assert.notEqual(result.status, 0);
	});

	it("fails check when a string-bin dependency lacks its package-name shim", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"dependencies":{"@fixture/command-package":"1.0.0"}}\n',
		);
		writeInstalledDependency(context, "@fixture/command-package", {
			bin: "cli.js",
		});
		writeSetupMarker(context.cwd);

		const result = runCheck(context);
		assert.notEqual(result.status, 0);
	});

	it("fails check when an object-bin dependency lacks a declared shim", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"dependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		writeInstalledDependency(context, "fixture-dependency", {
			bin: { "fixture-command": "cli.js" },
		});
		writeSetupMarker(context.cwd);

		const result = runCheck(context);
		assert.notEqual(result.status, 0);
	});

	it("uses the aliased dependency package name for a string-bin shim", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"dependencies":{"cli-alias":"npm:@scope/real-cli@1"}}\n',
		);
		writeInstalledDependency(
			context,
			"cli-alias",
			{ name: "@scope/real-cli", bin: "cli.js" },
			["cli-alias"],
		);
		writeSetupMarker(context.cwd);

		assert.notEqual(runCheck(context).status, 0);
	});

	it("normalizes a scoped object-bin key before checking its shim", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"dependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		writeInstalledDependency(
			context,
			"fixture-dependency",
			{ bin: { "@scope/cli": "cli.js" } },
			["@scope/cli"],
		);
		writeSetupMarker(context.cwd);

		assert.notEqual(runCheck(context).status, 0);
	});

	it("fails check when a required shim has no execute bit", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"dependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		writeInstalledDependency(
			context,
			"fixture-dependency",
			{ bin: { "fixture-command": "cli.js" } },
			["fixture-command"],
			0o644,
		);
		writeSetupMarker(context.cwd);

		assert.notEqual(runCheck(context).status, 0);
	});

	it("fails check when a declared dependency has no readable package manifest", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"dependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		mkdirSync(join(context.cwd, "node_modules/fixture-dependency"), {
			recursive: true,
		});
		writeSetupMarker(context.cwd);

		const result = runCheck(context);
		assert.notEqual(result.status, 0);
	});

	it("fails check when a declared dependency has an invalid package manifest", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"dependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		const dependencyDirectory = join(
			context.cwd,
			"node_modules/fixture-dependency",
		);
		mkdirSync(dependencyDirectory, { recursive: true });
		writeFileSync(join(dependencyDirectory, "package.json"), "not json\n");
		writeSetupMarker(context.cwd);

		const result = runCheck(context);
		assert.notEqual(result.status, 0);
	});

	it("accepts a declared dependency that does not declare a bin", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"dependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		writeInstalledDependency(context, "fixture-dependency", {
			name: "fixture-dependency",
			version: "1.0.0",
		});
		writeSetupMarker(context.cwd);

		const result = runCheck(context);
		assertSucceeded(result);
	});

	it("reruns setup when a current marker lacks a declared dependency link", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"devDependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		writeSetupMarker(context.cwd);

		assertSucceeded(
			runSetup(context, "", {
				SETUP_LINK_PATH: join(context.cwd, "node_modules/fixture-dependency"),
			}),
		);
		assert.equal(readFileSync(context.log, "utf8"), "pnpm\nnode\nnode\n");
		assert.equal(isSetupCurrent(context.cwd), true);
	});

	it("skips setup when the marker and declared dependency links are current", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"devDependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		writeInstalledDependency(
			context,
			"fixture-dependency",
			{ bin: { "fixture-command": "cli.js" } },
			["fixture-command"],
		);
		writeSetupMarker(context.cwd);

		assertSucceeded(runSetup(context));
		assert.equal(existsSync(context.log), false);
		assert.equal(isSetupCurrent(context.cwd), true);
	});

	it("ignores a packages entry that carries no readable manifest", () => {
		const context = fixture();
		writeFileSync(
			join(context.cwd, "package.json"),
			'{"devDependencies":{"fixture-dependency":"1.0.0"}}\n',
		);
		writeInstalledDependency(
			context,
			"fixture-dependency",
			{ bin: { "fixture-command": "cli.js" } },
			["fixture-command"],
		);
		mkdirSync(join(context.cwd, "packages/scratch"), { recursive: true });
		writeSetupMarker(context.cwd);

		assert.equal(isSetupCurrent(context.cwd), true);

		assertSucceeded(runSetup(context));
		assert.equal(existsSync(context.log), false);
	});

	it("keeps the previous marker and removes its temporary file when atomic replacement fails", () => {
		const cwd = mkdtempSync(join(tmpdir(), "setup-atomic-marker-"));
		fixtures.push(cwd);
		mkdirSync(join(cwd, "node_modules"));
		writeFileSync(join(cwd, "package.json"), "{}\n");
		writeFileSync(join(cwd, sentinel), "previous\n");

		assert.throws(
			() =>
				writeSetupMarker(cwd, ["package.json"], {
					rename() {
						throw new Error("rename failed");
					},
				}),
			/rename failed/,
		);
		assert.equal(readFileSync(join(cwd, sentinel), "utf8"), "previous\n");
		assert.deepEqual(readdirSync(join(cwd, "node_modules")), [
			".pfdsl-setup-complete",
		]);
	});

	it("serializes concurrent setup and lets the waiter reuse the first runner's current marker", async () => {
		const context = fixture();
		const ready = join(context.cwd, "first-ready");
		const release = join(context.cwd, "release-first");
		const lock = setupLockPath(context.cwd);
		assert.equal(lock, join(context.cwd, "node_modules/.pfdsl-setup.lock"));
		const first = startSetup(context, "", {
			SETUP_READY_FILE: ready,
			SETUP_RELEASE_FILE: release,
		});
		let second;
		try {
			await waitForFile(ready);
			await waitForFile(lock);
			const old = new Date(Date.now() - 60_000);
			utimesSync(lock, old, old);
			second = startSetup(context);
			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
			assert.equal(
				second.child.exitCode,
				null,
				"a live owner must retain the lock even with an old heartbeat",
			);
		} finally {
			writeFileSync(release, "release\n");
		}
		const [firstResult, secondResult] = await Promise.all([
			first.result,
			second.result,
		]);
		assertSucceeded(firstResult);
		assertSucceeded(secondResult);
		assert.equal(readFileSync(context.log, "utf8"), "pnpm\nnode\nnode\n");
		assert.equal(isSetupCurrent(context.cwd), true);
	});

	it("installs a missing shim before checking a hooksPath that selects the common-dir hooks", () => {
		const context = fixture();
		const installed = join(context.cwd, ".git/hooks/pre-commit");
		rmSync(installed);
		assert.equal(
			spawnSync(
				"/usr/bin/git",
				["config", "core.hooksPath", join(context.cwd, ".git/hooks")],
				{ cwd: context.cwd },
			).status,
			0,
		);

		assertSucceeded(runSetup(context));
		assert.equal(existsSync(installed), true);
		assert.equal(runCheck(context).status, 0);
	});

	it("refuses a custom hooksPath without changing it", () => {
		const context = fixture();
		assert.equal(
			spawnSync("/usr/bin/git", ["config", "core.hooksPath", "custom-hooks"], {
				cwd: context.cwd,
			}).status,
			0,
		);

		const result = runSetup(context);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /core\.hooksPath/);
		assert.equal(existsSync(context.log), false);
	});

	it("reclaims a lock whose owner process is gone", () => {
		for (const owner of [
			JSON.stringify({ pid: 999_999, token: "stale" }),
			"incomplete owner metadata",
		]) {
			const context = fixture();
			const lock = setupLockPath(context.cwd);
			mkdirSync(lock, { recursive: true });
			writeFileSync(join(lock, "owner.json"), owner);
			const old = new Date(Date.now() - 60_000);
			utimesSync(lock, old, old);

			assertSucceeded(runSetup(context));
			assert.equal(existsSync(lock), false);
			assert.equal(isSetupCurrent(context.cwd), true);
		}
	});

	it("bounds lock waiting and reports the active owner", async () => {
		const context = fixture();
		const first = await acquireSetupLock(context.cwd, {
			pollMs: 5,
			waitMs: 100,
		});
		try {
			await assert.rejects(
				acquireSetupLock(context.cwd, { pollMs: 5, waitMs: 20 }),
				new RegExp(
					`timed out waiting for setup lock.*owner pid ${process.pid}`,
				),
			);
		} finally {
			first.release();
		}
	});

	it("rejects extra run arguments instead of becoming an arbitrary command runner", () => {
		const result = spawnSync(
			process.execPath,
			[join(root, "scripts/setup-completion.mjs"), "run", "echo"],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			/usage: setup-completion\.mjs <check\|run\|write>/,
		);
	});

	it("runs each SessionStart hook only until setup completes", () => {
		for (const path of [".claude/settings.json", ".codex/hooks.json"]) {
			assert.match(sessionStartCommand(path), /setup-completion\.mjs check/);
			const context = fixture();
			assertSucceeded(runSessionStart(context, sessionStartCommand(path)));
			assert.equal(
				existsSync(context.marker),
				true,
				`${path} should run setup without a marker`,
			);
			const log = readFileSync(context.log, "utf8");
			assert.equal(log, "pnpm\nnode\nnode\n");
			assertSucceeded(runSessionStart(context, sessionStartCommand(path)));
			assert.equal(
				readFileSync(context.log, "utf8"),
				log,
				`${path} should skip setup with a marker`,
			);
			writeFileSync(join(context.cwd, "pnpm-lock.yaml"), "changed\n");
			assertSucceeded(runSessionStart(context, sessionStartCommand(path)));
			assert.notEqual(
				readFileSync(context.log, "utf8"),
				log,
				`${path} should rerun setup when an input changes`,
			);
		}
	});

	it("removes a stale marker when any setup stage fails and restores it only after a successful retry", () => {
		for (const failureStage of ["pnpm", "node", "write"]) {
			const context = fixture();
			assert.notEqual(
				runSetup(context, failureStage).status,
				0,
				`${failureStage} should fail setup`,
			);
			assert.equal(
				existsSync(context.marker),
				false,
				`${failureStage} failure should not create a marker`,
			);
			if (failureStage === "git")
				assert.equal(
					readFileSync(context.log, "utf8"),
					"pnpm\ngit\n",
					"git failure should stop before hook installation",
				);
			assertSucceeded(runSetup(context));
			assert.equal(
				existsSync(context.marker),
				true,
				"successful setup should create the marker",
			);
			writeFileSync(
				join(context.cwd, ".npmrc"),
				`changed before ${failureStage} retry\n`,
			);
			assert.notEqual(
				runSetup(context, failureStage).status,
				0,
				`${failureStage} should fail a repeated setup`,
			);
			assert.equal(
				existsSync(context.marker),
				false,
				`${failureStage} failure should clear a stale marker`,
			);
			assertSucceeded(runSetup(context));
			assert.equal(
				existsSync(context.marker),
				true,
				"successful retry should restore the marker",
			);
		}
	});
});
