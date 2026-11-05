import { expectEventually } from "./harness.mjs";

export function waitForSourceCloseReady(sourceTab, options) {
	return expectEventually(
		"source tab is present without an unsaved indicator before Close",
		async () => {
			const count = await sourceTab.count();
			const className =
				count === 1 ? await sourceTab.getAttribute("class") : null;
			return { count, className };
		},
		({ count, className }) =>
			count === 1 &&
			typeof className === "string" &&
			!className.split(/\s+/).includes("dirty"),
		options,
	);
}
