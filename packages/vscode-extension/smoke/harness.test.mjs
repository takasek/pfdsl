import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	cacheLockWaitTimeoutMs,
	createRunDirectory,
	expectEventually,
	findWebviewFrame,
	makeLaunchArgs,
	makeVSCodeCacheLockPath,
	makeVSCodeCachePath,
	parseTransform,
	populateVSCodeCache,
	prepareVSCodeCachePath,
	readTransform,
	removeRunDirectory,
} from "./harness.mjs";
import {
	appendCleanupDiagnostics,
	appendExtensionHostLogDiagnostics,
	appendWebviewFailureSnapshot,
	assertVisibleCount,
	cleanupSmokeSession,
	closeSourceTab,
	coldRenderTimeoutMs,
	collectWebviewFailureSnapshot,
	findTextEndPosition,
	isCursorNavigationTransition,
	isWithinScaleTolerance,
	minimapClickChangesPan,
	minimapDragChangesPan,
	parseSourceTabConsoleEvent,
	parseStatusCursorPosition,
	quickInputValue,
	resolveVSCodeExecutablePath,
	startSourceTabCapture,
	waitForColdRender,
	waitForStatusCursorPosition,
	waitForVisibleCount,
	waitForWorkbenchPage,
	withWorkbenchOperation,
} from "./run.mjs";

test("tab console events discard decoration and private fields without inventing array order", () => {
	const producer = "00000000-0000-0000-0000-000000000001";
	const event = {
		producer,
		phase: "tabs",
		sequence: 1,
		time: 42,
		opened: [2],
		closed: [1],
		uri: "/private/source.pfdsl",
		source: "private body",
	};
	const text = `%c[Extension Host] %cPFDSL_CLOSE_TAB_EVENT ${JSON.stringify(event)} color: blue (at /private/extension.js:1)`;
	assert.deepEqual(parseSourceTabConsoleEvent(text), {
		producer,
		phase: "tabs",
		sequence: 1,
		time: 42,
		opened: [2],
		closed: [1],
	});
	assert.equal(parseSourceTabConsoleEvent("unrelated console output"), null);
	assert.equal(
		parseSourceTabConsoleEvent("PFDSL_CLOSE_TAB_EVENT {broken}"),
		null,
	);
	assert.equal(
		parseSourceTabConsoleEvent(
			'PFDSL_CLOSE_TAB_EVENT {"phase":"tabs","sequence":1,"time":42,"opened":["private"],"closed":[]}',
		),
		null,
	);
});

test("tab capture records start, disposal, gaps, missing tails and listener removal", () => {
	let listener;
	const page = {
		on: (type, handler) => {
			assert.equal(type, "console");
			listener = handler;
		},
		off: (type, handler) => {
			assert.equal(type, "console");
			assert.equal(handler, listener);
			listener = undefined;
		},
	};
	const send = (event) =>
		listener({
			text: () =>
				`PFDSL_CLOSE_TAB_EVENT ${JSON.stringify({ producer: "00000000-0000-0000-0000-000000000001", ...event })}`,
		});
	const capture = startSourceTabCapture(page);
	send({ phase: "start", sequence: 0, time: 1 });
	send({ phase: "tabs", sequence: 1, time: 2, opened: [2], closed: [1] });
	send({ phase: "dispose", sequence: 1, time: 3 });
	const result = capture.stop();
	assert.equal(listener, undefined);
	assert.equal(result.startObserved, true);
	assert.equal(result.sequenceContinuous, true);
	assert.equal(result.sourceEndObserved, true);
	assert.equal(result.tailUnverified, false);
	assert.equal(result.events.length, 3);
	const incomplete = startSourceTabCapture(page);
	send({ phase: "start", sequence: 0, time: 1 });
	send({ phase: "tabs", sequence: 2, time: 2, opened: [], closed: [1] });
	listener({ text: () => "PFDSL_CLOSE_TAB_EVENT malformed" });
	send({ phase: "dispose", sequence: 1, time: 3 });
	const missing = incomplete.stop();
	assert.equal(missing.sequenceContinuous, false);
	assert.equal(missing.invalidMessages, 1);
	assert.equal(missing.sourceEndObserved, false);
	assert.equal(missing.tailUnverified, true);
	assert.equal(startSourceTabCapture(page).stop().startObserved, false);
	const mixed = startSourceTabCapture(page);
	send({ phase: "start", sequence: 0, time: 1 });
	send({ phase: "dispose", sequence: 0, time: 2 });
	send({ phase: "start", sequence: 0, time: 3 });
	send({ phase: "dispose", sequence: 0, time: 4 });
	const multiple = mixed.stop();
	assert.equal(multiple.sequenceContinuous, false);
	assert.equal(multiple.sourceEndObserved, false);
	assert.equal(multiple.tailUnverified, true);
	const foreign = startSourceTabCapture(page);
	send({
		phase: "start",
		sequence: 0,
		time: 1,
		producer: "00000000-0000-0000-0000-000000000001",
	});
	send({
		phase: "dispose",
		sequence: 0,
		time: 2,
		producer: "00000000-0000-0000-0000-000000000002",
	});
	assert.equal(foreign.stop().sourceEndObserved, false);
});

