// Invariants derived from README "Application behavior", stated over what the
// user and the disk can observe rather than over the session's internal fields.
//
// L  No silent loss: unsaved text survives an action unless the user chose
//    Discard or Use Current Disk Version, and a tab that showed unsaved state
//    (isDirty) is never reloaded.
// R  No unreviewed overwrite: a save that replaces disk content other than the
//    content this tab last acknowledged is preceded, in the same action, by a
//    confirmed dialog that showed that exact content and the exact text sent.
// A  Approval is execution: the text and revision sent equal what the confirmed
//    dialog showed.
// P  Panel consistency: the comparison text shown by the conflict panel is the
//    snapshot its buttons act on.
// O  Observation completeness: every unresolved target is inspected.
import { fsOf } from "./lifecycle-harness.mjs";

const REVIEW = "Review the target";
const RECREATE = "Recreate missing file";
const CONFIRMING = new Set(["Replace Observed Version", "Create File"]);

/** Captures what the action starts from and clears the host log. */
export function beginAction({ host, entry }) {
	const session = entry.session;
	const acked = new Map();
	for (const snapshot of [
		session.observed,
		session.pendingTarget,
		session.disk,
	])
		if (snapshot) acked.set(snapshot.id, snapshot.source);
	host.log.length = 0;
	return {
		text0: entry.tab.getSource(),
		dirty0: session.isDirty(),
		name: entry.name,
		acked,
		setSource0: entry.tab.setSourceCalls,
	};
}

/** L, R and A over everything that happened since beginAction. */
export function checkAction({ native, host, entry, trace, violate }) {
	const log = host.log;
	const alive = globalThis.reviewEntries.has(entry);
	const text = entry.tab.getSource();
	const discarded = log.some(
		(item) =>
			item.kind === "confirm" &&
			item.name === trace.name &&
			item.decision === "discard",
	);
	const usedDisk = log.some(
		(item) => item.kind === "dialog" && item.choice === "Use Disk Version",
	);
	// Text this action already published is not unsaved any more.
	const published = log.some(
		(item) => item.kind === "save" && item.wrote && item.source === trace.text0,
	);
	if (trace.dirty0 && !discarded && !usedDisk && !published) {
		if (entry.tab.setSourceCalls > trace.setSource0)
			violate("L", "the editor of a tab with unsaved state was replaced");
		const keptInEditor = alive && text === trace.text0;
		const keptOnDisk = [...native.docs.values()].some(
			(doc) => fsOf(native, doc).source === trace.text0,
		);
		if (!keptInEditor && !keptOnDisk)
			violate(
				"L",
				`unsaved text ${JSON.stringify(trace.text0)} exists nowhere`,
			);
	}
	log.forEach((save, index) => {
		if (save.kind !== "save") return;
		const earlier = log.slice(0, index);
		const previousSave = earlier.findLastIndex(
			(item) => item.kind === "save" && item.id === save.id,
		);
		const dialog = earlier
			.slice(previousSave + 1)
			.findLast(
				(item) =>
					item.kind === "dialog" &&
					item.target === save.id &&
					CONFIRMING.has(item.choice) &&
					(item.title === REVIEW || item.title === RECREATE),
			);
		if (dialog) {
			if (save.source !== dialog.shownEditor)
				violate(
					"A",
					`sent ${JSON.stringify(save.source)} but the dialog showed ${JSON.stringify(dialog.shownEditor)}`,
				);
			if ((save.expected ?? null) !== (dialog.fsById[save.id].revision ?? null))
				violate(
					"A",
					`sent expected ${JSON.stringify(save.expected)} but the dialog showed ${JSON.stringify(dialog.fsById[save.id].revision)}`,
				);
		}
		if (!save.wrote) return;
		const prior = save.fs.unreadable ? undefined : (save.fs.source ?? null);
		if (prior === undefined) {
			violate("R", "published over an unreadable file");
			return;
		}
		// A target picked in the chooser has no acknowledged content.
		const chosen = earlier.some(
			(item) => item.kind === "choose" && item.id === save.id,
		);
		const acked =
			!chosen && trace.acked.has(save.id)
				? trace.acked.get(save.id)
				: undefined;
		const needsReview =
			prior === null ? typeof acked === "string" : prior !== acked;
		if (!needsReview) return;
		const showed =
			dialog &&
			(prior === null
				? dialog.title === RECREATE
				: dialog.title === REVIEW && dialog.disk === prior);
		if (!showed || (dialog.fsById[save.id].source ?? null) !== prior)
			violate(
				"R",
				`replaced ${JSON.stringify(prior)} (acknowledged ${JSON.stringify(acked)}) without a confirmed review that showed it`,
			);
	});
}

/** P: the panel compares against the snapshot its buttons act on. */
export function checkPanel({ host, entry, violate }) {
	if (
		!globalThis.reviewEntries.has(entry) ||
		globalThis.reviewActive() !== entry
	)
		return;
	const session = entry.session;
	const panel = host.query("#conflicts");
	const preview = panel.querySelector("pre");
	if (preview) {
		const observed = session.observed;
		if (typeof observed?.source === "string") {
			if (preview.textContent !== observed.source)
				violate(
					"P",
					`the panel shows ${JSON.stringify(preview.textContent)} but its buttons act on ${JSON.stringify(observed.source)}`,
				);
		} else {
			const stale = [session.conflict, session.disk, session.pendingTarget]
				.map((snapshot) => snapshot?.source)
				.filter((source) => typeof source === "string");
			if (stale.includes(preview.textContent))
				violate(
					"P",
					`the panel shows ${JSON.stringify(preview.textContent)} while its buttons act on ${observed ? "a missing file" : "no snapshot"}`,
				);
		}
		const buttons = new Map(
			host
				.queryAll("#conflicts button")
				.map((button) => [button.textContent, button]),
		);
		const review = buttons.get("Review and Save Here…");
		const use = buttons.get("Use Current Disk Version…");
		if (review && review.disabled !== !session.observed)
			violate(
				"P",
				"Review and Save Here… does not follow the observed snapshot",
			);
		if (
			use &&
			use.disabled !== (!session.observed || session.observed.source === null)
		)
			violate(
				"P",
				"Use Current Disk Version… does not follow the observed snapshot",
			);
	}
}

/** O: each id was inspected at least `times` times since beginAction. */
export function checkInspected({ host, ids, times = 1, violate, when }) {
	for (const id of ids) {
		const count = host.log.filter(
			(item) => item.kind === "inspect" && item.id === id,
		).length;
		if (count < times)
			violate(
				"O",
				`target ${id} was inspected ${count} time(s) ${when}, expected at least ${times}`,
			);
	}
}
