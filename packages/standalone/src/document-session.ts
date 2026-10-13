export interface DiskSnapshot {
	id: number;
	path: string;
	source: string | null;
	revision: string | null;
	identity: string | null;
	binding: string;
}
export interface SaveResult {
	outcome:
		| "saved"
		| "conflict"
		| "failed-before-publication"
		| "published-but-unconfirmed";
	current?: DiskSnapshot | null;
	message?: string;
	publication?: "not-published" | "published" | "unknown";
	targetState?: "readable" | "missing" | "unreadable";
}
interface DocumentView {
	getSource(): string;
	setSource(source: string): void;
	getRevision?(): number | string;
}

/** Match selected capabilities, not display paths that can be rebound. */
export function sameDocument(
	previous: DiskSnapshot,
	current: DiskSnapshot,
	previousMissing = false,
): boolean {
	return Boolean(
		previous.binding === current.binding ||
			(previousMissing &&
				previous.identity &&
				previous.identity === current.identity),
	);
}

/**
 * Metadata-only changes and same-content replacements are not document changes.
 * The raw disk text is compared; the acknowledged editor text is normalized by the editor.
 */
export function sameDiskContent(
	previous: DiskSnapshot,
	current: DiskSnapshot,
): boolean {
	return (
		previous.revision === current.revision ||
		(current.source !== null && current.source === previous.source)
	);
}

/**
 * What the session last learned about one tracked target. An unreadable target
 * keeps the last snapshot for target identification and panel display, never
 * as evidence of a readable current version; `error` is null when it comes from a save
 * receipt instead of a read.
 */
type Observation =
	| { state: "readable"; snapshot: DiskSnapshot }
	| { state: "missing"; snapshot: DiskSnapshot; identity: string | null }
	| {
			state: "unreadable";
			error: string | null;
			last: DiskSnapshot | null;
			identity: string | null;
	  };

/** The result of reading one target. */
type ReadResult = { snapshot: DiskSnapshot } | { error: unknown };

/** "stale" means the result belongs to a state the session has left. */
type ObserveOutcome = "reloaded" | "changed" | "unchanged" | "stale";

/** One confirmed or immediate operation on a target, as the user was shown it. */
export interface OperationPlan {
	kind: "save" | "recreate" | "adopt" | "close";
	target: DiskSnapshot | null;
	/** The revision a save sends. */
	revision: string | null;
	/** The disk text the user was shown. */
	disk: string | null;
	/** The editor text the user was shown and a save sends. */
	editor: string;
	epoch: number;
	editorVersion: number | string;
	/** The acknowledged binding context, replaced when a capability is rebound. */
	acknowledged: object;
}

interface SaveOutcome {
	saved: boolean;
	/** The plan no longer described the document, so nothing was sent. */
	stale: boolean;
	message: string;
}

/** What the conflict panel shows, derived from the session's state. */
interface ConflictPanel {
	state: string;
	message: string;
	targetPath: string;
	/** The snapshot the panel's buttons act on and its preview shows. */
	observed: DiskSnapshot | null;
	/** The original document's path while it also changed beside a Save As recovery. */
	originalChanged: string | null;
}

/** The editor and session state a read started from. */
interface ReadScope {
	acknowledged: object;
	recovery: object | null;
	editorVersion: number | string;
}

interface Acknowledged {
	source: string;
	disk: DiskSnapshot | null;
}
interface Recovery {
	target: DiskSnapshot;
	receipt: SaveResult;
}

function classify(
	snapshot: DiskSnapshot,
	identity: string | null = null,
): Observation {
	return snapshot.source === null
		? { state: "missing", snapshot, identity }
		: { state: "readable", snapshot };
}

/** Last known inode evidence survives a missing leaf; it never establishes readability. */
function identityOf(observation: Observation | undefined): string | null {
	if (!observation) return null;
	return observation.state === "readable"
		? observation.snapshot.identity
		: observation.identity;
}