test("command palette replacement keeps the command provider prefix", () => {
	assert.equal(
		quickInputValue("command", "File: Revert File"),
		">File: Revert File",
	);
	assert.equal(
		quickInputValue("file", "/tmp/fixture.pfdsl"),
		"/tmp/fixture.pfdsl",
	);
});

test("source close targets its own close button and checks tab and preview survival", async () => {
	const observations = [
		{ sourceTabs: 1, previewTabs: 1, groups: 2 },
		{ sourceTabs: 0, previewTabs: 1, groups: 1 },
	];
	const clicks = [];
	const sourceTab = {
		getByRole: (role, options) => ({
			click: async () => clicks.push({ role, options }),
		}),
	};
	const state = await closeSourceTab({}, sourceTab, {
		readState: async () => observations.shift(),
		log: () => {},
	});
	assert.deepEqual(clicks, [
		{ role: "button", options: { name: /^Close \(/ } },
	]);
	assert.deepEqual(state, { sourceTabs: 0, previewTabs: 1, groups: 1 });
});

test("an absent source and one group do not pass when the preview was closed", async () => {
	await assert.rejects(
		closeSourceTab(
			{},
			{ getByRole: () => ({ click: async () => {} }) },
			{
				readState: async () => ({ sourceTabs: 0, previewTabs: 0, groups: 1 }),
				log: () => {},
				timeoutMs: 1,
			},
		),
		/sourceTabs.*previewTabs/,
	);
});

test("workbench operation diagnostics identify the failing step and preserve its stack", async () => {
	const original = new Error("input disappeared");
	original.stack =
		"Error: input disappeared\n    at fixtureReload (smoke/run.mjs:1078:2)";
	const events = [];
	await assert.rejects(
		withWorkbenchOperation(
			{},
			"reload: quick open fill",
			async () => {
				throw original;
			},
			{
				readState: async () => ({ documentFocused: false, quickInputs: [] }),
				log: (event) => events.push(event),
			},
		),
		(error) => {
			assert.equal(error.cause, original);
			assert.match(error.message, /reload: quick open fill/);
			assert.match(error.message, /smoke\/run.mjs:1078:2/);
			return true;
		},
	);
	assert.deepEqual(
		events.map((event) => event.phase),
		["before", "failed"],
	);
});

test("state collection failures do not replace the original workbench failure", async () => {
	const original = new Error("close failed");
	await assert.rejects(
		withWorkbenchOperation(
			{},
			"source close",
			async () => {
				throw original;
			},
			{
				readState: async () => {
					throw new Error("page closed");
				},
				log: () => {},
			},
		),
		(error) =>
			error.cause === original && error.message.includes("page closed"),
	);
});

function minimumNodeMajor(engineRange) {
	const match = /^>=\s*(\d+)(?:\.\d+\.\d+)?$/.exec(engineRange);
	assert.ok(
		match,
		`expected a simple minimum Node engine range, got ${engineRange}`,
	);
	return Number(match[1]);
}

test("makeLaunchArgs isolates the run and opens the fixture", () => {
	assert.deepEqual(
		makeLaunchArgs({
			repoRoot: "/repo",
			profileDir: "/tmp/profile",
			extensionsDir: "/tmp/extensions",
			port: 9337,
			fixturePath: "/repo/docs/samples/01-simple-chain.pfdsl",
			platform: "darwin",
		}),
		[
			"--new-window",
			"--skip-welcome",
			"--disable-workspace-trust",
			"--user-data-dir=/tmp/profile",
			"--extensions-dir=/tmp/extensions",
			"--remote-debugging-port=9337",
			"--extensionDevelopmentPath=/repo/packages/vscode-extension",
			"/repo/docs/samples/01-simple-chain.pfdsl",
		],
	);
});

test("makeLaunchArgs disables the Chromium sandbox on Linux", () => {
	assert.equal(
		makeLaunchArgs({
			repoRoot: "/repo",
			profileDir: "/tmp/profile",
			extensionsDir: "/tmp/extensions",
			port: 9337,
			fixturePath: "/repo/docs/samples/01-simple-chain.pfdsl",
			platform: "linux",
		}).includes("--no-sandbox"),
		true,
	);
});

test("executable smoke dependencies support the extension's declared Node version", async () => {
	const extensionPackage = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	const supportedNodeMajor = minimumNodeMajor(extensionPackage.engines.node);
	for (const dependency of ["@vscode/test-electron", "playwright-core"]) {
		const dependencyPackage = JSON.parse(
			await readFile(
				new URL(`../node_modules/${dependency}/package.json`, import.meta.url),
				"utf8",
			),
		);
		assert.equal(
			minimumNodeMajor(dependencyPackage.engines.node) <= supportedNodeMajor,
			true,
			`${dependency} requires ${dependencyPackage.engines.node}, but the extension supports ${extensionPackage.engines.node}`,
		);
	}
});

test("makeVSCodeCachePath keeps a stable worktree-specific cache outside the repository", () => {
	const first = makeVSCodeCachePath("/repo/.worktrees/one", {
		temporaryDirectory: "/tmp",
	});
	assert.equal(
		first,
		makeVSCodeCachePath("/repo/.worktrees/one", {
			temporaryDirectory: "/tmp",
		}),
	);
	assert.notEqual(
		first,
		makeVSCodeCachePath("/repo/.worktrees/two", {
			temporaryDirectory: "/tmp",
		}),
	);
	assert.match(first, /^\/tmp\/pfdsl-vscode-smoke-cache\//);
	assert.doesNotMatch(first, /^\/repo\//);
	assert.equal(
		makeVSCodeCachePath("/ci/work/pfdsl/pfdsl", {
			temporaryDirectory: "/tmp",
		}),
		"/tmp/pfdsl-vscode-smoke-cache/pfdsl",
	);
});

test("prepareVSCodeCachePath creates the stable external cache directory", async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), "pfdsl-vscode-cache-test-"),
	);
	try {
		const cachePath = await prepareVSCodeCachePath("/repo/.worktrees/one", {
			temporaryDirectory,
		});
		await access(cachePath);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});

