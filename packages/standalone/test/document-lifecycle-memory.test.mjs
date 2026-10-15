// What the lifecycle must remember across steps: a confirmation's lifetime, a
// failed read, stale notices after a failed save, a target that moved, and
// targets related by binding. Invariants are in helpers/lifecycle-invariants.mjs.
import { cell, guardKnownRed } from "./helpers/known-red.mjs";
import {
	createHarness,
	FakeNative,
	flush,
	InspectGate,
	TEXT,
} from "./helpers/lifecycle-harness.mjs";
import {
	beginAction,
	checkAction,
	checkPanel,
	checkReads,
} from "./helpers/lifecycle-invariants.mjs";
import { apply, establish } from "./helpers/recovery-state.mjs";

const { startHost } = await createHarness("lifecycle-memory");

/** Runs `body` and gives it a violation sink; a throw counts as a violation. */
async function judged(body) {
	const violations = [];
	const violate = (name, detail) => violations.push(`${name}: ${detail}`);
	try {
		await body(violate);
	} catch (error) {
		violate("harness", String(error?.stack ?? error));
	}
	return violations;
}

const change = (native, doc, source) => {
	doc.file = { source, ino: ++native.ino, mtime: ++native.clock };
};

// F1: a Save decision covers the text shown when it was asked. Edits at the
// points around it must never be saved or closed without a new decision.
for (const point of [
	"before-confirm",
	"during-confirm",
	"pending-inspect",
	"during-save-io",
])
	for (const kind of ["edit", "edit-undo"])
		for (const path of ["close-save", "quit-save"])
			cell(`lifetime | ${point} | ${kind} | ${path}`, () =>
				judged(async (violate) => {
					const native = new FakeNative();
					const a = native.add(1, "a.pfdsl", TEXT.disk);
					const gate = new InspectGate(native);
					let tab;
					const edit = () => {
						const base = tab.getSource();
						tab.type("edited after the decision was asked\n");
						if (kind === "edit-undo") tab.type(base);
					};
					const host = await startHost(native, a, {
						inspectGate: (id) => gate.hold(id),
						beforeSave: () => {
							if (point === "during-save-io") edit();
						},
						async confirm() {
							if (point === "during-confirm") edit();
							if (point === "pending-inspect") gate.arm(a.id);
							return "save";
						},
					});
					tab = await host.open(a);
					tab.type(TEXT.edited);
					if (point === "before-confirm") edit();
					const trace = beginAction({ host, tab, owned: [a.id] });
					if (point === "pending-inspect") {
						if (path === "close-save") host.closeButton(tab).click();
						else host.beginQuit(1);
						await flush();
						if (!gate.isHeld)
							violate("harness", "the pre-save inspection was not pending");
						edit();
						gate.release();
						await host.settle();
					} else if (path === "close-save")
						await host.click(host.closeButton(tab));
					else await host.quit(1);
					checkAction({ native, host, tab, trace, violate });
					checkReads({ host, tab, trace, violate });
					checkPanel({ host, native, violate });
					if ((await host.finish()).length) violate("harness", "leaked IPC");
				}),
			);

// A review's plan survives neither an edit nor an edit undone back to its text.
for (const action of ["review", "recreate", "adopt"])
	for (const edit of ["edit", "edit-undo"])
		cell(`plan lifetime | ${action} | ${edit}`, () =>
			judged(async (violate) => {
				const native = new FakeNative();
				const a = native.add(1, "a.pfdsl", TEXT.disk);
				let tab;
				const host = await startHost(native, a, {
					confirm: async () => "cancel",
					dialogChoice: (title) =>
						title === "Discard editor changes" ? "Use Disk Version" : undefined,
					onDialog() {
						const before = tab.getSource();
						tab.type("edited while the review was open\n");
						if (edit === "edit-undo") tab.type(before);
					},
				});
				tab = await host.open(a);
				tab.type(TEXT.edited);
				if (action === "recreate") a.file = null;
				else change(native, a, "external version\n");
				await host.runPoll();
				const trace = beginAction({ host, tab, owned: [a.id] });
				if (action === "adopt") await host.click(host.panel().use);
				else await host.cmdS();
				checkAction({ native, host, tab, trace, violate });
				if ((await host.finish()).length) violate("harness", "leaked IPC");
			}),
		);

