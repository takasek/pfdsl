import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	isSetupCurrent,
	SETUP_INPUTS,
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
	const bin = join(cwd, "bin");
	const log = join(cwd, "setup.log");
	mkdirSync(join(cwd, "scripts/hooks"), { recursive: true });
	mkdirSync(join(cwd, "scripts/lib"), { recursive: true });
	mkdirSync(join(cwd, ".git-common/hooks"), { recursive: true });
	mkdirSync(bin);
	symlinkSync(makefile, join(cwd, "Makefile"));
	writeFileSync(join(cwd, "scripts/hooks/pre-commit-shim"), "#!/bin/sh\n");
	writeFileSync(join(cwd, "scripts/link-repo-skill.mjs"), "// fixture\n");
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
		pnpm: '#!/bin/sh\nprintf \'pnpm\\n\' >> "$SETUP_LOG"\n[ "$SETUP_FAIL_STAGE" = pnpm ] && exit 1\nmkdir -p node_modules\n',
		git: "#!/bin/sh\nprintf 'git\\n' >> \"$SETUP_LOG\"\n[ \"$SETUP_FAIL_STAGE\" = git ] && exit 1\nprintf '.git-common\\n'\n",
		cp: '#!/bin/sh\nprintf \'cp\\n\' >> "$SETUP_LOG"\n[ "$SETUP_FAIL_STAGE" = cp ] && exit 1\nexec "$REAL_CP" "$@"\n',
		chmod:
			'#!/bin/sh\nprintf \'chmod\\n\' >> "$SETUP_LOG"\n[ "$SETUP_FAIL_STAGE" = chmod ] && exit 1\nexec "$REAL_CHMOD" "$@"\n',
		node: '#!/bin/sh\nif [ "$1" = scripts/setup-completion.mjs ]; then exec "$REAL_NODE" "$@"; fi\nprintf \'node\\n\' >> "$SETUP_LOG"\n[ "$SETUP_FAIL_STAGE" = node ] && exit 1\nexit 0\n',
	})) {
		const command = join(bin, name);
		writeFileSync(command, source);
		chmodSync(command, 0o755);
	}

	return { cwd, bin, log, marker: join(cwd, sentinel) };
}

function environment(context, failureStage = "") {
	return {
		...process.env,
		PATH: `${context.bin}:${process.env.PATH}`,
		REAL_CHMOD: chmod,
		REAL_CP: cp,
		REAL_NODE: process.execPath,
		SETUP_FAIL_STAGE: failureStage,
		SETUP_LOG: context.log,
	};
}

function runSetup(context, failureStage) {
	return spawnSync("make", ["-f", makefile, "setup"], {
		cwd: context.cwd,
		encoding: "utf8",
		env: environment(context, failureStage),
	});
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
	it("identifies the exact setup inputs represented by a marker", () => {
		const cwd = mkdtempSync(join(tmpdir(), "setup-fingerprint-"));
		fixtures.push(cwd);
		for (const path of SETUP_INPUTS) {
			mkdirSync(dirname(join(cwd, path)), { recursive: true });
			writeFileSync(join(cwd, path), `${path}\n`);
		}

		writeSetupMarker(cwd);
		assert.equal(isSetupCurrent(cwd), true);
		writeFileSync(join(cwd, "pnpm-lock.yaml"), "changed\n");
		assert.equal(isSetupCurrent(cwd), false);
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
			assert.equal(log, "pnpm\ngit\ncp\nchmod\nnode\n");
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
		for (const failureStage of ["pnpm", "git", "cp", "chmod", "node"]) {
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