test("populateVSCodeCache lets a second caller wait without concurrent population", async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), "pfdsl-vscode-cache-test-"),
	);
	try {
		const cachePath = await prepareVSCodeCachePath("/repo/.worktrees/one", {
			temporaryDirectory,
		});
		let populateCalls = 0;
		let releasePopulation;
		const first = populateVSCodeCache(
			cachePath,
			"1.132.1",
			async () => {
				populateCalls += 1;
				await new Promise((resolvePopulation) => {
					releasePopulation = resolvePopulation;
				});
				return "first";
			},
			{ retryIntervalMs: 1, timeoutMs: 100 },
		);
		await expectEventually(
			"first cache population starts",
			async () => populateCalls,
			(value) => value === 1,
			{ retryIntervalMs: 0, timeoutMs: 100 },
		);
		let secondResolved = false;
		const second = populateVSCodeCache(
			cachePath,
			"1.132.1",
			async () => {
				populateCalls += 1;
				return "second";
			},
			{ retryIntervalMs: 1, timeoutMs: 100 },
		).then((value) => {
			secondResolved = true;
			return value;
		});
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
		assert.equal(populateCalls, 1);
		assert.equal(secondResolved, false);
		releasePopulation();
		assert.equal(await first, "first");
		assert.equal(await second, null);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});

