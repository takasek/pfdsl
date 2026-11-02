import assert from "node:assert/strict";
import test from "node:test";
import {
	createHarness,
	FakeNative,
	TEXT,
} from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("conflict-wording");
const cases = [
	[
		"save",
		"replace",
		"The file changed on disk",
		["Keep Editing", "Save As…", "Overwrite"],
	],
	[
		"close",
		"replace",
		"The file changed on disk",
		["Don't Close", "Save As…", "Overwrite and Close"],
	],
	[
		"save-as",
		"replace",
		"Replace b.pfdsl?",
		["Cancel", "Choose Another File", "Replace"],
	],
	["save", "recreate", "The file was deleted", ["Keep Editing", "Save Again"]],
	[
		"close",
		"recreate",
		"The file was deleted",
		["Don't Close", "Save and Close"],
	],
	[
		"save",
		"adopt",
		"Use the disk version?",
		["Keep Editing", "Use Disk Version"],
	],
];
for (const [origin, kind, title, buttons] of cases) {
	for (let index = 0; index < buttons.length; index++) {
		test(`${kind} from ${origin}: ${buttons[index]} preserves its decision`, async () => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const b = native.add(2, "b.pfdsl", "old B\n");
			let choices = 0;
			const host = await startHost(native, a, {
				confirm: async () => "save",
				choose: () =>
					choices++ === 0 && origin === "save-as" ? native.snapshot(b) : null,
				dialogChoice(actualTitle, entry) {
					assert.equal(actualTitle, title);
					assert.deepEqual(entry.buttons, buttons);
					assert.ok(
						entry.text.includes(origin === "save-as" ? "b.pfdsl" : "a.pfdsl"),
					);
					assert.ok(!entry.text.includes("/A/"));
					assert.match(entry.text, /versions? shown/i);
					assert.match(entry.text, /either changes again/i);
					assert.ok(entry.text.split(/(?<=[.!?])\s+/).length <= 2);
					return buttons[index];
				},
			});
			const tab = await host.open(a);
			tab.type(TEXT.edited);
			if (kind === "recreate") a.file = null;
			else if (origin !== "save-as")
				a.file = {
					source: "external A\n",
					ino: ++native.ino,
					mtime: ++native.clock,
				};
			try {
				if (kind === "adopt") {
					await host.runPoll();
					await host.click(host.panel().use);
				} else if (origin === "close") await host.click(host.closeButton(tab));
				else await host.command(origin === "save-as" ? "save-as" : "save");
				const accepted = index === buttons.length - 1;
				const target = origin === "save-as" ? b : a;
				assert.equal(target.writes, accepted && kind !== "adopt" ? 1 : 0);
				assert.equal(host.isOpen(tab), !(origin === "close" && accepted));
				assert.equal(
					tab.getSource(),
					accepted && kind === "adopt" ? "external A\n" : TEXT.edited,
				);
				if (buttons[index] === "Save As…") assert.equal(choices, 1);
				if (buttons[index] === "Choose Another File") assert.equal(choices, 2);
			} finally {
				await host.finish();
			}
		});
	}
}

test("conflict banner keeps the full target path with Saving to", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const host = await startHost(native, a);
	try {
		const tab = await host.open(a);
		tab.type(TEXT.edited);
		a.file = null;
		await host.runPoll();
		assert.match(
			host.query("#conflicts p").textContent,
			/Saving to \/A\/a\.pfdsl\.$/,
		);
	} finally {
		await host.finish();
	}
});

test("Save As to the current file keeps its disambiguated visible tab name", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "a.pfdsl", "other\n");
	b.path = "/B/a.pfdsl";
	b.binding = "dirB:a.pfdsl";
	let visibleName;
	const host = await startHost(native, a, {
		choose: () => native.snapshot(a),
		dialogChoice(title, entry) {
			assert.equal(title, `Replace ${visibleName}?`);
			assert.ok(entry.text.includes(visibleName));
			return "Cancel";
		},
	});
	try {
		const tab = await host.open(a);
		await host.open(b);
		await host.click(tab.button);
		visibleName = host.nameOf(tab);
		assert.equal(visibleName, "a.pfdsl — A");
		tab.type(TEXT.edited);
		await host.saveAs();
		assert.equal(a.writes, 0);
	} finally {
		await host.finish();
	}
});

test("Save As during close saves to the chosen file and completes the close", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	const host = await startHost(native, a, {
		confirm: async () => "save",
		choose: () => native.snapshot(b),
		dialogChoice(title) {
			return title === "The file changed on disk" ? "Save As…" : "Replace";
		},
	});
	try {
		const tab = await host.open(a);
		tab.type(TEXT.edited);
		a.file = {
			source: "external A\n",
			ino: ++native.ino,
			mtime: ++native.clock,
		};
		await host.click(host.closeButton(tab));
		assert.equal(a.writes, 0);
		assert.equal(b.writes, 1);
		assert.equal(b.file.source, TEXT.edited);
		assert.equal(host.isOpen(tab), false);
	} finally {
		await host.finish();
	}
});
