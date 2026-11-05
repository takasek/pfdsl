import { fsOf } from "./lifecycle-native.mjs";

/** External observations used by both DOM and controller lifecycle oracles. */
export function createLifecycleEvidence(native) {
	const log = [];
	const ledger = {
		acks: [],
		received: [],
		failures: [],
		saves: [],
		offered: [],
	};
	let sequence = 0;
	const tick = () => ++sequence;
	const know = (id, state) =>
		ledger.received.push({ seq: tick(), id, ...state });
	const learn = (snapshot) =>
		know(snapshot.id, {
			source: snapshot.source,
			revision: snapshot.revision,
			path: snapshot.path,
			binding: snapshot.binding,
		});
	const approve = (id, content, why, tab) =>
		ledger.acks.push({
			seq: tick(),
			id,
			binding: native.docs.get(id)?.binding,
			content,
			why,
			tab,
		});
	return { log, ledger, tick, know, learn, approve };
}

/** Native requests and replies, recorded before the controller interprets them. */
export function createNativeRecorder(native, evidence, handlers, owner) {
	const { log, ledger, tick, know, learn } = evidence;
	const approve = (id, content, why) =>
		evidence.approve(id, content, why, owner());
	return {
		async choose(name) {
			const chosen = await handlers.choose();
			if (chosen) {
				// A candidate target is shown to the user; it is not recorded as seen.
				ledger.offered.push({
					seq: tick(),
					id: chosen.id,
					source: chosen.source,
					revision: chosen.revision,
					path: chosen.path,
					binding: chosen.binding,
				});
				// Choosing a file starts from no acknowledged content.
				approve(chosen.id, undefined, "chosen");
			}
			log.push({
				kind: "choose",
				id: chosen?.id,
				name: name,
				seq: tick(),
			});
			return chosen;
		},
		async inspect(id) {
			const entry = {
				kind: "inspect",
				id: id,
				binding: native.docs.get(id)?.binding,
				seq: tick(),
				doneSeq: undefined,
				outcome: undefined,
			};
			log.push(entry);
			const finish = (snapshot) => {
				entry.doneSeq = tick();
				entry.outcome = "ok";
				entry.source = snapshot.source;
				learn(snapshot);
				handlers.afterInspect?.(id, snapshot);
				return snapshot;
			};
			const fail = (error) => {
				entry.doneSeq = tick();
				entry.outcome = "error";
				ledger.failures.push({ id: id, seq: entry.doneSeq });
				throw error;
			};
			const held = handlers.inspectGate?.(id);
			if (held) return held.then(finish, fail);
			let snapshot;
			try {
				snapshot = native.snapshot(native.docs.get(id));
			} catch (error) {
				return fail(error);
			}
			return finish(snapshot);
		},
		async save(args) {
			// Record submission before simulating work on the native side.
			const submittedSeq = tick();
			const target = native.docs.get(args.id);
			const fault = handlers.saveFault?.(args);
			handlers.beforeSave?.(args);
			const forced = handlers.saveReply?.(args);
			const entry = {
				kind: "save",
				tab: owner(),
				seq: submittedSeq,
				id: args.id,
				binding: target.binding,
				source: args.source,
				expected: args.expected,
				fs: fsOf(native, target),
				outcome: "lost",
				wrote: false,
			};
			log.push(entry);
			ledger.saves.push(entry);
			if (forced) {
				entry.outcome = forced.outcome;
				if (forced.current) learn(forced.current);
				else know(args.id, { unknown: true });
				return forced;
			}
			if (fault === "before") {
				know(args.id, { unknown: true });
				throw new Error("native reply lost");
			}
			const reply = native.save(target, args.source, args.expected);
			if (fault === "after") {
				know(args.id, { unknown: true });
				throw new Error("native reply lost");
			}
			entry.outcome = reply.outcome;
			entry.wrote = reply.publication === "published";
			if (reply.current) learn(reply.current);
			else know(args.id, { unknown: true });
			if (reply.outcome === "saved" && reply.current)
				approve(args.id, reply.current.source, "save");
			return reply;
		},
	};
}
