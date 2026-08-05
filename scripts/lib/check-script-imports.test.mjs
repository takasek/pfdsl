import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
	collectModuleClosure,
	countUnanalyzableImports,
	extractRelativeImports,
	findBrokenImports,
	findDistDependentFiles,
} from "./check-script-imports.mjs";

describe("extractRelativeImports", () => {
	it("extracts a single named import specifier", () => {
		const src = 'import { foo } from "./lib/foo.mjs";\n';
		assert.deepEqual(extractRelativeImports(src), ["./lib/foo.mjs"]);
	});

	it("extracts multiple import statements, ignoring bare specifiers and node: imports", () => {
		const src = [
			'import { readFileSync } from "node:fs";',
			'import { execFileSync } from "node:child_process";',
			'import { foo } from "./lib/foo.mjs";',
			'import { bar } from "../lib/bar.mjs";',
			'import something from "some-npm-package";',
		].join("\n");
		assert.deepEqual(extractRelativeImports(src), [
			"./lib/foo.mjs",
			"../lib/bar.mjs",
		]);
	});

	it("extracts a bare-import specifier (no bindings)", () => {
		const src = 'import "./lib/side-effect.mjs";\n';
		assert.deepEqual(extractRelativeImports(src), ["./lib/side-effect.mjs"]);
	});

	it("returns an empty array when there are no imports", () => {
		assert.deepEqual(extractRelativeImports("const x = 1;\n"), []);
	});

	it("extracts a named re-export specifier", () => {
		assert.deepEqual(extractRelativeImports('export { a } from "./x.mjs";\n'), [
			"./x.mjs",
		]);
	});

	it("extracts a star re-export specifier", () => {
		assert.deepEqual(extractRelativeImports('export * from "./z.mjs";\n'), [
			"./z.mjs",
		]);
	});

	it("extracts a namespaced star re-export specifier", () => {
		assert.deepEqual(
			extractRelativeImports('export * as ns from "./z.mjs";\n'),
			["./z.mjs"],
		);
	});

	it("extracts a re-export whose binding list spans several lines", () => {
		const src = ["export {", "\ta,", "\tb,", '} from "./x.mjs";'].join("\n");
		assert.deepEqual(extractRelativeImports(src), ["./x.mjs"]);
	});

	it("extracts a dynamic import with a literal specifier", () => {
		assert.deepEqual(
			extractRelativeImports('const m = await import("./y.mjs");\n'),
			["./y.mjs"],
		);
	});

	it("extracts every form from one line (the #667 reproduction)", () => {
		const src =
			'export { a } from "./x.mjs"; await import("./y.mjs"); export * from "./z.mjs"; import { q } from "./ok.mjs";';
		// Order across the forms is not part of the contract; presence is.
		assert.deepEqual(extractRelativeImports(src).sort(), [
			"./ok.mjs",
			"./x.mjs",
			"./y.mjs",
			"./z.mjs",
		]);
	});

	it("does not mistake an exported string constant for a re-export", () => {
		assert.deepEqual(
			extractRelativeImports('export const path = "./not-an-import.mjs";\n'),
			[],
		);
	});

	it("reports a specifier imported twice only once", () => {
		const src = [
			'import { a } from "./x.mjs";',
			'export { b } from "./x.mjs";',
		].join("\n");
		assert.deepEqual(extractRelativeImports(src), ["./x.mjs"]);
	});
});

describe("countUnanalyzableImports", () => {
	it("reports a dynamic import whose specifier is not a string literal", () => {
		assert.equal(
			countUnanalyzableImports("const name = f();\nawait import(name);\n"),
			1,
		);
	});

	it("reports a dynamic import built from a template literal", () => {
		assert.equal(
			countUnanalyzableImports("await import(`./${kind}.mjs`);\n"),
			1,
		);
	});

	it("does not report a dynamic import with a literal specifier", () => {
		assert.equal(countUnanalyzableImports('await import("./y.mjs");\n'), 0);
	});

	it("does not report an import() written inside a comment", () => {
		// This module's own header explains why a dry-`import()` sweep is unsafe;
		// prose about the construct must not read as a use of it.
		const src = [
			"// a dry-`import()` sweep isn't safe here",
			"export const x = 1;",
		].join("\n");
		assert.equal(countUnanalyzableImports(src), 0);
	});

	it("does not report a plain static import", () => {
		assert.equal(countUnanalyzableImports('import { a } from "./x.mjs";\n'), 0);
	});
});