function known(observation: Observation | undefined): DiskSnapshot | null {
	if (!observation) return null;
	return observation.state === "unreadable"
		? observation.last
		: observation.snapshot;
}

/** The classification or content of a target changed, or it is seen for the first time. */
function differs(previous: Observation | undefined, next: Observation) {
	if (!previous || previous.state !== next.state) return true;
	if (previous.state === "unreadable" || next.state === "unreadable")
		return false;
	return (
		!sameDiskContent(previous.snapshot, next.snapshot) ||
		previous.snapshot.path !== next.snapshot.path
	);
}

function changedMessage(observation: Observation | undefined) {
	return observation?.state === "missing"
		? "The file was deleted or moved. Your editor content is retained."
		: "The disk changed. Your editor content is retained.";
}

/**
 * A document is the text acknowledged in its editor, what was last observed of
 * its file and of an unresolved save target, and a counter of observed changes.
 * Conflict, unsaved state, the conflict panel and the close check are derived.
 */
export class DocumentSession {
	view: DocumentView;
	private acknowledged: Acknowledged;
	private observations = new Map<number, Observation>();
	private recovery: Recovery | null = null;
	private epoch = 0;
	private checkPromise: Promise<void> | null = null;
	private disposed = false;
	constructor(view: DocumentView, disk: DiskSnapshot | null) {
		this.view = view;
		this.acknowledged = { source: view.getSource(), disk };
		if (disk) this.observations.set(disk.id, classify(disk));
	}
	/** The disk version the editor text was acknowledged against. */
	get disk(): DiskSnapshot | null {
		return this.acknowledged.disk;
	}
	/** The editor text that was acknowledged, as the editor normalized it. */
	get savedSource(): string {
		return this.acknowledged.source;
	}
	/** The document's file as last observed, which is where a moved file now lives. */
	get location(): DiskSnapshot | null {
		const disk = this.acknowledged.disk;
		if (!disk) return null;
		const observation = this.observations.get(disk.id);
		const seen = known(observation);
		return seen
			? {
					...disk,
					path: seen.path,
					identity: identityOf(observation) ?? disk.identity,
				}
			: disk;
	}
	/** Whether the document holds this native capability: its own file or an unresolved save target. */
	usesDocument(id: number) {
		return this.acknowledged.disk?.id === id || this.recovery?.target.id === id;
	}
	private editorVersion() {
		return this.view.getRevision?.() ?? this.view.getSource();
	}
	/** True when the file was last observed as the version the editor acknowledged. */
	private agrees(observation: Observation | undefined) {
		const disk = this.acknowledged.disk;
		if (!observation || !disk) return true;
		return (
			observation.state === "readable" &&
			sameDiskContent(disk, observation.snapshot)
		);
	}
	private activeObservation() {
		const disk = this.acknowledged.disk;
		return disk ? this.observations.get(disk.id) : undefined;
	}
	isDirty() {
		return (
			this.view.getSource() !== this.acknowledged.source ||
			this.recovery !== null ||
			!this.agrees(this.activeObservation())
		);
	}
	/** Whether this snapshot is the version of the document's own file that the editor acknowledged. */
	acknowledges(snapshot: DiskSnapshot) {
		const disk = this.acknowledged.disk;
		return Boolean(
			disk && disk.id === snapshot.id && sameDiskContent(disk, snapshot),
		);
	}
	/** A value that changes with whatever a close decision depends on. */
	closeVersion() {
		return JSON.stringify([
			this.editorVersion(),
			this.isDirty(),
			this.epoch,
			this.acknowledged.disk?.id ?? null,
			this.recovery?.target.id ?? null,
		]);
	}
	/** The one place an operation is described: what is shown is what is executed. */
	plan(
		kind: OperationPlan["kind"],
		target: DiskSnapshot | null,
	): OperationPlan {
		return {
			kind,
			target,
			revision: target?.revision ?? null,
			disk: target?.source ?? null,
			editor: this.view.getSource(),
			epoch: this.epoch,
			editorVersion: this.editorVersion(),
			acknowledged: this.acknowledged,
		};
	}
	/**
	 * Whether the document is still as the plan described it. A close decision is
	 * checked against the editor only after its Save read the disk again, because
	 * that read can itself advance the epoch and the review it triggers covers it.
	 */
	holds(plan: OperationPlan, scope: "all" | "editor" = "all") {
		if (plan.acknowledged !== this.acknowledged) return false;
		if (this.disposed || plan.editorVersion !== this.editorVersion())
			return false;
		return scope === "editor" || plan.epoch === this.epoch;
	}
	/** Captures what a read starts from so that a late result can be recognized. */
	begin(): ReadScope {
		return {
			acknowledged: this.acknowledged,
			recovery: this.recovery,
			editorVersion: this.editorVersion(),
		};
	}
	/**
	 * Applies the result of reading one target. Every read, whatever started it,
	 * ends here, so equal observations leave equal protection. A clean editor
	 * follows its file to a readable version with other content.
	 */
	observe(
		target: Pick<DiskSnapshot, "id">,
		result: ReadResult,
		scope?: ReadScope,
	): ObserveOutcome {
		if (this.disposed || !this.usesDocument(target.id)) return "stale";
		if (
			scope &&
			(scope.acknowledged !== this.acknowledged ||
				scope.recovery !== this.recovery)
		)
			return "stale";
		const previous = this.observations.get(target.id);
		const clean = !this.isDirty();
		const next: Observation =
			"error" in result
				? {
						state: "unreadable",
						error: String(result.error),
						last: known(previous),
						identity: identityOf(previous),
					}
				: classify(result.snapshot, identityOf(previous));
		const moved = differs(previous, next);
		this.observations.set(target.id, next);
		if (moved) this.epoch++;
		const disk = this.acknowledged.disk;
		if (
			clean &&
			next.state === "readable" &&
			disk?.id === target.id &&
			!sameDiskContent(disk, next.snapshot) &&
			(!scope || scope.editorVersion === this.editorVersion())
		) {
			this.acknowledge(next.snapshot);
			return "reloaded";
		}
		return moved ? "changed" : "unchanged";
	}
	/** Makes the editor show this version and acknowledges it. */
	private acknowledge(snapshot: DiskSnapshot) {
		if (snapshot.source === null)
			throw new Error("A missing file cannot replace editor content.");
		this.view.setSource(snapshot.source);
		// Monaco normalizes mixed line endings; acknowledge the applied editor value.
		this.acknowledged = { source: this.view.getSource(), disk: snapshot };
		this.recovery = null;
		this.observations = new Map([[snapshot.id, classify(snapshot)]]);
	}
	/** Loads the version a confirmed plan adopted, if the document is still as it was shown. */
	adopt(plan: OperationPlan) {
		if (!plan.target || !this.holds(plan)) return false;
		const seen = this.observations.get(plan.target.id);
		if (seen?.state !== "readable") return false;
		this.acknowledge(seen.snapshot);
		return true;
	}
	/**
	 * Sends the plan's text and revision. A plan the document no longer matches is
	 * not executed. Success makes the written snapshot the target's observation;
	 * anything else keeps the target and the receipt until it is resolved.
	 */
	async save(
		plan: OperationPlan,
		write: (plan: OperationPlan) => Promise<SaveResult>,
	): Promise<SaveOutcome> {
		const target = plan.target;
		if (!target) throw new Error("A save needs a target.");
		if (!this.holds(plan)) return { saved: false, stale: true, message: "" };
		let result: SaveResult;
		try {
			result = await write(plan);
		} catch (error) {
			// An IPC failure does not establish whether native publication occurred.
			result = {
				outcome: "published-but-unconfirmed",
				publication: "unknown",
				targetState: "unreadable",
				message: `The save result could not be confirmed. Editor content is retained; inspect the selected target before retrying. ${String(error)}`,
			};
		}
		const message = result.message ?? "";
		if (result.outcome === "saved" && result.current) {
			if (
				differs(
					this.observations.get(result.current.id),
					classify(result.current),
				)
			)
				this.epoch++;
			this.acknowledged = { source: plan.editor, disk: result.current };
			this.recovery = null;
			this.observations = new Map([
				[result.current.id, classify(result.current)],
			]);
			return { saved: true, stale: false, message };
		}
		const unresolved = result.current ?? target;
		const next: Observation = result.current
			? classify(
					result.current,
					identityOf(this.observations.get(unresolved.id)) ?? target.identity,
				)
			: {
					state: "unreadable",
					error: null,
					last: null,
					identity: target.identity,
				};
		const kept = new Map<number, Observation>();
		const original = this.activeObservation();
		const disk = this.acknowledged.disk;
		if (disk && original && disk.id !== unresolved.id)
			kept.set(disk.id, original);
		if (differs(this.observations.get(unresolved.id), next)) this.epoch++;
		kept.set(unresolved.id, next);
		this.observations = kept;
		this.recovery = { target: unresolved, receipt: result };
		return { saved: false, stale: false, message };
	}
	/**
	 * A reopened selection of the same file (or of its renamed leaf) replaces the
	 * native capability. Unsaved text is kept and nothing is acknowledged for it.
	 */
	rebindDisk(current: DiskSnapshot, previousMissing = false) {
		const previous = this.acknowledged.disk;
		if (
			!previous ||
			!sameDocument(this.location ?? previous, current, previousMissing)
		)
			return false;
		// Re-labelling observations must not erase a change to a plan's target or displayed path.
		if (
			previous.id !== current.id ||
			previous.binding !== current.binding ||
			this.location?.path !== current.path
		)
			this.epoch++;
		const changed = !sameDiskContent(previous, current);
		const owns = (snapshot: DiskSnapshot) =>
			snapshot.binding === previous.binding;
		const move = (snapshot: DiskSnapshot): DiskSnapshot => ({
			...snapshot,
			id: current.id,
			path: current.path,
			binding: current.binding,
		});
		const recovery = this.recovery;
		const followed = (id: number) =>
			id === previous.id ||
			(recovery !== null && id === recovery.target.id && owns(recovery.target));
		const rebound = new Map<number, Observation>();
		for (const [id, observation] of this.observations) {
			if (!followed(id)) {
				rebound.set(id, observation);
				continue;
			}
			rebound.set(
				current.id,
				observation.state === "unreadable"
					? {
							...observation,
							last: observation.last && move(observation.last),
						}
					: { ...observation, snapshot: move(observation.snapshot) },
			);
		}
		// Adopt the selected native capability without acknowledging unsaved text.
		this.acknowledged = {
			source: this.acknowledged.source,
			disk: {
				...previous,
				id: current.id,
				path: current.path,
				binding: current.binding,
				identity: current.identity,
				...(changed ? {} : { revision: current.revision }),
			},
		};
		if (recovery && owns(recovery.target))
			this.recovery = { ...recovery, target: move(recovery.target) };
		this.observations = rebound;
		this.observe(current, { snapshot: current });
		return true;
	}
	/**
	 * What the conflict panel shows: the recovery target or the changed file, named
	 * and shown by one observation, which is also what its buttons act on.
	 */
	panel(): ConflictPanel | null {
		const recovery = this.recovery;
		const disk = this.acknowledged.disk;
		const active = this.activeObservation();
		let seen: Observation | undefined;
		if (recovery) seen = this.observations.get(recovery.target.id);
		else if (active && active.state !== "unreadable" && !this.agrees(active))
			seen = active;
		else return null;
		const observed = known(seen);
		const failed = [...this.observations.values()].find(
			(item) => item.state === "unreadable" && item.error !== null,
		);
		let message: string;
		if (failed?.state === "unreadable")
			message = `The disk version could not be read. Your editor content is retained. ${failed.error}`;
		else if (recovery) {
			const reference = recovery.receipt.current ?? recovery.target;
			message =
				seen &&
				seen.state !== "unreadable" &&
				!sameDiskContent(reference, seen.snapshot)
					? changedMessage(seen)
					: (recovery.receipt.message ?? "");
		} else message = changedMessage(seen);
		const publication = recovery?.receipt.publication;
		const original =
			recovery && disk && recovery.target.binding !== disk.binding
				? this.observations.get(disk.id)
				: undefined;
		return {
			state:
				publication === "published"
					? "Content was published, but the save was not accepted."
					: publication === "unknown"
						? "Whether content was published could not be confirmed."
						: "",
			message,
			targetPath:
				observed?.path ?? recovery?.target.path ?? disk?.path ?? "unknown",
			observed,
			originalChanged:
				disk &&
				original &&
				original.state !== "unreadable" &&
				!sameDiskContent(disk, original.snapshot)
					? original.snapshot.path
					: null,
		};
	}
	/**
	 * Reads every tracked target (the document's own file and an unresolved save
	 * target alike), each independent of the others' failure.
	 */
	checkExternal(read: (id: number) => Promise<DiskSnapshot>): Promise<void> {
		if (this.checkPromise) return this.checkPromise;
		if (this.disposed || (!this.acknowledged.disk && !this.recovery))
			return Promise.resolve();
		this.checkPromise = this.readTargets(read).finally(() => {
			this.checkPromise = null;
		});
		return this.checkPromise;
	}
	private async readTargets(read: (id: number) => Promise<DiskSnapshot>) {
		const scope = this.begin();
		const targets: DiskSnapshot[] = [];
		const disk = this.acknowledged.disk;
		if (disk) targets.push(disk);
		const recovery = this.recovery;
		if (recovery && recovery.target.id !== disk?.id)
			targets.push(recovery.target);
		const results = await Promise.allSettled(
			targets.map((target) => read(target.id)),
		);
		let failure: { reason: unknown } | undefined;
		for (const [index, target] of targets.entries()) {
			const result = results[index];
			if (result?.status === "fulfilled")
				this.observe(target, { snapshot: result.value }, scope);
			else {
				this.observe(target, { error: result?.reason }, scope);
				failure ??= { reason: result?.reason };
			}
		}
		if (failure) throw failure.reason;
	}
	async prepareClose() {
		// A started observation can make this buffer the last surviving readable copy.
		await this.checkPromise?.catch(() => {});
	}
	dispose() {
		this.disposed = true;
	}
}

