import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(t, os = "Linux", mode = "build", overrides = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "standalone-make-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const bin = join(cwd, "bin");
	const cargoHome = join(cwd, "home/.cargo");
	const log = join(cwd, "commands.log");
	mkdirSync(bin);
	mkdirSync(join(cargoHome, "bin"), { recursive: true });
	writeFileSync(log, "");
	writeFileSync(
		join(cwd, "Makefile"),
		`${readFileSync(join(root, "Makefile"), "utf8")}\nsetup-artifacts:\n\t@true\npreflight:\n\t@true\nbuild-deps:\n\t@echo shared-build >> "$(TRACE)"\n`,
	);
	function stub(path, body) {
		writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	}
	stub(join(bin, "uname"), 'echo "$HOST_OS"');
	stub(join(bin, "xcode-select"), 'echo xcode >> "$TRACE"; exit "$FAIL_XCODE"');
	stub(join(bin, "pnpm"), 'echo "pnpm $*" >> "$TRACE"; exit "$FAIL_TAURI"');
	for (const name of ["cargo", "rustc"]) {
		stub(
			join(cargoHome, "bin", name),
			`echo fallback-${name} >> "$TRACE"; exit "\${FAIL_RUST:-0}"`,
		);
	}
	const env = {
		...process.env,
		HOME: join(cwd, "home"),
		PATH: `${bin}:/usr/bin:/bin`,
		TRACE: log,
		HOST_OS: os,
		FAIL_XCODE: "0",
		FAIL_RUST: "0",
		FAIL_TAURI: "0",
		...overrides,
	};
	delete env.CARGO_HOME;
	delete env.MAKEFLAGS;
	delete env.MFLAGS;
	return {
		stub,
		bin,
		cwd,
		run(extra = {}) {
			const result = spawnSync(
				"/usr/bin/make",
				["-C", cwd, "standalone", `MODE=${mode}`],
				{
					env: { ...env, ...extra },
					encoding: "utf8",
				},
			);
			return {
				...result,
				commands: readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
			};
		},
	};
}

for (const os of ["Darwin", "Linux"]) {
	for (const mode of ["build", "dev"]) {
		test(`${os} ${mode} uses the native entry point after shared packages`, (t) => {
			const result = fixture(t, os, mode).run();
			assert.equal(result.status, 0, result.stderr);
			const command =
				mode === "dev"
					? "dev"
					: os === "Darwin"
						? "build --bundles app -- --locked"
						: "build --no-bundle -- --locked";
			assert.deepEqual(result.commands, [
				...(os === "Darwin" ? ["xcode"] : []),
				"fallback-cargo",
				"fallback-rustc",
				"shared-build",
				`pnpm --filter @pfdsl/standalone tauri ${command}`,
			]);
		});
	}
}

test("Linux does not require Xcode", (t) => {
	const result = fixture(t, "Linux", "dev", { FAIL_XCODE: "1" }).run();
	assert.equal(result.status, 0, result.stderr);
	assert.ok(!result.commands.includes("xcode"));
});

for (const [name, os, mode, env] of [
	["unsupported OS", "MINGW64_NT", "build", {}],
	["invalid mode", "Linux", "invalid", {}],
	["unusable Rust", "Linux", "build", { FAIL_RUST: "1" }],
	["missing macOS tools", "Darwin", "dev", { FAIL_XCODE: "1" }],
]) {
	test(`${name} stops before shared build or Tauri`, (t) => {
		const result = fixture(t, os, mode, env).run();
		assert.notEqual(result.status, 0);
		assert.ok(
			!result.commands.some(
				(line) => line === "shared-build" || line.startsWith("pnpm "),
			),
		);
	});
}

test("custom CARGO_HOME is used when Cargo is absent from PATH", (t) => {
	const f = fixture(t);
	const custom = join(f.cwd, "custom/bin");
	mkdirSync(custom, { recursive: true });
	for (const name of ["cargo", "rustc"])
		f.stub(join(custom, name), `echo custom-${name} >> "$TRACE"`);
	const result = f.run({ CARGO_HOME: dirname(custom) });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.commands.slice(0, 2), [
		"custom-cargo",
		"custom-rustc",
	]);
});

test("existing PATH toolchain takes precedence", (t) => {
	const f = fixture(t);
	for (const name of ["cargo", "rustc"])
		f.stub(join(f.bin, name), `echo path-${name} >> "$TRACE"`);
	const result = f.run();
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.commands.slice(0, 2), ["path-cargo", "path-rustc"]);
});

test("missing Rust stops before compiling packages", (t) => {
	const f = fixture(t);
	const result = f.run({ CARGO_HOME: join(f.cwd, "missing") });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Install stable Rust/);
	assert.deepEqual(result.commands, []);
});

for (const os of ["Darwin", "Linux"]) {
	for (const mode of ["build", "dev"]) {
		test(`${os} ${mode} propagates a Tauri failure`, (t) => {
			const result = fixture(t, os, mode, { FAIL_TAURI: "1" }).run();
			assert.notEqual(result.status, 0);
			assert.ok(result.commands.at(-1).startsWith("pnpm "));
		});
	}
}
