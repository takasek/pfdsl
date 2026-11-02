import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	createHarness,
	FakeNative,
	flush,
} from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("status-ui");

test("F1 recovery read failures name the Save As target", async () => {
	const native = new FakeNative();
	const a = native.add(1, "x/a.pfdsl", "a");
	const b = native.add(2, "y/b.pfdsl", "b");
	let failRead = false;
	const host = await startHost(native, a, {
		choose: () => native.snapshot(b),
		saveReply: () => ({
			outcome: "published-but-unconfirmed",
			publication: "unknown",
			targetState: "present",
			current: native.snapshot(b),
		}),
		inspectGate: (id) => {
			if (failRead && id === b.id) throw new Error("Disk unavailable");
		},
	});
	try {
		const tab = await host.open(a);
		tab.type("edited");
		await host.command("save-as");
		failRead = true;
		host.panel().review.click();
		await host.settle();
		assert.match(
			host.query("#status").textContent,
			/Save needs attention — a.pfdsl: Could not read b.pfdsl:/,
		);
	} finally {
		await host.finish();
	}
});

test("F2 free text retains longer paths with spaces and Rust errors verbatim", async () => {
	const host = await startHost(new FakeNative(), null, {
		listRecent: () => [{ kind: "folder", path: "/U/Project" }],
		clearRecent: () => {
			throw new Error(
				"Could not open /U/Project 2/x.pfd: gone; Rust: /U/Project: Permission denied (os error 13)",
			);
		},
	});
	try {
		await host.command("clear-recent");
		assert.equal(
			host.query("#status").textContent,
			"Application notice: Error: Could not open /U/Project 2/x.pfd: gone; Rust: /U/Project: Permission denied (os error 13)",
		);
	} finally {
		await host.finish();
	}
});

test("F3 added and changed lines scroll into view and disclose the count", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", "a");
	let readError = "Disk unavailable";
	const host = await startHost(native, a, {
		inspectGate: () => {
			throw new Error(readError);
		},
		listRecent: () => [{ kind: "file", path: a.path }],
		clearRecent: () => {
			throw new Error("Clear failed");
		},
	});
	try {
		const status = host.query("#status");
		Object.defineProperty(status, "clientHeight", { value: 20 });
		Object.defineProperty(status, "scrollHeight", {
			get: () => status.textContent.split("\n").length * 20,
		});
		const tab = await host.open(a);
		tab.type("edited");
		await host.command("save");
		await host.command("clear-recent");
		assert.equal(status.scrollTop, 20);
		assert.match(host.query("footer").textContent, /2 notices/);
		tab.report("New action");
		assert.equal(status.scrollTop, 20);
		assert.match(host.query("footer").textContent, /3 notices/);
		status.scrollTop = 0;
		tab.report("Changed action");
		assert.equal(status.scrollTop, 20);
		tab.report("Changed action\nwith details");
		assert.equal(host.query("#status-count").textContent, "3 notices");
		readError = "New read failure";
		await host.command("save");
		assert.equal(status.scrollTop, 0);
		assert.match(status.textContent, /^Save needs attention.*New read failure/);
		assert.match(
			status.textContent,
			/Application notice: Error: Clear failed$/,
		);
	} finally {
		await host.finish();
	}
});

test("Clear Menu reaches native storage and refreshes the menu from the start screen", async () => {
	let targets = [{ kind: "file", path: "/A/flow.pfdsl" }];
	const calls = [];
	const host = await startHost(new FakeNative(), null, {
		listRecent: () => {
			calls.push("list_recent");
			return targets;
		},
		clearRecent: () => {
			calls.push("clear_recent");
			targets = [];
		},
	});
	try {
		await host.command("clear-recent");
		assert.deepEqual(calls, ["list_recent", "clear_recent", "list_recent"]);
		assert.equal(host.menuItem("clear-recent").enabled, false);
		assert.equal(host.query("#status").textContent, "");
	} finally {
		await host.finish();
	}
});

