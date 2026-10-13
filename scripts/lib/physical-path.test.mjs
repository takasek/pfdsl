import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePhysicalPath } from "./physical-path.mjs";

test("physical observations resolve symlinks before parent components and retain missing leaves", () => {
	const root = mkdtempSync(
		fileURLToPath(
			new URL("../../node_modules/pfdsl-physical-", import.meta.url),
		),
	);
	const own = join(root, "own");
	const primary = join(root, "primary");
	try {
		mkdirSync(own);
		mkdirSync(join(primary, "sub"), { recursive: true });
		writeFileSync(join(primary, "a"), "a");
		symlinkSync(join(primary, "sub"), join(own, "link"));
		symlinkSync(join(primary, "a"), join(own, "file"));
		symlinkSync(join(primary, "absent"), join(own, "dangling"));
		assert.equal(
			resolvePhysicalPath(`${own}/link/../a`, own),
			join(primary, "a"),
		);
		assert.equal(
			resolvePhysicalPath("link/../new/a", own),
			join(primary, "new/a"),
		);
		assert.equal(resolvePhysicalPath("new/a", own), join(own, "new/a"));
		assert.equal(resolvePhysicalPath("file", own), join(primary, "a"));
		assert.equal(
			resolvePhysicalPath("file", own, { followFinalSymlink: false }),
			join(own, "file"),
		);
		assert.throws(() => resolvePhysicalPath("dangling", own));
		assert.throws(() => resolvePhysicalPath("a", null));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
