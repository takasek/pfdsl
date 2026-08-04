import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCliEntrypoint } from "./cli-entrypoint.mjs";

describe("isCliEntrypoint", () => {
	// #707: node resolves symlinks when it builds import.meta.url but leaves
	// argv[1] as it was typed, so `import.meta.url === \`file://${argv[1]}\``
	// answers "not the entrypoint" whenever the invocation path crosses a
	// symlink — /tmp on macOS, or a checkout reached through one. The scripts
	// carrying that comparison fall back to module mode without a word.
	const realpath = (p) =>
		p.startsWith("/tmp/") ? p.replace("/tmp/", "/private/tmp/") : p;

	it("recognises the entrypoint when the invocation path crosses a symlink", () => {
		assert.equal(
			isCliEntrypoint(
				"file:///private/tmp/scripts/s.mjs",
				"/tmp/scripts/s.mjs",
				{ realpath },
			),
			true,
		);
	});

	it("recognises the entrypoint when no symlink is involved", () => {
		assert.equal(
			isCliEntrypoint("file:///opt/scripts/s.mjs", "/opt/scripts/s.mjs", {
				realpath,
			}),
			true,
		);
	});

	it("rejects a different module imported by the entrypoint", () => {
		assert.equal(
			isCliEntrypoint("file:///opt/scripts/lib.mjs", "/opt/scripts/s.mjs", {
				realpath,
			}),
			false,
		);
	});

	it("rejects an absent argv[1]", () => {
		assert.equal(
			isCliEntrypoint("file:///opt/scripts/s.mjs", undefined, { realpath }),
			false,
		);
	});

	it("falls back to the verbatim comparison when the path cannot be resolved", () => {
		const throwing = () => {
			throw new Error("ENOENT");
		};
		assert.equal(
			isCliEntrypoint("file:///opt/scripts/s.mjs", "/opt/scripts/s.mjs", {
				realpath: throwing,
			}),
			true,
		);
	});

	// pathToFileURL, not string concatenation: a path component that needs
	// percent-encoding makes the two forms differ even without a symlink.
	it("recognises a path whose characters need percent-encoding in a URL", () => {
		assert.equal(
			isCliEntrypoint(
				"file:///opt/my%20scripts/s.mjs",
				"/opt/my scripts/s.mjs",
				{ realpath },
			),
			true,
		);
	});
});
