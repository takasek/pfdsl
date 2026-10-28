export const items = [];
let hold;
export function holdNextCreation() {
	let release;
	hold = new Promise((resolve) => {
		release = resolve;
	});
	return release;
}
class Item {
	static async new(options) {
		const item = new Item(options);
		const pending = hold;
		hold = undefined;
		await pending;
		return item;
	}
	constructor(options) {
		Object.assign(this, options);
		this.children = options.items ?? [];
		delete this.items;
		this.closed = 0;
		this.writes = [];
		items.push(this);
	}
	async setEnabled(value) {
		this.writes.push(["enabled", value]);
	}
	async setChecked(value) {
		this.writes.push(["checked", value]);
	}
	async setText(value) {
		this.writes.push(["text", value]);
	}
	async setAsAppMenu() {
		this.installed = true;
	}
	async setAsWindowsMenuForNSApp() {}
	async setAsHelpMenuForNSApp() {}
	async items() {
		return this.children;
	}
	async append(item) {
		this.children.push(item);
	}
	async remove(item) {
		this.children = this.children.filter((child) => child !== item);
	}
	async close() {
		this.closed++;
	}
}

export {
	Item as Menu,
	Item as MenuItem,
	Item as CheckMenuItem,
	Item as Submenu,
	Item as PredefinedMenuItem,
};
