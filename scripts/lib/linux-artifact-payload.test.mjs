import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";

const cases = [
	[
		"desktop.yml",
		"Archive verification files with checksums and executable permissions",
		"pfdsl-linux-x64.tar.gz",
		["pfdsl-desktop", "frontend", "SOURCE_COMMIT", "build-environment.txt"],
	],
	[
		"desktop.yml",
		"Inspect and archive the AppImage",
		"pfdsl-linux-appimage-x64.tar.gz",
		[
			"PFDSL.AppImage",
			"frontend",
			"SOURCE_COMMIT",
			"build-environment.txt",
			"APPDIR_SHA256SUMS",
		],
	],
	[
		"linux-inspector.yml",
		"Inspect provenance, frontend identity, and every AppDir difference",
		"pfdsl-linux-inspector-x64.tar.gz",
		[
			"PFDSL-Inspector.AppImage",
			"frontend",
			"SOURCE_COMMIT",
			"source-locks.txt",
			"build-environment.txt",
			"accepted-build-environment.txt",
			"cargo-features.txt",
			"APPDIR_SHA256SUMS",
			"DIAGNOSTIC_BUILD.json",
			"appdir_inventory.py",
		],
	],
];

function files(root, prefix = "") {
	return readdirSync(join(root, prefix), { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(prefix, entry.name);
			return entry.isDirectory() ? files(root, path) : [path];
		})
		.sort();
}

for (const [workflowName, stepName, archiveName, entries] of cases) {
	test(`${archiveName} archives and hashes the same payload, including a new entry`, () => {
		const workflow = YAML.parse(
			readFileSync(
				new URL(`../../.github/workflows/${workflowName}`, import.meta.url),
				"utf8",
			),
		);
		const step = workflow.jobs[
			workflowName === "desktop.yml" ? "linux-native" : "fixed-source-inspector"
		].steps.find((s) => s.name === stepName);
		const start = step.run.indexOf("payload=(");
		assert.notEqual(start, -1, "archive and manifest need one payload list");
		const script = step.run
			.slice(start)
			.replace("payload=(", 'payload=("extra provenance.json" ');
		const root = mkdtempSync(join(tmpdir(), "pfdsl-payload-"));
		try {
			for (const entry of entries.filter((e) => e !== "frontend"))
				writeFileSync(join(root, entry), entry);
			mkdirSync(join(root, "frontend"));
			writeFileSync(join(root, "frontend", "main.js"), "original frontend");
			writeFileSync(
				join(root, "frontend", "file with spaces.js"),
				"nested payload",
			);
			writeFileSync(join(root, "extra provenance.json"), "new evidence");
			const executable = entries[0];
			chmodSync(join(root, executable), 0o755);
			const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
				cwd: root,
				encoding: "utf8",
				env: { ...process.env, RUNNER_TEMP: root },
			});
			assert.equal(result.status, 0, result.stderr);
			const output = join(root, "extracted");
			mkdirSync(output);
			const extract = spawnSync(
				"tar",
				["-xzf", join(root, archiveName), "-C", output],
				{ encoding: "utf8" },
			);
			assert.equal(extract.status, 0, extract.stderr);
			const manifest = readFileSync(join(output, "SHA256SUMS"), "utf8")
				.trim()
				.split("\n")
				.map((line) => line.slice(66))
				.sort();
			assert.deepEqual(
				files(output).filter((p) => p !== "SHA256SUMS"),
				manifest,
			);
			assert.deepEqual(
				manifest,
				[
					...entries.filter((e) => e !== "frontend"),
					"frontend/main.js",
					"frontend/file with spaces.js",
					"extra provenance.json",
				].sort(),
			);
			assert.equal(statSync(join(output, executable)).mode & 0o777, 0o755);
			const check = () =>
				spawnSync("sha256sum", ["-c", "SHA256SUMS"], {
					cwd: output,
					encoding: "utf8",
				});
			assert.equal(check().status, 0);
			writeFileSync(join(output, "frontend", "main.js"), "tampered");
			assert.notEqual(
				check().status,
				0,
				"modified payload must fail verification",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}