cell("plan lifetime | adopt | disk changes during review", () =>
	judged(async (violate) => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", TEXT.disk);
		const host = await startHost(native, a, {
			confirm: async () => "cancel",
			dialogChoice: (title) =>
				title === "Discard editor changes" ? "Use Disk Version" : undefined,
			onDialog() {
				change(native, a, "changed after the adoption was shown\n");
			},
		});
		const tab = await host.open(a);
		tab.type(TEXT.edited);
		change(native, a, "external version\n");
		await host.runPoll();
		const trace = beginAction({ host, tab, owned: [a.id] });
		await host.click(host.panel().use);
		checkAction({ native, host, tab, trace, violate });
		if (host.log.some((item) => item.kind === "reload" && item.tab === tab))
			violate(
				"V",
				"adopted a disk version different from the one shown in the review",
			);
		if ((await host.finish()).length) violate("harness", "leaked IPC");
	}),
);

// Once the request has been sent, later edits stay unsaved rather than cancelling publication.
for (const edit of ["edit", "edit-undo"])
	cell(`plan lifetime | review | ${edit} during save I/O`, () =>
		judged(async (violate) => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			let tab;
			const host = await startHost(native, a, {
				confirm: async () => "cancel",
				beforeSave() {
					const before = tab.getSource();
					tab.type("edited after the save request was sent\n");
					if (edit === "edit-undo") tab.type(before);
				},
			});
			tab = await host.open(a);
			tab.type(TEXT.edited);
			change(native, a, "external version\n");
			const trace = beginAction({ host, tab, owned: [a.id] });
			await host.cmdS();
			checkAction({ native, host, tab, trace, violate });
			if (
				!host.log.some(
					(item) => item.kind === "save" && item.outcome === "saved",
				)
			)
				violate("D", "a valid reviewed save did not succeed");
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
	);

// Quit can review a tab other than the active one; the approval belongs to that tab.
for (const edited of ["reviewed", "other"])
	cell(`plan lifetime | non-active quit review | edit ${edited} tab`, () =>
		judged(async (violate) => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const b = native.add(2, "b.pfdsl", TEXT.disk);
			let tabA;
			let tabB;
			const host = await startHost(native, a, {
				confirm: async (name) =>
					name === "a.pfdsl" || name === "b.pfdsl" ? "save" : "discard",
				onDialog(dialog) {
					if (dialog.target === b.id)
						(edited === "reviewed" ? tabB : tabA).type(
							"typed during B's review\n",
						);
				},
			});
			tabA = await host.open(a);
			tabA.type(TEXT.edited);
			tabB = await host.open(b);
			tabB.type(TEXT.edited);
			change(native, b, "external B\n");
			await host.click(tabA.button);
			const traceA = beginAction({ host, tab: tabA, owned: [a.id] });
			const traceB = beginAction({ host, tab: tabB, owned: [b.id] });
			await host.quit(1);
			checkAction({ native, host, tab: tabA, trace: traceA, violate });
			checkAction({ native, host, tab: tabB, trace: traceB, violate });
			if (!host.isOpen(tabA) || !host.isOpen(tabB))
				violate("L", "quit discarded a tab edited during another tab's review");
			if (
				edited === "other" &&
				!host.log.some((item) => item.kind === "save" && item.id === b.id)
			)
				violate("D", "an unchanged reviewed tab's save was refused");
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
	);

// F2 / T1: what a failed read means must not depend on which entry point saw it.
for (const entry of ["poll", "cmd-s", "close-cancel", "use-disk"])
	for (const tabState of ["clean", "dirty"])
		for (const recovery of ["same", "different"])
			for (const next of ["poll", "cmd-s", "close-discard"]) {
				if (entry === "use-disk" && tabState === "clean") continue;
				cell(
					`failure memory | ${tabState} | ${entry} | ${recovery} | ${next}`,
					() =>
						judged(async (violate) => {
							const native = new FakeNative();
							const a = native.add(1, "a.pfdsl", TEXT.disk);
							const state = { decision: "cancel", useDisk: false, name: "" };
							const host = await startHost(native, a, {
								confirm: async (name) =>
									name === state.name ? state.decision : "discard",
								dialogChoice: (title) =>
									state.useDisk && title === "Discard editor changes"
										? "Use Disk Version"
										: undefined,
							});
							const tab = await host.open(a);
							state.name = host.nameOf(tab);
							if (tabState === "dirty") tab.type(TEXT.edited);
							if (entry === "use-disk") {
								change(native, a, "disk v2 (external)\n");
								await host.runPoll();
							}
							const before = a.file;
							a.unreadable = true;
							const first = beginAction({ host, tab, owned: [a.id] });
							if (entry === "poll") await host.runPoll();
							else if (entry === "cmd-s") await host.cmdS();
							else if (entry === "close-cancel")
								await host.click(host.closeButton(tab));
							else {
								state.useDisk = true;
								await host.click(host.panel().use);
								state.useDisk = false;
							}
							checkAction({ native, host, tab, trace: first, violate });
							checkPanel({ host, native, violate });
							a.unreadable = false;
							if (recovery === "same") a.file = before;
							else change(native, a, "disk v3 after recovery\n");
							if (!host.isOpen(tab)) {
								violate(
									"K",
									"the tab was closed although its disk could not be read",
								);
								return;
							}
							state.decision = "discard";
							const second = beginAction({ host, tab, owned: [a.id] });
							if (next === "poll") await host.runPoll();
							else if (next === "cmd-s") {
								for (let press = 0; press < 3 && host.isOpen(tab); press++) {
									await host.cmdS();
									if (!host.isDirty(tab) && !host.panel().present) break;
								}
							} else await host.click(host.closeButton(tab));
							checkAction({ native, host, tab, trace: second, violate });
							if (next === "close-discard")
								checkReads({ host, tab, trace: second, violate });
							checkPanel({ host, native, violate });
							if ((await host.finish()).length)
								violate("harness", "leaked IPC");
						}),
				);
			}

// F3: after the plain Save of the original failed, the original is the recovery
// target and no notice may say that "the original also changed".
cell("stale notice | the original returns to its first content", () =>
	judged(async (violate) => {
		const ctx = await establish(startHost, {
			id: "save-as-conflict",
			start: "file",
			via: "save-as",
			hasB: true,
		});
		const { native, a, host } = ctx;
		change(native, a, "external A1\n");
		await host.runPoll();
		if (!host.panel().originalAlsoChanged)
			violate("harness", "the notice was not shown for A1");
		ctx.beforeSave = () => {
			ctx.beforeSave = undefined;
			change(native, a, "external A2\n");
		};
		await host.cmdS();
		change(native, a, TEXT.disk);
		await host.runPoll();
		checkPanel({ host, native, violate, original: a });
		if ((await host.finish()).length) violate("harness", "leaked IPC");
	}),
);

// F4 / T4: a recovery target whose directory moved is named by its current path.
for (const polls of [0, 1])
	cell(`moved target | Use Current Disk Version before ${polls} poll(s)`, () =>
		judged(async (violate) => {
			const ctx = await establish(startHost, {
				id: "save-as-conflict",
				start: "file",
				via: "save-as",
				hasB: true,
			});
			const { native, b, host } = ctx;
			apply(native, b, "moved-changed");
			ctx.useDisk = true;
			await host.click(host.panel().use);
			for (let poll = 0; poll < polls; poll++) await host.runPoll();
			checkPanel({ host, native, violate, recoveryId: b.id });
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
	);

// N2: the Save that follows a Close decision completes the close in one attempt.
cell(
	"close after an unreadable first save | the target recovers during the confirmation",
	() =>
		judged(async (violate) => {
			const ctx = await establish(startHost, {
				id: "untitled-b-unreadable",
				start: "untitled",
				via: "save",
				hasB: true,
			});
			const { native, b, host, tab } = ctx;
			ctx.tabName = host.nameOf(tab);
			ctx.decision = "save";
			ctx.onConfirm = () => apply(native, b, "recovered");
			const trace = beginAction({ host, tab, owned: [b.id] });
			await host.click(host.closeButton(tab));
			checkAction({ native, host, tab, trace, violate });
			if (host.isOpen(tab))
				violate("N2", "the close did not complete after the Save succeeded");
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
);

// T3: the dialog is built from the inspection it received; a change after that
// response is refused natively, never overwritten.
for (const late of [false, true])
	cell(
		`dialog source | the file changes after the inspection answered: ${late}`,
		() =>
			judged(async (violate) => {
				const native = new FakeNative();
				const a = native.add(1, "a.pfdsl", TEXT.disk);
				let armed = false;
				const host = await startHost(native, a, {
					afterInspect(id) {
						if (late && armed && id === a.id) {
							armed = false;
							change(native, a, "disk v3 (after the answer)\n");
						}
					},
				});
				const tab = await host.open(a);
				tab.type(TEXT.edited);
				change(native, a, "disk v2 (external)\n");
				armed = true;
				const trace = beginAction({ host, tab, owned: [a.id] });
				await host.cmdS();
				checkAction({ native, host, tab, trace, violate });
				if (late && a.file.source !== "disk v3 (after the answer)\n")
					violate("R", "a change after the inspection was overwritten");
				if ((await host.finish()).length) violate("harness", "leaked IPC");
			}),
	);

// Relations: a hard link is another document; a reselected folder is the same one.
cell(
	"hard link | saving one leaf leaves the other leaf and its tab alone",
	() =>
		judged(async (violate) => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const alias = native.link(a, 3, "alias.pfdsl");
			const host = await startHost(native, a, {});
			const first = await host.open(a);
			first.type(TEXT.edited);
			const second = await host.open(alias);
			if (second === first)
				violate("harness", "the hard link opened in the same tab");
			first.button.click();
			const trace = beginAction({ host, tab: first, owned: [a.id] });
			await host.cmdS();
			checkAction({ native, host, tab: first, trace, violate });
			await host.runPoll();
			if (alias.file.source !== TEXT.disk)
				violate("R", "the other leaf was written");
			if (host.isDirty(second) || second.getSource() !== TEXT.disk)
				violate("L", "the other leaf's tab changed");
			const saves = host.log.filter((item) => item.kind === "save");
			if (saves.some((item) => item.id !== a.id))
				violate("R", "the save targeted another leaf");
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
);

for (const external of [false, true])
	cell(
		`same binding, new id | reselecting the file, external change: ${external}`,
		() =>
			judged(async (violate) => {
				const native = new FakeNative();
				const a = native.add(1, "a.pfdsl", TEXT.disk);
				const again = native.reselect(a, 9);
				const host = await startHost(native, a, {});
				const tab = await host.open(a);
				tab.type(TEXT.edited);
				if (external) change(native, a, "disk v2 (external)\n");
				const tabs = host.tabs().filter((item) => host.isOpen(item)).length;
				const trace = beginAction({ host, tab, owned: [a.id, again.id] });
				const reopened = await host.open(again);
				if (reopened !== tab)
					violate("harness", "reselecting opened another tab");
				if (host.tabs().filter((item) => host.isOpen(item)).length !== tabs)
					violate("harness", "the number of tabs changed");
				await host.cmdS();
				checkAction({ native, host, tab, trace, violate });
				if (a.file.source !== TEXT.edited)
					violate("D", "the reselected document could not be saved");
				if ((await host.finish()).length) violate("harness", "leaked IPC");
			}),
	);

for (const path of ["close-save", "quit-save"])
	cell(`lifetime | pending-inspect | revert-to-acknowledged | ${path}`, () =>
		judged(async (violate) => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const gate = new InspectGate(native);
			const host = await startHost(native, a, {
				inspectGate: (id) => gate.hold(id),
				confirm: async () => {
					gate.arm(a.id);
					return "save";
				},
			});
			const tab = await host.open(a);
			tab.type(TEXT.edited);
			const trace = beginAction({ host, tab, owned: [a.id] });
			if (path === "close-save") host.closeButton(tab).click();
			else host.beginQuit(1);
			await flush();
			if (!gate.isHeld) violate("harness", "pre-save read was not pending");
			tab.type(TEXT.disk);
			gate.release();
			await host.settle();
			checkAction({ native, host, tab, trace, violate });
			if (!host.isOpen(tab))
				violate(
					"C",
					"an edit back to acknowledged text closed without a new decision",
				);
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
	);

for (const missingPolls of [0, 1])
	cell(
		`rename recovery | same-content replacement observed before leaf rename | missing polls: ${missingPolls}`,
		() =>
			judged(async (violate) => {
				const native = new FakeNative();
				const a = native.add(1, "a.pfdsl", TEXT.disk);
				const host = await startHost(native, a, {});
				const tab = await host.open(a);
				change(native, a, TEXT.disk);
				await host.runPoll();
				tab.type(TEXT.edited);
				const c = native.link(a, 3, "c.pfdsl");
				a.file = null;
				for (let poll = 0; poll < missingPolls; poll++) await host.runPoll();
				const trace = beginAction({ host, tab, owned: [a.id] });
				const reopened = await host.open(c);
				if (reopened !== tab || tab.location !== c.path)
					violate(
						"P",
						"the observed inode did not recover the tab and dependency base at C",
					);
				await tab.read("base.pfdsl");
				if (
					host.log.findLast((item) => item.kind === "dependency")?.id !== c.id
				)
					violate(
						"P",
						"the renamed tab's dependency read still uses the old capability",
					);
				await host.click(tab.button);
				await host.cmdS();
				checkAction({ native, host, tab, trace, violate });
				if (a.file !== null || c.file.source !== TEXT.edited)
					violate(
						"R",
						"saving the recovered buffer did not target the renamed leaf",
					);
				if ((await host.finish()).length) violate("harness", "leaked IPC");
			}),
	);

for (const relation of ["same-binding", "hard-link"])
	cell(`recovery panel | ${relation} new capability after failed Save As`, () =>
		judged(async (violate) => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const b =
				relation === "same-binding"
					? native.reselect(a, 2)
					: native.link(a, 2, "b.pfdsl");
			const host = await startHost(native, a, {
				choose: async () => native.snapshot(b),
				beforeSave() {
					b.file.source = "external\n";
					b.file.mtime = ++native.clock;
				},
			});
			const tab = await host.open(a);
			tab.type(TEXT.edited);
			await host.command("save-as");
			await host.runPoll();
			checkPanel({ host, native, violate, recoveryId: b.id, original: a });
			if (relation === "hard-link" && !host.panel().originalAlsoChanged)
				violate(
					"P",
					"distinct hard-link leaves lost their separate original notice",
				);
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
	);

cell(
	"oracle | dirty reselect does not acknowledge merely observed external text",
	() =>
		judged(async (violate) => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const again = native.reselect(a, 9);
			const host = await startHost(native, a, {});
			const tab = await host.open(a);
			tab.type(TEXT.edited);
			change(native, a, "external not loaded\n");
			await host.open(again);
			if (
				host.ledger.acks.some(
					(ack) =>
						ack.id === again.id && ack.content === "external not loaded\n",
				)
			)
				violate(
					"R",
					"native selection alone acknowledged external text never loaded into the dirty editor",
				);
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
);

guardKnownRed();

cell(
	"oracle | rejected missing selection does not acknowledge a new capability",
	() =>
		judged(async (violate) => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const again = native.reselect(a, 9);
			const host = await startHost(native, a, {});
			const tab = await host.open(a);
			tab.type(TEXT.edited);
			a.file = null;
			await host.open(again);
			if (host.ledger.acks.some((ack) => ack.id === again.id))
				violate(
					"R",
					"a rejected missing selection acquired an acknowledgement",
				);
			if ((await host.finish()).length) violate("harness", "leaked IPC");
		}),
);