test("populateVSCodeCache releases its lock when population fails", async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), "pfdsl-vscode-cache-test-"),
	);
	try {
		const cachePath = await prepareVSCodeCachePath("/repo/.worktrees/one", {
			temporaryDirectory,
		});
		await assert.rejects(
			populateVSCodeCache(cachePath, "1.132.1", async () => {
				throw new Error("download failed");
			}),
			/download failed/,
		);
		assert.equal(
			await populateVSCodeCache(cachePath, "1.132.1", async () => "recovered"),
			"recovered",
		);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});

test("populateVSCodeCache reports stale and timed-out locks", async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), "pfdsl-vscode-cache-test-"),
	);
	try {
		const cachePath = await prepareVSCodeCachePath("/repo/.worktrees/one", {
			temporaryDirectory,
		});
		await mkdir(makeVSCodeCacheLockPath(cachePath));
		await assert.rejects(
			populateVSCodeCache(cachePath, "1.132.1", async () => "unreachable", {
				staleLockMs: 0,
			}),
			/stale VS Code cache lock/,
		);
		await rm(makeVSCodeCacheLockPath(cachePath), {
			recursive: true,
			force: true,
		});
		await mkdir(makeVSCodeCacheLockPath(cachePath));
		await assert.rejects(
			populateVSCodeCache(cachePath, "1.132.1", async () => "unreachable", {
				retryIntervalMs: 0,
				staleLockMs: 1_000,
				timeoutMs: 5,
			}),
			/timed out waiting for VS Code cache lock/,
		);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});

test("populateVSCodeCache lets a healthy heartbeat outlive the former one-minute wait", async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), "pfdsl-vscode-cache-test-"),
	);
	try {
		const cachePath = await prepareVSCodeCachePath("/repo/.worktrees/one", {
			temporaryDirectory,
		});
		let clock = 1_000_000;
		let populateCalls = 0;
		let releasePopulation;
		let heartbeat;
		let cleared = false;
		const first = populateVSCodeCache(
			cachePath,
			"1.132.1",
			async () => {
				populateCalls += 1;
				await new Promise((resolvePopulation) => {
					releasePopulation = resolvePopulation;
				});
				return "first";
			},
			{
				clearIntervalFn: () => {
					cleared = true;
				},
				now: () => clock,
				setIntervalFn: (callback) => {
					heartbeat = callback;
					return "heartbeat";
				},
			},
		);
		await expectEventually(
			"cache population starts",
			async () => populateCalls,
			(value) => value === 1,
			{ retryIntervalMs: 0, timeoutMs: 100 },
		);
		assert.deepEqual(
			JSON.parse(
				await readFile(
					join(makeVSCodeCacheLockPath(cachePath), "owner.json"),
					"utf8",
				),
			),
			{ pid: process.pid, startedAt: clock },
		);
		let waits = 0;
		const second = populateVSCodeCache(
			cachePath,
			"1.132.1",
			async () => {
				populateCalls += 1;
				return "second";
			},
			{
				now: () => clock,
				retryIntervalMs: 0,
				staleLockMs: 30_000,
				wait: async () => {
					clock += 20_000;
					await heartbeat();
					waits += 1;
					if (waits === 4) releasePopulation();
				},
			},
		);
		assert.equal(await first, "first");
		assert.equal(await second, null);
		assert.equal(populateCalls, 1);
		assert.equal(clock - 1_000_000 > 60_000, true);
		assert.equal(cacheLockWaitTimeoutMs, 8 * 60_000);
		assert.equal(cleared, true);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});

test("populateVSCodeCache fails closed when a lock has no fresh heartbeat", async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), "pfdsl-vscode-cache-test-"),
	);
	try {
		const cachePath = await prepareVSCodeCachePath("/repo/.worktrees/one", {
			temporaryDirectory,
		});
		const lockPath = makeVSCodeCacheLockPath(cachePath);
		await mkdir(lockPath);
		await writeFile(join(lockPath, "owner.json"), '{"pid":1}\n');
		await utimes(lockPath, new Date(1_000), new Date(1_000));
		await assert.rejects(
			populateVSCodeCache(cachePath, "1.132.1", async () => "unreachable", {
				now: () => 31_000,
				staleLockMs: 30_000,
			}),
			/stale VS Code cache lock/,
		);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});

