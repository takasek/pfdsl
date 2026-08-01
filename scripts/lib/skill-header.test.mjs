import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SKILL_HEADER, injectGeneratedHeader } from "./skill-header.mjs";

describe("injectGeneratedHeader", () => {
	it("inserts the header inside the frontmatter, leaving the rest byte-identical", () => {
		const template = "---\nname: pfdsl\ndescription: |\n  multi\n  line\n---\n\n# Title\n\ntext\n";
		const out = injectGeneratedHeader(template);
		assert.equal(out, `---\n${SKILL_HEADER}\n${template.slice("---\n".length)}`);
	});

	it("names a single authoritative file, not a directory", () => {
		// A directory-only pointer leaves the reader guessing which file to edit.
		assert.match(SKILL_HEADER, /blob\/main\/scripts\/skill-template\/SKILL\.md$/);
	});

	it("carries no regeneration command — that is upstream-only and must not ship", () => {
		assert.doesNotMatch(SKILL_HEADER, /make |Re-run|npm |pnpm /);
	});

	it("rejects a template that already carries a DO NOT EDIT line", () => {
		// The template is the file maintainers are supposed to edit. If it warns
		// against editing itself, they bail out at the real source.
		assert.throws(
			() => injectGeneratedHeader("---\n# DO NOT EDIT — generated from somewhere\nname: pfdsl\n---\n"),
			/must not carry a DO NOT EDIT header/,
		);
	});

	it("accepts a CRLF template and injects the header with CRLF too", () => {
		// A Windows checkout with core.autocrlf=true hands the generator CRLF.
		// The generator used to be pure .replace() and never saw line endings, so
		// rejecting them here would break a platform that used to work. Emitting an
		// LF line into a CRLF document would mix endings the author owns (#644).
		const template = "---\r\nname: pfdsl\r\n---\r\n\r\n# Title\r\n";
		const out = injectGeneratedHeader(template);
		assert.equal(out, `---\r\n${SKILL_HEADER}\r\n${template.slice("---\r\n".length)}`);
	});

	it("still rejects a DO NOT EDIT header in a CRLF template", () => {
		assert.throws(
			() => injectGeneratedHeader("---\r\n# DO NOT EDIT — x\r\nname: pfdsl\r\n---\r\n"),
			/must not carry a DO NOT EDIT header/,
		);
	});

	it("rejects a template with no frontmatter", () => {
		assert.throws(() => injectGeneratedHeader("# Title\n"), /must start with a YAML frontmatter/);
	});

	it("rejects a template whose frontmatter is never closed", () => {
		// Scanning to end-of-file instead would let a body mention of the phrase
		// satisfy the DO NOT EDIT guard, so the guard must see a bounded block.
		assert.throws(
			() => injectGeneratedHeader("---\nname: pfdsl\n\n# Title\n"),
			/must start with a YAML frontmatter/,
		);
	});
});
