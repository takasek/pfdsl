// The matrix tests inspect the controller contract. This boundary test checks
// the real presenter against independently supplied disk/editor contents.
import { cell } from "./helpers/known-red.mjs";
import { createHarness, FakeNative } from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("document-presenter");

cell(
	"presenter | recovery preview and review use the observed target",
	async () => {
		const violations = [];
		const native = new FakeNative();
		const original = native.add(1, "diagram.pfdsl", "original disk\n");
		const host = await startHost(native, original);
		try {
			const tab = await host.open(original);
			tab.type("editor changes\n");
			original.file = {
				source: "external disk changes\n",
				ino: ++native.ino,
				mtime: ++native.clock,
			};
			const expected = native.snapshot(original);
			await host.runPoll();
			const panel = host.panel();
			if (panel.preview !== expected.source)
				violations.push(
					"P: the presenter did not show the observed disk content",
				);
			if (panel.recoveryPath !== expected.path)
				violations.push("P: the presenter did not name the observed target");
			if (!panel.review || panel.review.disabled)
				violations.push(
					"P: the observed target has no reachable Review action",
				);
			else {
				await host.click(panel.review);
				const review = host.log.findLast((event) => event.kind === "dialog");
				if (
					review?.target !== expected.id ||
					review?.disk !== expected.source ||
					review?.shownEditor !== "editor changes\n"
				)
					violations.push(
						"A: the review did not display the editor and observed target",
					);
				const save = host.log.findLast((event) => event.kind === "save");
				if (
					save?.id !== expected.id ||
					save?.expected !== expected.revision ||
					save?.source !== "editor changes\n"
				)
					violations.push(
						"A: the review button did not submit the displayed versions",
					);
			}
			const leaked = await host.finish();
			if (leaked.length)
				violations.push(`harness: leaked IPC ${leaked.join(",")}`);
		} finally {
			host.dom.window.close();
		}
		return violations;
	},
);
