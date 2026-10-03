import type { DiffReport } from "@pfdsl/core";
import type { MessageToWebview } from "./messages.js";

type DiffMessage = Extract<MessageToWebview, { type: "diff" | "clearDiff" }>;

/**
 * One panel's notification lifecycle. Before ready, only the latest diff or
 * clear is retained. An update attempts render/error before draining it once.
 * Sending means invoking the host callback, not confirming webview delivery.
 */
export class PreviewController {
	private ready = false;
	private disposed = false;
	private pendingDiff: DiffReport | null | undefined;

	constructor(
		private readonly render: (focusNodeId: string | undefined) => void,
		private readonly postMessage: (message: DiffMessage) => void,
		private pendingFocusNodeId?: string,
	) {}

	markReady(): void {
		if (this.disposed) return;
		this.ready = true;
		this.update();
	}

	update(): void {
		if (!this.ready || this.disposed) return;
		const focusNodeId = this.pendingFocusNodeId;
		this.pendingFocusNodeId = undefined;
		this.render(focusNodeId);
		if (this.pendingDiff !== undefined) {
			const report = this.pendingDiff;
			this.pendingDiff = undefined;
			this.sendDiff(report);
		}
	}

	postDiff(report: DiffReport | null): void {
		if (this.disposed) return;
		if (this.ready) this.sendDiff(report);
		else this.pendingDiff = report;
	}

	dispose(): void {
		this.disposed = true;
		this.pendingDiff = undefined;
		this.pendingFocusNodeId = undefined;
	}

	private sendDiff(report: DiffReport | null): void {
		this.postMessage(
			report === null ? { type: "clearDiff" } : { type: "diff", report },
		);
	}
}