test("parseTransform reads the webview translate and scale", () => {
	assert.deepEqual(parseTransform("translate(12.5px, -8px) scale(1.1)"), {
		panX: 12.5,
		panY: -8,
		scale: 1.1,
	});
});

test("isWithinScaleTolerance rejects visible scale drift", () => {
	assert.equal(isWithinScaleTolerance(1, 1 + 0.000_000_5), true);
	assert.equal(isWithinScaleTolerance(1, 1 + 0.000_01), false);
});

test("findTextEndPosition derives the first node selection endpoint", () => {
	assert.deepEqual(
		findTextEndPosition("requirements >> design -> spec", "design"),
		{ line: 1, column: 23 },
	);
});

test("isCursorNavigationTransition requires movement to the fixture endpoint", () => {
	const expected = { line: 1, column: 23 };
	assert.equal(
		isCursorNavigationTransition(
			parseStatusCursorPosition("Ln 1, Col 1"),
			parseStatusCursorPosition(
				"PFDSLLFUTF-8Spaces: 4Ln 1, Col 23 (6 selected)",
			),
			expected,
		),
		true,
	);
	assert.equal(
		isCursorNavigationTransition(expected, expected, expected),
		false,
	);
});

test("expectEventually reports the last observed value", async () => {
	await assert.rejects(
		expectEventually(
			"scale changes",
			async () => 1,
			(value) => value > 1,
			{
				timeoutMs: 10,
			},
		),
		/scale changes.*last observed: 1/,
	);
});

test("readTransform reads the inline preview transform", async () => {
	const frame = {
		locator: (selector) => {
			assert.equal(selector, "#inner");
			return {
				evaluate: async (read) =>
					read({ style: { transform: "translate(12.5px, -8px) scale(1.1)" } }),
			};
		},
	};
	assert.deepEqual(await readTransform(frame), {
		panX: 12.5,
		panY: -8,
		scale: 1.1,
	});
});

test("findWebviewFrame ignores the outer and fake-empty frames", async () => {
	const frames = [
		{ url: () => "workbench.html", locator: () => ({ count: async () => 0 }) },
		{
			url: () => "vscode-webview://one/index.html",
			locator: () => ({ count: async () => 0 }),
		},
		{
			url: () => "vscode-webview://one/fake.html",
			locator: () => ({ count: async () => 1 }),
		},
	];
	assert.equal(await findWebviewFrame({ frames: () => frames }), frames[2]);
});

test("assertVisibleCount rejects an invisible preview element", async () => {
	const locator = {
		count: async () => 1,
		nth: () => ({ isVisible: async () => false }),
	};
	await assert.rejects(
		assertVisibleCount(locator, 1, "preview SVG"),
		/preview SVG: expected 1 visible element, observed 0/,
	);
});

test("waitForVisibleCount waits for the preview to render", async () => {
	let reads = 0;
	const locator = {
		count: async () => 1,
		nth: () => ({ isVisible: async () => reads++ > 0 }),
	};
	assert.equal(
		await waitForVisibleCount(locator, 1, "preview SVG", {
			retryIntervalMs: 0,
			timeoutMs: 100,
		}),
		1,
	);
});

test("waitForColdRender gives initial webview rendering at least thirty seconds", async () => {
	const calls = [];
	await waitForColdRender({}, 1, "preview SVG", {
		waitForVisible: async (...args) => {
			calls.push(args);
			return 1;
		},
	});
	assert.equal(coldRenderTimeoutMs >= 30_000, true);
	assert.equal(calls[0][3].timeoutMs, coldRenderTimeoutMs);
});

test("minimap click changes pan without changing scale", () => {
	const beforeClick = { panX: 20, panY: 10, scale: 1.1 };
	assert.equal(minimapClickChangesPan(beforeClick, beforeClick), false);
	assert.equal(
		minimapClickChangesPan(beforeClick, { panX: 40, panY: 30, scale: 1.1 }),
		true,
	);
	assert.equal(
		minimapClickChangesPan(beforeClick, { panX: 40, panY: 30, scale: 1.2 }),
		false,
	);
});

