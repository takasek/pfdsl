import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { findShellStringInterpolations } from "./check-no-shell-strings.mjs";

describe("findShellStringInterpolations", () => {
	it("flags a template literal spliced into execSync", () => {
		const found = findShellStringInterpolations('execSync(`git show ${ref}`);');
		assert.equal(found.length, 1);
	});

	it("flags string concatenation spliced into execSync", () => {
		const found = findShellStringInterpolations('execSync("git show " + ref);');
		assert.equal(found.length, 1);
	});

	it("leaves a constant command line alone, since nothing can be injected", () => {
		assert.deepEqual(findShellStringInterpolations(`execSync('git ls-files "*.md"');`), []);
	});

	it("leaves execFileSync alone, which takes argv rather than a command line", () => {
		assert.deepEqual(findShellStringInterpolations("execFileSync(`git`, [`show`, ref]);"), []);
	});

	it("leaves a template literal in an argv array alone", () => {
		assert.deepEqual(findShellStringInterpolations('execFileSync("git", ["show", `${ref}:file`]);'), []);
	});

	it("reports the line the call is on", () => {
		const found = findShellStringInterpolations("const a = 1;\n\nexecSync(`rm ${path}`);");
		assert.equal(found[0].line, 3);
	});

	it("finds every offending call in a file, not just the first", () => {
		const found = findShellStringInterpolations("execSync(`a ${x}`);\nexecSync(`b ${y}`);");
		assert.equal(found.length, 2);
	});

	it("does not end the argument early at a comma inside the interpolation", () => {
		const found = findShellStringInterpolations("execSync(`git log ${fmt(a, b)}`);");
		assert.equal(found.length, 1);
	});
});
