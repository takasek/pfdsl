export function createTextComparison(parent, local, disk) {
	const fields = [local, disk ?? "File is missing"].map((value) => {
		const field = parent.ownerDocument.createElement("textarea");
		field.readOnly = true;
		field.value = value;
		parent.append(field);
		return field;
	});
	return {
		dispose() {
			for (const field of fields) field.remove();
		},
	};
}