test("minimap drag requires movement after mouse down", () => {
	const afterMouseDown = { panX: 20, panY: 10, scale: 1.1 };
	assert.equal(minimapDragChangesPan(afterMouseDown, afterMouseDown), false);
	assert.equal(
		minimapDragChangesPan(afterMouseDown, { panX: 40, panY: 30, scale: 1.1 }),
		true,
	);
});

test("waitForStatusCursorPosition retries a transient missing cursor observation", async () => {
	const observations = ["Loading preview", "Ln 1, Col 23"];
	const page = {
		getByRole: () => ({
			count: async () => 1,
			textContent: async () => observations.shift(),
		}),
	};
	assert.deepEqual(
		await waitForStatusCursorPosition(page, "source cursor", {
			retryIntervalMs: 0,
			timeoutMs: 100,
		}),
		{ line: 1, column: 23 },
	);
});

test("collectWebviewFailureSnapshot reports semantic webview state", async () => {
	const rectangle = (left, top, width, height) => ({
		getBoundingClientRect: () => ({ left, top, width, height }),
	});
	const inner = {
		...rectangle(10, 20, 300, 200),
		style: { transform: "translate(12px, -8px) scale(1.1)" },
	};
	const root = {
		...rectangle(1, 2, 640, 480),
		querySelector: (selector) =>
			({
				"#inner": inner,
				"#inner svg": rectangle(10, 20, 300, 200),
				"#minimap": rectangle(500, 20, 120, 90),
				"#minimap-vp": rectangle(510, 30, 60, 45),
			})[selector] ?? null,
		querySelectorAll: (selector) => {
			if (selector === "#inner g.node[data-node-id]")
				return [
					{ getAttribute: () => "design" },
					{ getAttribute: () => "spec" },
				];
			return [];
		},
		ownerDocument: {
			querySelectorAll: (selector) => {
				assert.equal(selector, "script[src]");
				return [{ src: "vscode-webview://webview/webview.js" }];
			},
		},
	};
	root.querySelector = (selector) =>
		({
			"#inner": inner,
			"#inner svg": rectangle(10, 20, 300, 200),
			"#minimap": rectangle(500, 20, 120, 90),
			"#minimap-vp": rectangle(510, 30, 60, 45),
			".err": {
				getClientRects: () => [{ width: 1 }],
				textContent: "Invalid edge",
			},
		})[selector] ?? null;
	const frame = {
		url: () => "vscode-webview://webview/fake.html",
		locator: (selector) => {
			assert.equal(selector, "#root");
			return { evaluate: async (read) => read(root) };
		},
	};
	assert.deepEqual(await collectWebviewFailureSnapshot(frame), {
		frameUrl: "vscode-webview://webview/fake.html",
		root: { left: 1, top: 2, width: 640, height: 480 },
		svg: { left: 10, top: 20, width: 300, height: 200 },
		minimap: { left: 500, top: 20, width: 120, height: 90 },
		minimapViewport: { left: 510, top: 30, width: 60, height: 45 },
		transform: "translate(12px, -8px) scale(1.1)",
		nodeIds: ["design", "spec"],
		scriptSrcs: ["vscode-webview://webview/webview.js"],
		err: { visible: true, text: "Invalid edge" },
	});
});

test("appendWebviewFailureSnapshot appends the selected frame diagnostic", async () => {
	const root = {
		getBoundingClientRect: () => ({ left: 1, top: 2, width: 3, height: 4 }),
		querySelector: () => null,
		querySelectorAll: () => [],
		ownerDocument: { querySelectorAll: () => [] },
	};
	const frame = {
		url: () => "vscode-webview://webview/fake.html",
		locator: () => ({ evaluate: async (read) => read(root) }),
	};
	const error = await appendWebviewFailureSnapshot(
		new Error("preview interaction failed"),
		frame,
	);
	assert.match(error.message, /preview interaction failed/);
	assert.match(error.message, /Webview snapshot/);
	assert.match(error.message, /vscode-webview:\/\/webview\/fake.html/);
});

