/** Keep at most one native write in flight; intermediate desired titles can be skipped. */
export function createWindowTitle(
	write: (title: string) => Promise<void>,
	report: (error: unknown) => void,
) {
	let desired = "";
	let applied: string | undefined;
	let running = false;
	async function drain() {
		running = true;
		try {
			while (desired !== applied) {
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
		desired = title;
		if (!running && desired !== applied) void drain();
	};
}
