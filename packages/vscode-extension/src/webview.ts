import type { MessageFromWebview, MessageToWebview } from "@pfdsl/editor";
import { mountPreview } from "@pfdsl/editor/preview";

declare const acquireVsCodeApi: () => {
	postMessage(message: MessageFromWebview): void;
};
const preview = mountPreview(document.body, acquireVsCodeApi());
window.addEventListener("message", (event) => {
	void preview.receive(event.data as MessageToWebview);
});
window.addEventListener("pagehide", () => preview.dispose(), { once: true });
