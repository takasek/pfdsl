import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { expectEventually } from "./harness.mjs";
import {
	installEdgeResizeDiagnostics,
	readEdgeResizeDiagnostics,
	removeEdgeResizeDiagnostics,
} from "./resize-diagnostics.mjs";

function fixture() {
	const dom = new JSDOM(
		'<button id="edge">Edge</button><div class="connection-menu" hidden><button id="action">Delete</button></div>',
		{ runScripts: "outside-only" },
	);
	const { document } = dom.window;
	return {
		dom,
		document,
		edge: document.querySelector("#edge"),
		menu: document.querySelector(".connection-menu"),
		action: document.querySelector("#action"),
	};
}

test("resize diagnostics distinguish each failed condition in the timeout output", async () => {
	const { dom, document, edge, menu, action } = fixture();
	try {
		installEdgeResizeDiagnostics(edge);
		edge.focus();
		assert.equal(readEdgeResizeDiagnostics(edge).ready, true);
		for (const failed of ["edgeFocused", "menuHidden", "documentFocused"]) {
			edge.focus();
			menu.hidden = failed !== "menuHidden";
			if (failed === "edgeFocused") action.focus();
			const hasFocus = document.hasFocus.bind(document);
			if (failed === "documentFocused") document.hasFocus = () => false;
			try {
				const state = readEdgeResizeDiagnostics(edge);
				for (const field of ["edgeFocused", "menuHidden", "documentFocused"])
					assert.equal(state[field], field !== failed);
				await assert.rejects(
					expectEventually(
						"resize focus",
						() => readEdgeResizeDiagnostics(edge),
						(state) => state.ready,
						{ timeoutMs: 1, retryIntervalMs: 1 },
					),
					(error) => {
						assert.match(error.message, new RegExp(`"${failed}":false`));
						assert.match(error.message, /"activeElement":/);
						assert.match(error.message, /"viewport":/);
						return true;
					},
				);
			} finally {
				document.hasFocus = hasFocus;
			}
		}
	} finally {
		removeEdgeResizeDiagnostics(edge);
		dom.window.close();
	}
});

test("records menu opening, focus leaving before resize, and hidden mutations without moving focus", async () => {
	const { dom, document, edge, menu, action } = fixture();
	try {
		installEdgeResizeDiagnostics(edge);
		menu.hidden = false;
		action.focus();
		edge.focus();
		dom.window.dispatchEvent(new dom.window.Event("resize"));
		menu.hidden = true;
		await Promise.resolve();
		const state = readEdgeResizeDiagnostics(edge);
		assert.equal(document.activeElement, edge);
		assert.equal(menu.hidden, true);
		assert.equal(state.ready, true);
		assert.ok(
			state.events.some(
				(event) =>
					event.type === "focusout" &&
					event.target.id === "action" &&
					event.relatedTarget.id === "edge",
			),
		);
		const focusout = state.events.findIndex(
			(event) => event.type === "focusout",
		);
		const resize = state.events.findIndex((event) => event.type === "resize");
		assert.ok(focusout >= 0 && resize > focusout);
		assert.ok(
			state.events.some(
				(event) => event.type === "menu-hidden" && event.oldValue === "",
			),
		);
		assert.ok(
			state.events.some(
				(event) => event.type === "menu-hidden" && event.oldValue === null,
			),
		);
		assert.doesNotThrow(() => JSON.stringify(state));
	} finally {
		removeEdgeResizeDiagnostics(edge);
		dom.window.close();
	}
});

test("bounds event history and removes listeners and the observer", async () => {
	const { dom, document, edge, menu } = fixture();
	try {
		installEdgeResizeDiagnostics(edge);
		const recorder = document.__pfdslEdgeResizeDiagnostics;
		for (let index = 0; index < 100; index++) {
			dom.window.dispatchEvent(new dom.window.Event("resize"));
		}
		const state = readEdgeResizeDiagnostics(edge);
		assert.equal(state.events.length, 80);
		assert.ok(state.droppedEvents > 0);
		removeEdgeResizeDiagnostics(edge);
		dom.window.dispatchEvent(new dom.window.Event("resize"));
		menu.hidden = false;
		await Promise.resolve();
		assert.equal(edge.ownerDocument.__pfdslEdgeResizeDiagnostics, undefined);
		assert.deepEqual(recorder.read(edge).events, state.events);
		installEdgeResizeDiagnostics(edge);
		assert.equal(readEdgeResizeDiagnostics(edge).droppedEvents, 0);
	} finally {
		removeEdgeResizeDiagnostics(edge);
		dom.window.close();
	}
});

test("diagnostic callbacks work when serialized into the webview realm", () => {
	const { dom } = fixture();
	try {
		dom.window.eval(
			`(${installEdgeResizeDiagnostics})(document.querySelector('#edge'))`,
		);
		const state = dom.window.eval(
			`(${readEdgeResizeDiagnostics})(document.querySelector('#edge'))`,
		);
		assert.equal(state.events[0].type, "installed");
		dom.window.eval(
			`(${removeEdgeResizeDiagnostics})(document.querySelector('#edge'))`,
		);
		assert.equal(dom.window.document.__pfdslEdgeResizeDiagnostics, undefined);
	} finally {
		dom.window.close();
	}
});