test("bottom lines use tab names, retain every notice and expose full text in titles", async () => {
	const native = new FakeNative();
	const a = native.add(1, "left/shared/flow.pfdsl", "problem");
	const b = native.add(2, "right/shared/flow.pfdsl", "problem");
	const host = await startHost(native, a, {
		inspectGate: () => {
			throw new Error(`Cannot inspect ${a.path}`);
		},
		selectFolder: () => "/work/project",
	});
	try {
		const first = await host.open(a);
		const second = await host.open(b);
		first.button.click();
		first.type("problem edited");
		await host.command("save");
		second.button.click();
		second.report(`Checked ${b.path}. No changes.`);
		await host.command("open");
		const status = host.query("#status");
		assert.equal(
			status.textContent,
			[
				`Save needs attention — ${host.nameOf(first)}: Could not read ${host.nameOf(first)}: Error: Cannot inspect ${a.path}. The save was not attempted. Editor content is retained.`,
				`Last action — ${host.nameOf(second)}: Checked ${b.path}. No changes.`,
				"Application notice: Opened project. Save documents explicitly.",
			].join("\n"),
		);
		assert.ok(status.title.includes(a.path));
		assert.ok(status.title.includes(b.path));
		assert.ok(status.title.includes("/work/project"));
		assert.equal(
			host.query("#diagnostics").textContent,
			`Current diagnostics — ${host.nameOf(second)}: 0 errors, 1 warning, 0 informational messages`,
		);
		assert.ok(host.query("#diagnostics").title.includes(b.path));
		assert.equal(host.query("#document-location").textContent, b.path);
		assert.equal(host.query("#document-location").title, b.path);
		assert.equal(host.query("#dismiss-status").hidden, false);
	} finally {
		await host.finish();
	}
});

test("two path-less Sample tabs retain their shared name in status and use Untitled location", async () => {
	const native = new FakeNative();
	const host = await startHost(native, null);
	try {
		const tabs = [];
		for (let i = 0; i < 2; i++) {
			host.query("#try-sample").click();
			await host.settle();
			tabs.push(host.activeTab());
		}
		assert.notEqual(tabs[0], tabs[1]);
		for (const tab of tabs) {
			tab.button.click();
			await flush();
			tab.report("Checked.");
			assert.equal(host.nameOf(tab), "Sample");
			assert.equal(
				host.query("#status").textContent,
				"Last action — Sample: Checked.",
			);
			assert.equal(
				host.query("#status").title,
				"Last action — Sample: Checked.",
			);
			assert.equal(
				host.query("#diagnostics").textContent,
				"Current diagnostics — Sample: No problems",
			);
			assert.equal(host.query("#document-location").textContent, "Untitled");
			assert.equal(host.query("#document-location").title, "Untitled");
			assert.equal(host.query("#document-state").textContent, "Not saved");
		}
	} finally {
		await host.finish();
	}
});

test("Save As notices identify another same-name tab with its visible distinguishing suffix", async () => {
	const native = new FakeNative();
	const a = native.add(1, "left/flow.pfdsl", "left");
	const b = native.add(2, "right/flow.pfdsl", "right");
	const host = await startHost(native, a, {
		choose: async () => native.snapshot(b),
	});
	try {
		const first = await host.open(a);
		const second = await host.open(b);
		first.button.click();
		await flush();
		first.type("edited");
		await host.command("save-as");
		assert.ok(
			host
				.query("#status")
				.textContent.includes(`already open as ${host.nameOf(second)}.`),
		);
		assert.ok(host.query("#status").title.includes(b.path));
		assert.equal(first.getSource(), "edited");
		assert.equal(second.getSource(), "right");
	} finally {
		await host.finish();
	}
});

test("export and external-check notices identify their same-name originating tab", async () => {
	const native = new FakeNative();
	const a = native.add(1, "left/flow.pfdsl", "left");
	const b = native.add(2, "right/flow.pfdsl", "right");
	let fail = false;
	const host = await startHost(native, a, {
		inspectGate: () => {
			if (fail) throw new Error("Disk unavailable");
		},
	});
	try {
		const first = await host.open(a);
		await host.open(b);
		first.exportResults("flow.pfdsl", 1, [
			{
				format: "svg",
				status: "saved",
				savedPath: "/export/flow.svg",
				warnings: [],
			},
		]);
		assert.equal(
			host.query("#status").textContent,
			`Application notice: Export ${host.nameOf(first)}: 1/1 saved. See export results for paths and failures.`,
		);
		fail = true;
		await host.runPoll();
		await host.settle();
		assert.ok(
			host
				.query("#status")
				.textContent.includes(
					`Could not check ${host.nameOf(host.activeTab())}:`,
				),
		);
	} finally {
		await host.finish();
	}
});

