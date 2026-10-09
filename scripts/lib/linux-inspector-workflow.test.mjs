import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

test("job environment uses only contexts available before a runner exists", () => {
	const workflow = YAML.parse(
		readFileSync(
			new URL("../../.github/workflows/linux-inspector.yml", import.meta.url),
			"utf8",
		),
	);
	assert.doesNotMatch(
		JSON.stringify(workflow.jobs["fixed-source-inspector"].env),
		/\$\{\{\s*(runner|job|env|steps)\./,
	);
});

test("diagnostic AppDir comparison detects same-content link, mode, and entry-type changes", () => {
	const result = spawnSync(
		"python3",
		[
			"-c",
			`
import os, sys, tempfile
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from appdir_inventory import appdir_entries as inspect
with tempfile.TemporaryDirectory(prefix='pfdsl-inspector-inventory-') as temporary:
    root = Path(temporary)
    (root/'a').write_bytes(b'identical')
    (root/'b').write_bytes(b'identical')
    link = root/'lib.so'
    link.symlink_to('a')
    before = inspect(root)
    link.unlink(); link.symlink_to('b')
    assert before != inspect(root), 'link target change with identical bytes was lost'
    before = inspect(root)
    os.chmod(root/'a', 0o700)
    assert before != inspect(root), 'executable mode change was lost'
    before = inspect(root)
    link.unlink(); link.write_bytes(b'identical')
    assert before != inspect(root), 'symlink-to-file change was lost'
    before = inspect(root)
    (root/'extra').mkdir()
    assert before != inspect(root), 'directory addition was lost'
    (root/'extra').rmdir()
    assert before == inspect(root), 'directory removal did not restore inventory'
print('actual AppDir comparison preserves link target, mode and entry type')
`,
			fileURLToPath(new URL("./", import.meta.url)),
		],
		{ encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
	);
	assert.equal(result.status, 0, result.stderr);
});

test("the fixed-source job preserves the control helper outside the product checkout", () => {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const workflow = YAML.parse(
		readFileSync(join(root, ".github/workflows/linux-inspector.yml"), "utf8"),
	);
	const steps = workflow.jobs["fixed-source-inspector"].steps;
	const preservation = steps.findIndex(
		(s) =>
			s.name ===
			"Preserve the control helper before checking out the fixed product source",
	);
	assert.ok(preservation > 0);
	assert.match(
		steps[preservation - 1].with.ref,
		/^\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}$/,
	);
	assert.equal(
		steps[preservation + 1].with.ref,
		"8261f877d5cae8aa653a5310edfbd9e387acb116",
	);
	const temporary = mkdtempSync(join(tmpdir(), "pfdsl-inspector-helper-"));
	try {
		const result = spawnSync("bash", ["-e", "-c", steps[preservation].run], {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, RUNNER_TEMP: temporary, GITHUB_WORKSPACE: root },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(
			readFileSync(
				join(temporary, "inspector-tools/appdir_inventory.py"),
				"utf8",
			),
			readFileSync(join(root, "scripts/lib/appdir_inventory.py"), "utf8"),
		);
		const head = spawnSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(
			readFileSync(join(temporary, "inspector-tools/CONTROL_COMMIT"), "utf8"),
			head.stdout,
		);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});
