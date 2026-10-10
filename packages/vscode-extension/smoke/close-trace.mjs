import { randomUUID } from "node:crypto";

// The callback runs entirely in the workbench renderer. It does not focus,
// hover, click, or change the close predicate.
export async function startCloseTrace(page, sourceTab) {
	const traceId = randomUUID();
	await sourceTab
		.getByRole("button", { name: /^Close \(/ })
		.evaluate((button, traceId) => {
			const ids = new WeakMap();
			let nextId = 1;
			const groupId = (element) => {
				const group = element?.closest(".editor-group-container");
				if (!group) return null;
				if (!ids.has(group)) ids.set(group, nextId++);
				return ids.get(group);
			};
			const describe = (element) =>
				element
					? {
							tag: element.tagName,
							role: element.getAttribute("role"),
							label: element.getAttribute("aria-label")?.slice(0, 160),
							class: String(element.className).slice(0, 160),
							group: groupId(element),
						}
					: null;
			const rect = (element) => {
				const { x, y, width, height } = element.getBoundingClientRect();
				return { x, y, width, height };
			};
			const snapshot = () => ({
				focused: document.hasFocus(),
				active: describe(document.activeElement),
				groupCount: document.querySelectorAll(".editor-group-container").length,
				groups: [...document.querySelectorAll(".editor-group-container")]
					.slice(0, 8)
					.map((group) => ({
						id: groupId(group),
						rect: rect(group),
						tabs: [...group.querySelectorAll('[role="tab"]')]
							.slice(0, 8)
							.map((tab) => ({
								...describe(tab),
								selected: tab.getAttribute("aria-selected"),
								dirty: tab.classList.contains("dirty"),
								rect: rect(tab),
							})),
					})),
				dialogs: [
					...document.querySelectorAll('[role="dialog"], .monaco-dialog-box'),
				]
					.filter((element) => element.getClientRects().length > 0)
					.slice(0, 4)
					.map((element) => ({
						...describe(element),
						text: element.textContent.slice(0, 160),
					})),
				notifications: [...document.querySelectorAll(".notification-list-item")]
					.slice(0, 4)
					.map((element) => element.textContent.slice(0, 160)),
			});
			const events = [];
			let dropped = 0;
			let lastState;
			const record = (kind, value) => {
				if (events.length === 64) {
					events.shift();
					dropped++;
				}
				events.push({ time: Date.now(), kind, value });
			};
			const observe = () => {
				const state = snapshot();
				const signature = JSON.stringify(state);
				if (signature !== lastState) {
					record("state", state);
					lastState = signature;
				}
			};
			const listen = (event) => {
				if (
					!event.target?.closest?.(
						".editor-group-container, [role=dialog], .monaco-dialog-box",
					)
				)
					return;
				record(event.type, {
					target: describe(event.target),
					trusted: event.isTrusted,
					button: event.button,
					x: event.clientX,
					y: event.clientY,
					closeTarget: event.composedPath().includes(button),
					hit:
						event.clientX === undefined
							? null
							: describe(
									document.elementFromPoint(event.clientX, event.clientY),
								),
				});
			};
			const types = [
				"pointerdown",
				"pointerup",
				"mousedown",
				"mouseup",
				"click",
				"focusin",
				"focusout",
			];
			for (const type of types)
				document.addEventListener(type, listen, {
					capture: true,
					passive: true,
				});
			const observer = new MutationObserver((records) => {
				try {
					for (const mutation of records) {
						for (const field of ["addedNodes", "removedNodes"]) {
							for (const node of mutation[field]) {
								if (node.nodeType !== 1) continue;
								const tabs = node.matches('[role="tab"]')
									? [node]
									: [...node.querySelectorAll('[role="tab"]')];
								for (const tab of tabs.slice(0, 8))
									record(field, {
										...describe(tab),
										parentGroup: groupId(mutation.target),
									});
							}
						}
					}
					observe();
				} catch {
					record("observer.failed", {});
				}
			});
			observer.observe(document.body, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: ["aria-selected", "aria-label", "class"],
			});
			const target = { ...describe(button), rect: rect(button) };
			observe();
			window.__pfdslCloseTraces ??= new Map();
			const traces = window.__pfdslCloseTraces;
			traces.set(traceId, {
				stop: () => {
					observer.disconnect();
					for (const type of types)
						document.removeEventListener(type, listen, true);
					observe();
					traces.delete(traceId);
					if (traces.size === 0) delete window.__pfdslCloseTraces;
					return { target, events, dropped };
				},
			});
		}, traceId);
	return {
		stop: () =>
			page.evaluate(
				(id) => window.__pfdslCloseTraces?.get(id)?.stop(),
				traceId,
			),
	};
}

export async function bestEffort(action, timeoutMs = 1_000) {
	let timer;
	try {
		if (timeoutMs === null) return await action();
		return await Promise.race([
			Promise.resolve().then(action),
			new Promise((resolve) => {
				timer = setTimeout(
					() => resolve({ unavailable: "diagnostic deadline exceeded" }),
					timeoutMs,
				);
			}),
		]);
	} catch (error) {
		return { unavailable: String(error?.message ?? error).slice(0, 240) };
	} finally {
		clearTimeout(timer);
	}
}
