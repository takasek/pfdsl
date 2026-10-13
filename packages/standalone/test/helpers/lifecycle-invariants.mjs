// Invariants derived from README "Application behavior". They are stated over
// what the host recorded (dialogs with their displayed text and the button
// clicked, request and resolution order of every native call, the editor stub,
// the DOM) and over the fake filesystem. No invariant reads the application's
// session state, so a remodel of that state cannot blind them.
//
// "Acknowledged" content of a file is what the host saw the application load
// into the editor (open, Use Current Disk Version, a clean reload), write
// successfully, or what the user approved in a confirmed dialog. Content the
// application merely observed is not acknowledged.
//
// L  No silent loss: unsaved text survives an action unless the user chose
//    Discard or Use Current Disk Version, and a tab that showed unsaved state
//    (the bullet) is never reloaded.
// R  No unreviewed overwrite: a write over content that is not acknowledged
//    needs a confirmed dialog that showed that content.
// A  Approval is execution: the text and revision sent equal what the confirmed
//    dialog was built from and displayed.
// C  Confirmation lifetime: a Save decision applies to the text shown when it was
//    asked; other text needs its own approval.
// U  An unreadable read leaves the tab marked until the user resolves it.
// K  A tab that needed confirmation is not closed without being asked.
// T  Close reads every unresolved target after the last decision and before the
//    tab is disposed.
// P  Panel consistency: the panel names the recovery target by its current path
//    and compares against what the application last learned about it.
// O  Observation completeness: the panel reflects the files as they are.
// V  An operation shown in a dialog is refused if its editor was edited before execution.
import { fsOf } from "./lifecycle-harness.mjs";

const REVIEW = "Review the target";
const RECREATE = "Recreate missing file";
const CONFIRMING = new Set(["Replace Observed Version", "Create File"]);

/** Captures what the action starts from and clears the host log. */
export function beginAction({ host, tab, owned = [] }) {
	host.log.length = 0;
	return {
		seq0: host.tick(),
		text0: tab.getSource(),
		dirty0: host.isDirty(tab),
		name: host.nameOf(tab),
		setSource0: tab.setSourceCalls,
		owned,
	};
}

/** The latest acknowledged content of a file before `seq`, if any. */
function acknowledged(host, id, seq) {
	return host.ledger.acks.findLast((ack) => ack.id === id && ack.seq < seq);
}

/** Unknown receipts do not erase a capability's recorded binding. */
function targetBinding(host, id) {
	return (
		host.ledger.received.findLast(
			(item) => item.id === id && item.binding !== undefined,
		)?.binding ??
		host.ledger.offered?.findLast(
			(item) => item.id === id && item.binding !== undefined,
		)?.binding
	);
}