test("status retains free-text paths, URLs and longer paths verbatim", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "flow.pfdsl", "source");
	const host = await startHost(native, doc);
	try {
		const tab = await host.open(doc);
		const message = `Checked ${doc.path}. Compare https://host${doc.path} and ${doc.path}.backup and /other${doc.path}; retry '${doc.path}' or (${doc.path}).`;
		tab.report(message);
		assert.equal(
			host.query("#status").textContent,
			`Last action — flow.pfdsl: ${message}`,
		);
		assert.equal(
			host.query("#status").title,
			`Last action — ${doc.path}: ${message}`,
		);
	} finally {
		await host.finish();
	}
});

test("retained export notices follow tab-name changes as same-name tabs open and close", async () => {
	const native = new FakeNative();
	const a = native.add(1, "left/flow.pfdsl", "left");
	const b = native.add(2, "right/flow.pfdsl", "right");
	let targets = [
		{ kind: "file", path: a.path },
		{ kind: "file", path: b.path },
	];
	const host = await startHost(native, a, {
		listRecent: () => targets,
		clearRecent: () => {
			targets = [];
		},
	});
	try {
		const first = await host.open(a);
		first.exportResults("flow.pfdsl", 1, []);
		const second = await host.open(b);
		assert.ok(
			host
				.query("#status")
				.textContent.includes(`Export ${host.nameOf(first)}:`),
		);
		assert.ok(host.query("#status").title.includes(a.path));
		host.closeButton(second).click();
		await host.settle();
		assert.ok(
			host
				.query("#status")
				.textContent.includes(`Export ${host.nameOf(first)}:`),
		);
		host.closeButton(first).click();
		await host.settle();
		assert.match(host.query("#status").textContent, /Export flow.pfdsl:/);
		assert.doesNotMatch(host.query("#status").textContent, /\/A\//);
		await host.command("clear-recent");
		assert.match(host.query("#status").textContent, /Export flow.pfdsl:/);
		assert.doesNotMatch(host.query("#status").textContent, /\/A\//);
		assert.ok(host.query("#status").title.includes(a.path));
		assert.ok(
			host
				.query(".export-results h2")
				.textContent.startsWith("flow.pfdsl — export"),
		);
	} finally {
		await host.finish();
	}
});

test("bottom diagnostics and scrolling status reserve constant rows with Dismiss outside the scroll box", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "original");
	const host = await startHost(native, doc);
	try {
		const style = host.dom.window.document.createElement("style");
		style.textContent = readFileSync(
			new URL("../src/style.css", import.meta.url),
			"utf8",
		);
		host.dom.window.document.head.append(style);
		const tab = await host.open(doc);
		const css = (selector) =>
			host.dom.window.getComputedStyle(host.query(selector));
		const height = css("footer").gridTemplateRows;
		assert.equal(height, "1.5em 1.5em");
		assert.equal(css("#status").display, "block");
		assert.equal(css("#status").height, "1.5em");
		assert.equal(css("#status").overflowY, "auto");
		assert.equal(css("#diagnostics").whiteSpace, "nowrap");
		assert.equal(css("#save-support").gridRow, "1");
		assert.equal(css("#save-support").height, "1.5em");
		tab.report("One\nTwo\nThree");
		assert.equal(css("footer").gridTemplateRows, height);
		assert.equal(css("#status").height, "1.5em");
		assert.equal(host.query("#status").textContent.split("\n").length, 3);
		assert.equal(host.query("#dismiss-status").hidden, false);
		assert.equal(css("#dismiss-status").gridColumn, "2");
		host.query("#dismiss-status").click();
		assert.equal(css("footer").gridTemplateRows, height);
	} finally {
		await host.finish();
	}
});

