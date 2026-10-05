import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { withIndexSnapshot } from "./lib/index-snapshot.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it("a regular CLI build removes stale orphan chunks and remains executable in a snapshot", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-cli-build-"));
	const cli = join(root, "packages/cli");
	const git = (...args) => execFileSync("git", args, { cwd: root });
	try {
		mkdirSync(join(cli, "src"), { recursive: true });
		writeFileSync(join(root, ".gitignore"), "dist/\nnode_modules/\n");
		for (const file of ["package.json", "tsup.config.ts"])
			cpSync(join(repository, "packages/cli", file), join(cli, file));
		writeFileSync(
			join(cli, "src/index.ts"),
			'export { answer } from "./shared.js";\n',
		);
		writeFileSync(
			join(cli, "src/cli.ts"),
			'import { answer } from "./shared.js"; console.log(answer);\n',
		);
		writeFileSync(join(cli, "src/shared.ts"), "export const answer = 42;\n");
		git("init", "--quiet");
		git("add", ".");
		symlinkSync(
			join(repository, "node_modules"),
			join(root, "node_modules"),
			"dir",
		);
		mkdirSync(join(cli, "node_modules"));
		symlinkSync(
			join(repository, "packages/cli/node_modules/tsup"),
			join(cli, "node_modules/tsup"),
			"dir",
		);
		const build = () =>
			execFileSync(
				process.execPath,
				[join(cli, "node_modules/tsup/dist/cli-default.js")],
				{ cwd: cli, stdio: "pipe" },
			);
		build();
		const chunks = readdirSync(join(cli, "dist")).filter((file) =>
			/^chunk-.*\.js$/.test(file),
		);
		assert.ok(chunks.length > 0, "the real CLI config emits chunks");
		for (const file of readdirSync(join(cli, "dist"))) {
			if (file.endsWith(".js"))
				assert.equal(
					readFileSync(join(cli, "dist", file), "utf8").includes(
						"chunk-ORPHAN",
					),
					false,
				);
		}
		const orphan = join(cli, "dist/chunk-ORPHAN.js");
		writeFileSync(orphan, 'throw new Error("orphan must never execute");\n');
		const old = new Date("2000-01-01T00:00:00Z");
		utimesSync(orphan, old, old);
		assert.equal(
			readFileSync(orphan, "utf8"),
			'throw new Error("orphan must never execute");\n',
		);
		withIndexSnapshot(root, (snapshot) =>
			assert.equal(
				existsSync(join(snapshot, "packages/cli/dist/cli.js")),
				false,
			),
		);
		build();
		assert.equal(
			existsSync(orphan),
			false,
			"regular build removes the stale unreferenced chunk",
		);
		withIndexSnapshot(root, (snapshot) => {
			assert.equal(
				readFileSync(join(snapshot, "packages/cli/dist/cli.js"), "utf8"),
				readFileSync(join(cli, "dist/cli.js"), "utf8"),
			);
			assert.equal(
				existsSync(join(snapshot, "packages/cli/dist/chunk-ORPHAN.js")),
				false,
			);
			assert.equal(
				execFileSync(
					process.execPath,
					[join(snapshot, "packages/cli/dist/cli.js")],
					{ encoding: "utf8" },
				),
				"42\n",
			);
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