test("primary failures retain extension-host logs, semantic snapshots, and cleanup failures", async () => {
	const runDir = await createRunDirectory();
	const profileDir = join(runDir, "profile");
	try {
		const logPath = join(profileDir, "logs", "window1", "exthost1.log");
		await mkdir(join(profileDir, "logs", "window1"), { recursive: true });
		await writeFile(
			logPath,
			`discarded extension output\n${"x".repeat(6_000)}extension host tail`,
		);
		await writeFile(
			join(profileDir, "logs", "window1", "other.log"),
			"ignore me",
		);
		const root = {
			getBoundingClientRect: () => ({ left: 1, top: 2, width: 3, height: 4 }),
			querySelector: () => null,
			querySelectorAll: () => [],
			ownerDocument: { querySelectorAll: () => [] },
		};
		const frame = {
			url: () => "vscode-webview://webview/fake.html",
			locator: () => ({ evaluate: async (read) => read(root) }),
		};
		const withSnapshot = await appendWebviewFailureSnapshot(
			new Error("primary preview failure"),
			frame,
		);
		const withLogs = await appendExtensionHostLogDiagnostics(
			withSnapshot,
			profileDir,
		);
		const combined = appendCleanupDiagnostics(withLogs, [
			new Error("cleanup profile failure"),
		]);
		assert.match(combined.message, /primary preview failure/);
		assert.match(combined.message, /Webview snapshot/);
		assert.match(combined.message, /exthost1\.log/);
		assert.match(combined.message, /extension host tail/);
		assert.doesNotMatch(combined.message, /discarded extension output/);
		assert.doesNotMatch(combined.message, /ignore me/);
		assert.match(combined.message, /cleanup profile failure/);
	} finally {
		await removeRunDirectory(runDir);
	}
});

test("extension-host diagnostics ignore noisy profile siblings", async () => {
	const runDir = await createRunDirectory();
	const profileDir = join(runDir, "profile");
	try {
		await Promise.all(
			Array.from({ length: 201 }, (_, index) =>
				mkdir(join(profileDir, `noise-${index}`), { recursive: true }),
			),
		);
		const logDir = join(profileDir, "logs", "window1");
		await mkdir(logDir, { recursive: true });
		await writeFile(
			join(logDir, "exthost1.log"),
			"extension host survived noise",
		);

		const error = await appendExtensionHostLogDiagnostics(
			new Error("preview failed"),
			profileDir,
		);

		assert.match(error.message, /exthost1\.log/);
		assert.match(error.message, /extension host survived noise/);
	} finally {
		await removeRunDirectory(runDir);
	}
});

test("resolveVSCodeExecutablePath handles recent macOS Code bundles", () => {
	const electronPath = "/tmp/Visual Studio Code.app/Contents/MacOS/Electron";
	const codePath = "/tmp/Visual Studio Code.app/Contents/MacOS/Code";
	assert.equal(
		resolveVSCodeExecutablePath(electronPath, {
			platform: "darwin",
			exists: (path) => path === codePath,
		}),
		codePath,
	);
});

test("waitForWorkbenchPage waits for the CDP workbench page", async () => {
	const page = {
		url: () =>
			"vscode-file://vscode-app/out/vs/code/electron-browser/workbench/workbench.html",
	};
	let reads = 0;
	const browser = {
		contexts: () => [{ pages: () => (reads++ === 0 ? [] : [page]) }],
	};
	assert.equal(
		await waitForWorkbenchPage(browser, {
			delay: async () => {},
			timeoutMs: 1_000,
		}),
		page,
	);
});

test("waitForWorkbenchPage ignores a non-workbench first page", async () => {
	const workbenchPage = {
		url: () =>
			"vscode-file://vscode-app/out/vs/code/electron-browser/workbench/workbench.html",
	};
	const browser = {
		contexts: () => [
			{
				pages: () => [
					{ url: () => "devtools://devtools/bundled/inspector.html" },
					workbenchPage,
				],
			},
		],
	};
	assert.equal(await waitForWorkbenchPage(browser), workbenchPage);
});

test("appendCleanupDiagnostics preserves the rendering diagnostic", () => {
	const primary = new Error(
		"preview SVG: expected 1 visible element, observed 0\nframe URLs: vscode-webview://preview\nstdout:\nextension host",
	);
	const combined = appendCleanupDiagnostics(primary, [
		new Error("remove run directory failed"),
	]);
	assert.match(combined.message, /preview SVG/);
	assert.match(combined.message, /vscode-webview:\/\/preview/);
	assert.match(combined.message, /remove run directory failed/);
});