test("dismiss remains available while a save is waiting for the disk", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "original");
	const inspecting = Promise.withResolvers();
	const resume = Promise.withResolvers();
	const host = await startHost(native, doc, {
		inspectGate: () => {
			inspecting.resolve();
			return resume.promise;
		},
	});
	let deadline;
	try {
		const tab = await host.open(doc);
		tab.type("edited");
		tab.report("Formatting complete");
		host.menuItem("save").action();
		await Promise.race([
			inspecting.promise,
			new Promise((_, reject) => {
				deadline = setTimeout(
					() => reject(new Error("save did not inspect the disk")),
					5000,
				);
			}),
		]);
		assert.match(host.query("#status").textContent, /Formatting complete/);
		host.query("#dismiss-status").click();
		assert.equal(host.query("#status").textContent, "");
		assert.equal(
			host.ledger.saves.length,
			0,
			"dismiss does not finish the pending save",
		);
		resume.resolve(native.snapshot(doc));
		await host.settle();
		assert.match(host.query("#status").textContent, /Saved/);
		assert.equal(tab.getSource(), "edited");
	} finally {
		clearTimeout(deadline);
		resume.resolve(native.snapshot(doc));
		await host.finish();
	}
});

test("failed native titles do not retry unchanged titles or restore dismissed notices on typing", async () => {
	const writes = [];
	const setTitle = async (title) => {
		writes.push(title);
		throw new Error("Denied");
	};
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "original");
	const host = await startHost(native, doc, { setTitle });
	try {
		const a = await host.open(doc);
		a.type("first edit");
		await host.settle();
		host.query("#dismiss-status").click();
		const count = writes.length;
		a.type("another edit");
		await host.settle();
		assert.equal(writes.length, count);
		assert.doesNotMatch(
			host.query("#status").textContent,
			/Could not update the window title/,
		);
	} finally {
		await host.finish();
	}
});

test("save completion for an earlier revision does not announce the newer edits as saved", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "original");
	let finish,
		hold = false;
	const host = await startHost(native, doc, {
		remember: () =>
			hold
				? new Promise((resolve) => {
						finish = resolve;
					})
				: undefined,
	});
	try {
		const a = await host.open(doc);
		a.type("saved revision");
		hold = true;
		host.menuItem("save").action();
		await flush();
		a.type("newer edits");
		finish();
		await host.settle();
		assert.equal(host.isDirty(a), true);
		assert.doesNotMatch(host.query("#status").textContent, /Saved\./);
	} finally {
		await host.finish();
	}
});

test("Save As target errors retain document recovery guidance across dismiss and tab switches", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "original");
	const host = await startHost(native, doc, {
		choose: async () => {
			throw new Error("Target unreadable");
		},
	});
	try {
		const a = await host.open(doc);
		a.type("unsaved text");
		await host.command("save-as");
		await host.newDocument();
		if (!host.query("#dismiss-status").hidden)
			host.query("#dismiss-status").click();
		assert.match(
			host.query("#status").textContent,
			/Save needs attention.*a.pfdsl.*Target unreadable/,
		);
		assert.equal(a.getSource(), "unsaved text");
	} finally {
		await host.finish();
	}
});

test("save failures survive edits, background completion and unrelated notices until a successful save", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "a >> p -> b");
	let reject,
		failed = true;
	const host = await startHost(native, doc, {
		inspectGate: () =>
			failed
				? new Promise((_, fail) => {
						reject = fail;
					})
				: undefined,
	});
	try {
		const a = await host.open(doc);
		const b = await host.newDocument();
		a.button.click();
		await flush();
		a.type("edited");
		host.menuItem("save").action();
		await flush();
		b.button.click();
		await flush();
		reject(new Error("Disk unavailable"));
		await host.settle();
		assert.match(
			host.query("#status").textContent,
			/Save needs attention.*a.pfdsl.*Disk unavailable/,
		);
		b.report("B completed");
		host.query("#dismiss-status").click();
		assert.match(host.query("#status").textContent, /Disk unavailable/);
		a.button.click();
		a.type("new edits");
		await flush();
		assert.match(
			host.query("#status").textContent,
			/Editor content is retained/,
		);
		assert.equal(a.getSource(), "new edits");
		failed = false;
		await host.command("save");
		assert.doesNotMatch(
			host.query("#status").textContent,
			/Save needs attention|Disk unavailable/,
		);
		assert.match(host.query("#status").textContent, /Saved/);
	} finally {
		await host.finish();
	}
});

