export function createCloseGuard(discardAndClose: () => Promise<void>) {
	let pending = false;
	return async (event: { preventDefault(): void }, dirty: boolean) => {
		if (!dirty) return;
		event.preventDefault();
		if (pending) return;
		pending = true;
		try {
			await discardAndClose();
		} finally {
			pending = false;
		}
	};
}