test("cleanupSmokeSession removes the run directory after a browser cleanup failure", async () => {
	const runDir = await createRunDirectory();
	let closed;
	let killed = false;
	const vscodeProcess = {
		exitCode: null,
		signalCode: null,
		kill: () => {
			killed = true;
			vscodeProcess.exitCode = 0;
			closed();
		},
		once: (_event, callback) => {
			closed = callback;
		},
	};
	const errors = await cleanupSmokeSession({
		browser: {
			close: async () => Promise.reject(new Error("browser close failed")),
		},
		runDir,
		vscodeProcess,
	});
	assert.equal(errors.length, 1);
	assert.match(errors[0].message, /browser close failed/);
	assert.equal(killed, true);
	await assert.rejects(access(runDir), { code: "ENOENT" });
});

test("cleanupSmokeSession leaves no deadline keeping Node alive after SIGTERM", () => {
	const runModule = new URL("./run.mjs", import.meta.url).href;
	const harnessModule = new URL("./harness.mjs", import.meta.url).href;
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import assert from "node:assert/strict";
import { cleanupSmokeSession } from ${JSON.stringify(runModule)};
import { createRunDirectory } from ${JSON.stringify(harnessModule)};
let closed;
const vscodeProcess = {
  exitCode: null,
  signalCode: null,
  once: (_event, callback) => { closed = callback; },
  kill: () => { closed(); },
};
const errors = await cleanupSmokeSession({ vscodeProcess, runDir: await createRunDirectory() });
if (errors.length) throw errors[0];
assert.ok(!process.getActiveResourcesInfo().includes("Timeout"), "cleanup deadline still keeps Node alive");`,
		],
		{ encoding: "utf8", timeout: 10_000 },
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
});

test("cleanupSmokeSession force-kills after the grace period and waits for close", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const runDir = await createRunDirectory();
	const signals = [];
	let closed;
	let terminated;
	const sentTerm = new Promise((resolve) => {
		terminated = resolve;
	});
	const vscodeProcess = {
		exitCode: null,
		signalCode: null,
		once: (_event, callback) => {
			closed = callback;
		},
		kill: (signal) => {
			signals.push(signal);
			if (signal === "SIGTERM") terminated();
		},
	};
	let completed = false;
	const cleanup = cleanupSmokeSession({ runDir, vscodeProcess }).then(
		(errors) => {
			completed = true;
			return errors;
		},
	);
	t.after(async () => {
		closed?.();
		await cleanup;
	});
	await sentTerm;
	t.mock.timers.tick(4_999);
	await new Promise(setImmediate);
	assert.deepEqual(signals, ["SIGTERM"]);
	t.mock.timers.tick(1);
	await new Promise(setImmediate);
	assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
	assert.equal(completed, false);
	await access(runDir);
	closed();
	assert.deepEqual(await cleanup, []);
	await assert.rejects(access(runDir), { code: "ENOENT" });
});

test("cleanupSmokeSession leaves absent or already exited processes alone", async () => {
	for (const vscodeProcess of [
		undefined,
		{ exitCode: 0, signalCode: null },
		{ exitCode: null, signalCode: "SIGTERM" },
	]) {
		if (vscodeProcess) {
			vscodeProcess.kill = () => assert.fail("process is already closed");
		}
		const runDir = await createRunDirectory();
		assert.deepEqual(await cleanupSmokeSession({ vscodeProcess, runDir }), []);
		await assert.rejects(access(runDir), { code: "ENOENT" });
	}
});

test("removeRunDirectory refuses an unissued lookalike path", async () => {
	const lookalike = await mkdtemp(join(tmpdir(), "pfdsl-vscode-smoke-"));
	await writeFile(join(lookalike, "keep.txt"), "keep");
	await assert.rejects(removeRunDirectory(lookalike), /non-run directory/);
	await access(join(lookalike, "keep.txt"));
	await rm(lookalike, { recursive: true, force: true });
});

test("removeRunDirectory removes an issued run directory", async () => {
	const runDirectory = await createRunDirectory();
	await writeFile(join(runDirectory, "owned.txt"), "owned");
	await removeRunDirectory(runDirectory);
	await assert.rejects(access(runDirectory), { code: "ENOENT" });
});
