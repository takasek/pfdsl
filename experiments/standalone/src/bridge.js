import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const invoke = window.pfdHost?.invoke ?? tauriInvoke;
export function guardClose(shouldClose) {
	if (window.pfdHost)
		return Promise.resolve(window.pfdHost.onCloseRequested(shouldClose));
	return getCurrentWindow().onCloseRequested(async (event) => {
		event.preventDefault();
		if (await shouldClose()) await getCurrentWindow().destroy();
	});
}
