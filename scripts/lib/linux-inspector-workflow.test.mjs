import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";

test("diagnostic AppDir comparison detects same-content link, mode, and entry-type changes", () => {
	const workflow = YAML.parse(
		readFileSync(
			new URL("../../.github/workflows/linux-inspector.yml", import.meta.url),
			"utf8",
		),
	);
	const run = workflow.jobs["fixed-source-inspector"].steps.find((step) =>
		step.run?.includes("appdir_differences"),
	).run;
	const python = [...run.matchAll(/python3 - <<'PY'\n([\s\S]*?)\nPY/g)].at(
		-1,
	)[1];
	const result = spawnSync(
		"python3",
		[
			"-c",
			`
import ast, hashlib, os, stat, sys, tempfile
from pathlib import Path
source = sys.stdin.read()
tree = ast.parse(source)
comparison = next(node for node in tree.body if isinstance(node, ast.Assign)
                  and isinstance(node.targets[0], ast.Tuple)
                  and [getattr(v, 'id', '') for v in node.targets[0].elts] == ['old', 'new'])
name = comparison.value.elts[0].func.id
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
exec(compile(ast.Module(body=[function], type_ignores=[]), '<actual AppDir comparison>', 'exec'))
inspect = globals()[name]
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
print('actual AppDir comparison preserves link target, mode and entry type')
`,
		],
		{ input: python, encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
});