test("action notices are hidden on other tabs, retained on return, and expire on editing", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "a >> p -> b");
	const host = await startHost(native, doc);
	try {
		const a = await host.open(doc);
		a.report("Add criteria (W002).");
		assert.match(
			host.query("#status").textContent,
			/Last action.*a.pfdsl.*W002/,
		);
		const b = await host.newDocument();
		assert.doesNotMatch(host.query("#status").textContent, /W002/);
		a.report("Late result from A");
		assert.doesNotMatch(host.query("#status").textContent, /Late result/);
		a.button.click();
		await flush();
		assert.match(host.query("#status").textContent, /Late result from A/);
		a.type("new revision");
		assert.doesNotMatch(host.query("#status").textContent, /Late result/);
		a.report("Done");
		host.query("#dismiss-status").click();
		assert.equal(host.query("#status").textContent, "");
		assert.equal(host.query("#status").getAttribute("aria-live"), "polite");
		assert.ok(b);
	} finally {
		await host.finish();
	}
});

test("the diagnostic counts go to the first problem only while there are problems", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "problem");
	const host = await startHost(native, doc);
	try {
		const tab = await host.open(doc);
		await host.settle();
		const calls = [];
		tab.command = (id) => calls.push(id);
		const jump = host.query("#diagnostics button");
		assert.ok(
			jump,
			`problem counts are a button: ${host.query("#diagnostics").textContent}`,
		);
		assert.match(host.query("#diagnostics").textContent, /1 warning/);
		jump.click();
		assert.deepEqual(calls, ["first-problem"]);
		calls.length = 0;
		tab.type("problem problem");
		assert.equal(
			host.query("#diagnostics button"),
			jump,
			"the count button stays mounted while the refresh is pending",
		);
		assert.match(jump.textContent, /1 warning/);
		assert.equal(jump.disabled, true);
		jump.click();
		assert.deepEqual(calls, []);
		tab.finishRefresh();
		await host.settle();
		assert.equal(
			host.query("#diagnostics button"),
			jump,
			"a result with problems updates the same button",
		);
		assert.equal(jump.disabled, false);
		assert.match(jump.textContent, /2 warnings/);
		tab.type("fixed");
		tab.finishRefresh();
		await host.settle();
		assert.equal(host.query("#diagnostics button"), null);
		assert.match(host.query("#diagnostics").textContent, /No problems/);
	} finally {
		await host.finish();
	}
});

test("the diagnostic count button is disabled while the application is busy", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "problem");
	const inspecting = Promise.withResolvers();
	const resume = Promise.withResolvers();
	const host = await startHost(native, doc, {
		inspectGate: () => {
			inspecting.resolve();
			return resume.promise;
		},
	});
	try {
		const tab = await host.open(doc);
		await host.settle();
		tab.type("problem edit");
		tab.finishRefresh();
		host.menuItem("save").action();
		await inspecting.promise;
		const jump = host.query("#diagnostics button");
		assert.ok(jump);
		assert.equal(jump.disabled, true);
		resume.resolve(native.snapshot(doc));
		await host.settle();
		assert.equal(jump.disabled, false);
	} finally {
		resume.resolve(native.snapshot(doc));
		await host.finish();
	}
});

test("diagnostic counts arriving while the application is busy are disabled", async () => {
	const native = new FakeNative();
	const doc = native.add(1, "a.pfdsl", "clean");
	const inspecting = Promise.withResolvers();
	const resume = Promise.withResolvers();
	const host = await startHost(native, doc, {
		inspectGate: () => {
			inspecting.resolve();
			return resume.promise;
		},
	});
	try {
		const tab = await host.open(doc);
		await host.settle();
		assert.equal(host.query("#diagnostics button"), null);
		tab.type("problem");
		host.menuItem("save").action();
		await inspecting.promise;
		tab.finishRefresh();
		await flush();
		const jump = host.query("#diagnostics button");
		assert.ok(jump);
		assert.equal(jump.disabled, true);
		resume.resolve(native.snapshot(doc));
		await host.settle();
		assert.equal(jump.disabled, false);
	} finally {
		resume.resolve(native.snapshot(doc));
		await host.finish();
	}
});