/** L, A, C, R, U, K and the disposal rule over everything since beginAction. */
export function checkAction({ native, host, tab, trace, violate }) {
	const log = host.log;
	// Use the recorded edits, including edit followed by Undo, rather than text equality.
	const consumed = new Set();
	for (const execution of log.filter(
		(item) =>
			item.kind === "save" || (item.kind === "reload" && item.tab === tab),
	)) {
		const dialog = log.findLast(
			(item) =>
				item.kind === "dialog" &&
				item.tab === tab &&
				!consumed.has(item) &&
				(execution.kind !== "save" || item.target === execution.id) &&
				item.seq < execution.seq &&
				(CONFIRMING.has(item.choice) || item.choice === "Use Disk Version"),
		);
		if (dialog) consumed.add(dialog);
		if (
			dialog &&
			log.some(
				(item) =>
					item.kind === "type" &&
					item.tab === tab &&
					item.seq > dialog.seq &&
					item.seq < execution.seq,
			)
		)
			violate("V", "executed a dialog's plan after its editor was edited");
	}
	const alive = host.isOpen(tab);
	const text = tab.getSource();
	const discarded = log.some(
		(item) =>
			item.kind === "confirm" &&
			item.name === trace.name &&
			item.decision === "discard",
	);
	const usedDisk = log.some(
		(item) => item.kind === "dialog" && item.choice === "Use Disk Version",
	);
	// Text the user typed during the action replaces what was there before.
	const typed = log.findLast(
		(item) => item.kind === "type" && item.tab === tab,
	);
	const unsaved = typed ? typed.text : trace.text0;
	// Text this action already published is not unsaved any more.
	const published = log.some(
		(item) => item.kind === "save" && item.wrote && item.source === unsaved,
	);
	if (trace.dirty0 && !discarded && !usedDisk && !published) {
		if (tab.setSourceCalls > trace.setSource0)
			violate("L", "a tab that showed unsaved state was reloaded");
		const keptInEditor = alive && text === unsaved;
		const keptOnDisk = [...native.docs.values()].some(
			(doc) => fsOf(native, doc).source === unsaved,
		);
		if (!keptInEditor && !keptOnDisk)
			violate("L", `unsaved text ${JSON.stringify(unsaved)} exists nowhere`);
	}
	const disposed = log.some(
		(item) => item.kind === "dispose" && item.tab === tab,
	);
	if (disposed && !discarded) {
		const onDisk = [...native.docs.values()].some(
			(doc) => fsOf(native, doc).source === text,
		);
		if (!onDisk)
			violate("L", `closed with ${JSON.stringify(text)} that no file holds`);
	}
	log.forEach((save, index) => {
		if (save.kind !== "save") return;
		if (save.tab && save.tab !== tab) return;
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
			const built = dialog.builtFrom;
			if (built && !built.unknown) {
				if ((save.expected ?? null) !== (built.revision ?? null))
					violate(
						"A",
						`sent expected ${JSON.stringify(save.expected)} but the dialog was built from ${JSON.stringify(built.revision)}`,
					);
				if (dialog.title === REVIEW && dialog.disk !== built.source)
					violate(
						"A",
						`the dialog displayed ${JSON.stringify(dialog.disk)} but the inspection returned ${JSON.stringify(built.source)}`,
					);
			}
		}
		// C: a Save decision covers the text shown when it was asked.
		const decision = earlier.findLast(
			(item) =>
				item.kind === "confirm" &&
				item.name === trace.name &&
				item.decision === "save",
		);
		if (decision && save.source !== decision.textAtRequest && !dialog)
			violate(
				"C",
				`saved ${JSON.stringify(save.source)} although the Save decision was for ${JSON.stringify(decision.textAtRequest)}`,
			);
		if (!save.wrote) return;
		// R
		const prior = save.fs.unreadable ? undefined : (save.fs.source ?? null);
		if (prior === undefined) {
			violate("R", "published over an unreadable file");
			return;
		}
		const known = acknowledged(host, save.id, save.seq);
		const allowed =
			prior === null
				? !known || known.content === undefined || known.content === null
				: known?.content === prior;
		if (!allowed)
			violate(
				"R",
				`replaced ${JSON.stringify(prior)} (acknowledged ${JSON.stringify(known?.content)}) without an approval that showed it`,
			);
	});
	// U: a failed read stays visible until the user resolves it or the content returns.
	// A successful save or adoption moves this tab's ownership. Failures on its
	// former targets stay in the ledger, but are no longer this tab's unresolved reads.
	const settled = host.ledger.acks.findLast(
		(ack) =>
			ack.tab === tab &&
			ack.seq > trace.seq0 &&
			(ack.why === "save" || ack.why === "reload"),
	);
	const unresolved = (settled ? [settled.id] : trace.owned).filter((id) =>
		unresolvedFailure(host, id),
	);
	if (alive && unresolved.length && !host.isDirty(tab))
		violate("U", "an unreadable read left no sign on the tab");
	// K
	const asked = log.some(
		(item) => item.kind === "confirm" && item.name === trace.name,
	);
	if (disposed && !asked && unresolved.length)
		violate("K", "a tab that needed confirmation was closed without asking");
}

/**
 * True while the last failed read of a file is neither resolved by an approved
 * write, load or dialog nor undone by the file returning to what was
 * acknowledged when the read failed.
 */
function unresolvedFailure(host, id) {
	const failure = host.ledger.failures.findLast((item) => item.id === id);
	if (!failure) return false;
	const binding = targetBinding(host, id);
	// Only evidence for this target resolves its read failure.
	const resolved = host.ledger.acks.some(
		(ack) =>
			(ack.id === id || (binding !== undefined && ack.binding === binding)) &&
			ack.seq > failure.seq &&
			(ack.why === "save" ||
				ack.why === "approval" ||
				ack.why === "open" ||
				ack.why === "reload"),
	);
	const latest = host.ledger.received.findLast(
		(item) => item.id === id && item.seq > failure.seq,
	);
	const recoveredSame =
		latest && latest.source === acknowledged(host, id, failure.seq)?.content;
	return !resolved && !recoveredSame;
}

/** T: every owned target was read after the last decision and before disposal. */
export function checkReads({ host, tab, trace, violate }) {
	const log = host.log;
	const dispose = log.find(
		(item) => item.kind === "dispose" && item.tab === tab,
	);
	if (!dispose) return;
	// The final decision belongs to the whole transaction, including other tabs
	// and the review that may follow a Close Save decision.
	const decisions = log.filter(
		(item) =>
			(item.kind === "confirm" || item.kind === "dialog") &&
			item.seq < dispose.seq,
	);
	const lastDecision = decisions.length
		? Math.max(
				...decisions.map((item) => item.decidedSeq ?? item.clickSeq ?? 0),
			)
		: trace.seq0;
	// A save that succeeded leaves its file as the only unresolved target.
	const saved = log.findLast(
		(item) =>
			item.kind === "save" &&
			item.tab === tab &&
			item.outcome === "saved" &&
			item.seq < dispose.seq,
	);
	for (const id of saved ? [saved.id] : trace.owned) {
		const binding = targetBinding(host, id);
		const read = log.some(
			(item) =>
				item.kind === "inspect" &&
				(item.id === id ||
					(binding !== undefined && item.binding === binding)) &&
				item.seq > lastDecision &&
				item.doneSeq !== undefined &&
				item.doneSeq < dispose.seq,
		);
		if (!read)
			violate(
				"T",
				`target ${id} was not read after the last decision and before the tab closed`,
			);
	}
}