describe("findBrokenImports", () => {
	let tmp;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "check-script-imports-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function write(relPath, content) {
		const full = join(tmp, ...relPath.split("/"));
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
		return full;
	}

	it("reports nothing when every relative import resolves to an existing file", () => {
		write("lib/foo.mjs", "export const foo = 1;\n");
		const entry = write("main.mjs", 'import { foo } from "./lib/foo.mjs";\n');
		assert.deepEqual(findBrokenImports([entry]), []);
	});

	it("reports a broken import when the target file does not exist", () => {
		const entry = write(
			"main.mjs",
			'import { foo } from "./lib/missing.mjs";\n',
		);
		const broken = findBrokenImports([entry]);
		assert.equal(broken.length, 1);
		assert.equal(broken[0].file, entry);
		assert.equal(broken[0].specifier, "./lib/missing.mjs");
	});

	it("resolves parent-directory (../) specifiers relative to the importing file", () => {
		write("sibling/target.mjs", "export const x = 1;\n");
		const entry = write(
			"nested/main.mjs",
			'import { x } from "../sibling/target.mjs";\n',
		);
		assert.deepEqual(findBrokenImports([entry]), []);
	});

	it("collects multiple broken imports across multiple files", () => {
		const a = write("a.mjs", 'import { x } from "./lib/missing-a.mjs";\n');
		const b = write("b.mjs", 'import { y } from "./lib/missing-b.mjs";\n');
		const broken = findBrokenImports([a, b]);
		assert.equal(broken.length, 2);
		assert.deepEqual(broken.map((r) => r.specifier).sort(), [
			"./lib/missing-a.mjs",
			"./lib/missing-b.mjs",
		]);
	});

	it("does not flag a specifier that resolves via an extensionless directory index (not applicable here) or a bare npm package", () => {
		const entry = write("main.mjs", 'import { z } from "some-npm-package";\n');
		assert.deepEqual(findBrokenImports([entry]), []);
	});
});

describe("collectModuleClosure", () => {
	let tmp;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "check-script-imports-closure-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function write(relPath, content) {
		const full = join(tmp, ...relPath.split("/"));
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
		return full;
	}

	it("returns the entry file plus every transitively-imported relative file", () => {
		const b = write("lib/b.mjs", "export const b = 1;\n");
		const a = write(
			"lib/a.mjs",
			'import { b } from "./b.mjs";\nexport const a = 1;\n',
		);
		const entry = write("main.mjs", 'import { a } from "./lib/a.mjs";\n');

		const closure = collectModuleClosure(entry);

		assert.deepEqual([...closure].sort(), [a, b, entry].sort());
	});

	it("does not loop forever on a circular import", () => {
		write("lib/b.mjs", 'import { a } from "./a.mjs";\nexport const b = 1;\n');
		const entry = write(
			"lib/a.mjs",
			'import { b } from "./b.mjs";\nexport const a = 1;\n',
		);

		const closure = collectModuleClosure(entry);

		assert.equal(closure.size, 2);
	});

	it("follows a re-exported module", () => {
		const b = write("lib/b.mjs", "export const b = 1;\n");
		const entry = write("main.mjs", 'export * from "./lib/b.mjs";\n');

		assert.deepEqual(
			[...collectModuleClosure(entry)].sort(),
			[b, entry].sort(),
		);
	});

	it("follows a dynamic import with a literal specifier", () => {
		const b = write("lib/b.mjs", "export const b = 1;\n");
		const entry = write(
			"main.mjs",
			'export const load = () => import("./lib/b.mjs");\n',
		);

		assert.deepEqual(
			[...collectModuleClosure(entry)].sort(),
			[b, entry].sort(),
		);
	});

	it("refuses to return a closure it cannot compute, rather than silently under-covering", () => {
		const entry = write(
			"main.mjs",
			"export const load = (name) => import(name);\n",
		);

		assert.throws(() => collectModuleClosure(entry), /main\.mjs/);
	});
});

describe("findDistDependentFiles", () => {
	let tmp;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "check-script-imports-dist-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function write(relPath, content) {
		const full = join(tmp, ...relPath.split("/"));
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
		return full;
	}

	it("flags a file that imports node:child_process", () => {
		const f = write(
			"a.mjs",
			'import { execFileSync } from "node:child_process";\n',
		);
		const violations = findDistDependentFiles([f]);
		assert.equal(violations.length, 1);
		assert.equal(violations[0].file, f);
	});

	it("flags a file that references packages/cli/dist", () => {
		const f = write("a.mjs", 'const p = "packages/cli/dist/cli.js";\n');
		assert.equal(findDistDependentFiles([f]).length, 1);
	});

	it("ignores a dist reference that only appears inside a comment", () => {
		const f = write(
			"a.mjs",
			"// explains why this avoids packages/cli/dist\nexport const x = 1;\n",
		);
		assert.deepEqual(findDistDependentFiles([f]), []);
	});

	it("returns nothing for a file with neither forbidden reference", () => {
		const f = write(
			"a.mjs",
			'import { readFileSync } from "node:fs";\nexport const x = 1;\n',
		);
		assert.deepEqual(findDistDependentFiles([f]), []);
	});
});
