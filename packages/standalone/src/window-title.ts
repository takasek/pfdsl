/** Keep at most one native write in flight; intermediate desired titles can be skipped. */
export function createWindowTitle(
	write: (title: string) => Promise<void>,
	report: (error: unknown) => void,
) {
	let desired: string | undefined;
	let applied: string | undefined;
	let running = false;
	async function drain() {
		running = true;
		try {
			while (desired !== undefined && desired !== applied) {
				const title = desired;
				try {
					await write(title);
					applied = title;
				} catch (error) {
					report(error);
					if (desired === title) break;
				}
			}
		} finally {
			running = false;
		}
	}
	return (title: string) => {
		// Retry a failed write only when the requested title changes.
		if (title === desired) return;
		desired = title;
		if (!running && desired !== applied) void drain();
	};
}
