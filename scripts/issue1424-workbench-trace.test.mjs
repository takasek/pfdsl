import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	bestEffort,
	closeTrace,
	installTrace,
	preserveSession,
} from "./issue1424-diagnostics/trace-workbench.mjs";

test("a pending diagnostic does not block the original cleanup", async () => {
	let timer;
	try {
		const completed = await Promise.race([
			bestEffort("pending injected diagnostic", () => new Promise(() => {}), {
				timeoutMs: 10,
			}).then(() => true),
			new Promise((resolve) => {
				timer = setTimeout(() => resolve(false), 100);
			}),
		]);
		assert.equal(completed, true);
	} finally {
		clearTimeout(timer);
	}
});

test("disabled trace does not inspect fake host and preserves result", async () => {
	const previous = process.env.PFDSL_DOM_LOG;
	delete process.env.PFDSL_DOM_LOG;
	try {
		const result = { ok: true };
		assert.equal(await closeTrace({}, {}, async () => result), result);
	} finally {
		if (previous === undefined) delete process.env.PFDSL_DOM_LOG;
		else process.env.PFDSL_DOM_LOG = previous;
	}
});
test("failed diagnostic collection does not replace close error or skip operation", async () => {
	const previous = process.env.PFDSL_DOM_LOG;
	process.env.PFDSL_DOM_LOG = "/unused-diagnostic-path";
	const page = {
		evaluate: async () => {
			throw new Error("injected page diagnostic error");
		},
	};
	const source = {
		getByRole: () => ({
			evaluate: async () => {
				throw new Error("injected target diagnostic error");
			},
		}),
	};
	const original = new Error("original close failure");
	let operations = 0;
	try {
		await assert.rejects(
			closeTrace(page, source, async () => {
				operations++;
				throw original;
			}),
			(e) => e === original,
		);
		assert.equal(operations, 1);
	} finally {
		if (previous === undefined) delete process.env.PFDSL_DOM_LOG;
		else process.env.PFDSL_DOM_LOG = previous;
	}
});
test("failed diagnostic collection preserves successful close result", async () => {
	const previous = process.env.PFDSL_DOM_LOG;
	process.env.PFDSL_DOM_LOG = "/unused-diagnostic-path";
	const page = {
		evaluate: async () => {
			throw new Error("injected page diagnostic error");
		},
	};
	const source = {
		getByRole: () => ({
			evaluate: async () => {
				throw new Error("injected target diagnostic error");
			},
		}),
	};
	const result = { sourceTabs: 0, previewTabs: 1, groups: 1 };
	try {
		assert.equal(await closeTrace(page, source, async () => result), result);
	} finally {
		if (previous === undefined) delete process.env.PFDSL_DOM_LOG;
		else process.env.PFDSL_DOM_LOG = previous;
	}
});

test("DOM observer installation failure does not block the original launch", async () => {
	const previous = process.env.PFDSL_DOM_LOG;
	process.env.PFDSL_DOM_LOG = "/unused-diagnostic-path";
	try {
		await installTrace({
			evaluate: async () => {
				throw new Error("injected install failure");
			},
		});
	} finally {
		if (previous === undefined) delete process.env.PFDSL_DOM_LOG;
		else process.env.PFDSL_DOM_LOG = previous;
	}
});

test("missing Code logs or screenshot do not prevent other evidence preservation", async () => {
	const previous = process.env.PFDSL_EVIDENCE_DIR;
	const root = await mkdtemp(join(tmpdir(), "pfdsl-1424-preserve-"));
	process.env.PFDSL_EVIDENCE_DIR = root;
	try {
		const fixturePath = join(root, "source.txt");
		await writeFile(fixturePath, "retained source");
		await preserveSession({
			page: {
				screenshot: async () => {
					throw new Error("injected screenshot failure");
				},
			},
			profileDir: join(root, "absent-profile"),
			fixturePath,
			output: {
				stdout: () => "original stdout",
				stderr: () => "original stderr",
			},
		});
		assert.equal(
			await readFile(join(root, "fixture-final.pfdsl"), "utf8"),
			"retained source",
		);
		assert.equal(
			await readFile(join(root, "code.stdout.txt"), "utf8"),
			"original stdout",
		);
		assert.equal(
			await readFile(join(root, "code.stderr.txt"), "utf8"),
			"original stderr",
		);
	} finally {
		if (previous === undefined) delete process.env.PFDSL_EVIDENCE_DIR;
		else process.env.PFDSL_EVIDENCE_DIR = previous;
		await rm(root, { recursive: true });
	}
});