/**
 * P: the panel names the recovery target by its current path, compares against
 * what the application last learned about it, and offers actions that fit.
 */
export function checkPanel({ host, native, violate, recoveryId, original }) {
	const panel = host.panel();
	if (!panel.present) {
		const receipt = host.ledger?.saves?.findLast((item) =>
			recoveryId === undefined
				? item.tab === host.activeTab()
				: item.id === recoveryId,
		);
		const lastSave =
			receipt && host.ledger.saves.findLast((item) => item.tab === receipt.tab);
		const adopted =
			receipt &&
			host.ledger.acks.some(
				(ack) =>
					ack.tab === receipt.tab &&
					ack.seq > lastSave.seq &&
					ack.why === "reload",
			);
		const unresolved = receipt
			? host.isOpen(receipt.tab) && lastSave.outcome !== "saved" && !adopted
			: recoveryId !== undefined;
		if (unresolved) violate("P", "the unresolved recovery target has no panel");
		return;
	}
	// The original is never "also changed" while it is itself the recovery target.
	if (
		original &&
		panel.recoveryPath === original.path &&
		panel.originalAlsoChanged
	)
		violate(
			"P",
			"the panel says the original also changed but it is the recovery target",
		);
	const target =
		recoveryId ??
		[...native.docs.values()].find((doc) => doc.path === panel.recoveryPath)
			?.id;
	if (target === undefined) return;
	const receipts = host.ledger.received.filter((item) => item.id === target);
	const latest = receipts.at(-1);
	if (!latest) return;
	const knownPath = receipts.findLast((item) => item.path)?.path;
	if (recoveryId !== undefined && knownPath && panel.recoveryPath !== knownPath)
		violate(
			"P",
			`the panel names ${panel.recoveryPath} but the target is at ${knownPath}`,
		);
	if (panel.preview !== undefined) {
		if (typeof latest.source === "string") {
			if (panel.preview !== latest.source)
				violate(
					"P",
					`the panel shows ${JSON.stringify(panel.preview)} but the application last learned ${JSON.stringify(latest.source)}`,
				);
		} else {
			const stale = receipts
				.map((item) => item.source)
				.filter((source) => typeof source === "string");
			if (stale.includes(panel.preview))
				violate(
					"P",
					`the panel still shows ${JSON.stringify(panel.preview)} after the target became ${latest.unknown ? "unknown" : "missing"}`,
				);
		}
	}
	const unknown = Boolean(latest.unknown);
	if (panel.review && panel.review.disabled !== unknown)
		violate("P", "Review and Save Here… does not follow what is known");
	if (panel.use && panel.use.disabled !== (unknown || latest.source === null))
		violate("P", "Use Current Disk Version… does not follow what is known");
}

/**
 * O: after an observation the panel reflects the files as they are. The
 * original is reported as also changed only while it differs from the content
 * acknowledged for it.
 */
export function checkObservation({
	host,
	native,
	original,
	recovery,
	violate,
}) {
	const panel = host.panel();
	if (!panel.present) {
		violate("O", "no conflict panel in a recovery state");
		return;
	}
	if (recovery) {
		const current = fsOf(native, recovery);
		if (
			!current.unreadable &&
			typeof current.source === "string" &&
			panel.preview !== current.source &&
			panel.recoveryPath === recovery.path
		)
			violate(
				"O",
				`the panel shows ${JSON.stringify(panel.preview)} but ${recovery.path} holds ${JSON.stringify(current.source)}`,
			);
	}
	if (
		original &&
		recovery &&
		original.binding === recovery.binding &&
		panel.originalAlsoChanged
	)
		violate(
			"O",
			"the original is itself the recovery target but the notice is shown",
		);
	if (original && recovery && original.binding !== recovery.binding) {
		const current = fsOf(native, original);
		const known = host.ledger.acks.findLast((ack) => ack.id === original.id);
		if (!current.unreadable) {
			const changed = (current.source ?? null) !== (known?.content ?? null);
			if (changed !== panel.originalAlsoChanged)
				violate(
					"O",
					`the original holds ${JSON.stringify(current.source)} (acknowledged ${JSON.stringify(known?.content)}) but the notice is ${panel.originalAlsoChanged ? "shown" : "absent"}`,
				);
		}
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
