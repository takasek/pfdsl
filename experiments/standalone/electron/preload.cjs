const { contextBridge, ipcRenderer } = require("electron");

const commands = new Set([
	"list_documents",
	"read_document",
	"write_document",
	"write_export",
	"export_pdf",
]);

contextBridge.exposeInMainWorld("pfdHost", {
	invoke(command, args = {}) {
		if (!commands.has(command))
			return Promise.reject(new Error("Unsupported prototype command"));
		return ipcRenderer.invoke("pfdsl:invoke", command, args);
	},
	onCloseRequested(callback) {
		if (typeof callback !== "function")
			throw new Error("Close callback must be a function");
		const listener = async () => {
			try {
				if ((await callback()) === true) ipcRenderer.send("pfdsl:close-allow");
			} catch {
				// A failed save or cancelled dialog must keep the editor open.
			}
		};
		ipcRenderer.on("pfdsl:close-requested", listener);
		ipcRenderer.send("pfdsl:close-subscribe", true);
		return () => {
			ipcRenderer.removeListener("pfdsl:close-requested", listener);
			ipcRenderer.send("pfdsl:close-subscribe", false);
		};
	},
});