interface Closable {
	isDirty(): boolean;
	prepareClose?(): Promise<void>;
	closeVersion?(): number | string;
	closePlan?(): OperationPlan;
}
/** Discard is a decision until every document has accepted the close. */
export async function closeDocuments<T extends Closable>(
	documents: T[],
	decide: (document: T) => Promise<"save" | "discard" | "cancel">,
	save: (document: T, plan: OperationPlan | undefined) => Promise<boolean>,
	dispose: (document: T) => void,
	validate: () => boolean = () => true,
): Promise<boolean> {
	const versions = new Map<
		T,
		{ version: number | string | undefined; dirty: boolean }
	>();
	for (const document of documents) {
		await document.prepareClose?.();
		if (document.isDirty()) {
			const requestedVersion = document.closeVersion?.();
			const plan = document.closePlan?.();
			const decision = await decide(document);
			if (decision === "cancel") return false;
			// The answer applies to the document state shown when the decision began.
			if (document.closeVersion?.() !== requestedVersion || !document.isDirty())
				return false;
			if (
				decision === "save" &&
				(!(await save(document, plan)) || document.isDirty())
			)
				return false;
		}
		// A successful Save resolves this decision; compare the final read to its result.
		versions.set(document, {
			version: document.closeVersion?.(),
			dirty: document.isDirty(),
		});
	}
	// Later native prompts suspend polling; inspect every target again before disposal.
	for (const document of documents) await document.prepareClose?.();
	if (
		documents.some(
			(document) =>
				document.closeVersion?.() !== versions.get(document)?.version ||
				document.isDirty() !== versions.get(document)?.dirty,
		)
	)
		return false;
	if (!validate()) return false;
	for (const document of documents) dispose(document);
	return true;
}
