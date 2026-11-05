const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

class Workspace {
	constructor(root) {
		this.root = fs.realpathSync(root);
		if (!fs.statSync(this.root).isDirectory())
			throw new Error("Workspace must be a directory");
	}

	resolve(relative) {
		if (
			typeof relative !== "string" ||
			!relative ||
			path.isAbsolute(relative)
		) {
			throw new Error("Path must remain inside the workspace");
		}
		const parts = [];
		for (const part of relative.split("/")) {
			if (part === "" || part === ".") continue;
			if (part === "..") {
				if (!parts.length)
					throw new Error("Path must remain inside the workspace");
				parts.pop();
			} else parts.push(part);
		}
		if (!parts.length) throw new Error("A file path is required");
		const candidate = path.join(this.root, ...parts);
		let resolved;
		try {
			fs.lstatSync(candidate);
			resolved = fs.realpathSync(candidate);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			// A dangling symlink must not be treated as a new file.
			if (fs.existsSync(path.dirname(candidate))) {
				try {
					if (fs.lstatSync(candidate).isSymbolicLink())
						throw new Error("Cannot resolve workspace symlink");
				} catch (missing) {
					if (missing.code !== "ENOENT") throw missing;
				}
			}
			resolved = path.join(
				fs.realpathSync(path.dirname(candidate)),
				path.basename(candidate),
			);
		}
		if (!inside(resolved, this.root))
			throw new Error("Path must remain inside the workspace");
		return resolved;
	}

	read(relative) {
		const target = this.resolve(relative);
		requireExtension(target, [".pfdsl"]);
		return fs.readFileSync(target, "utf8");
	}

	writeDocument(relative, text, expectedText) {
		if (typeof text !== "string" || typeof expectedText !== "string")
			throw new Error("Document text must be a string");
		const target = this.resolve(relative);
		requireExtension(target, [".pfdsl"]);
		const current = fs.readFileSync(target, "utf8");
		if (current !== expectedText) {
			throw new Error(
				"Document changed on disk. Reload before saving; your editor changes have not been written.",
			);
		}
		atomicWrite(target, text);
	}

	exportPath(relative) {
		const target = this.resolve(relative);
		if (!inside(target, path.join(this.root, "exports")))
			throw new Error("Exports must be written beneath exports/");
		requireExtension(target, [".svg", ".png", ".pdf", ".json"]);
		return target;
	}

	writeExport(relative, bytes) {
		const target = this.exportPath(relative);
		if (
			!Buffer.isBuffer(bytes) &&
			(!Array.isArray(bytes) ||
				bytes.some(
					(value) => !Number.isInteger(value) || value < 0 || value > 255,
				))
		) {
			throw new Error("Export bytes must contain integers from 0 to 255");
		}
		atomicWrite(target, Buffer.from(bytes));
	}

	documents() {
		const documents = [];
		const samples = this.resolve("docs/samples");
		if (fs.existsSync(samples)) {
			for (const name of fs.readdirSync(samples)) {
				if (path.extname(name) !== ".pfdsl") continue;
				const relative = `docs/samples/${name}`;
				if (fs.statSync(this.resolve(relative)).isFile())
					documents.push(relative);
			}
		}
		for (const name of ["roadmap", "pipeline", "workflow"]) {
			const relative = `.pfdsl/${name}.pfdsl`;
			const target = this.resolve(relative);
			if (fs.existsSync(target) && fs.statSync(target).isFile())
				documents.push(relative);
		}
		return documents
			.sort()
			.map((relative) => ({ path: relative, name: path.basename(relative) }));
	}
}

function inside(target, root) {
	const relative = path.relative(root, target);
	return (
		relative !== "" &&
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

function requireExtension(target, extensions) {
	if (!extensions.includes(path.extname(target)))
		throw new Error(`File extension must be one of: ${extensions.join(", ")}`);
}

function atomicWrite(target, bytes) {
	const temporary = path.join(
		path.dirname(target),
		`.pfdsl-save-${process.pid}-${randomUUID()}`,
	);
	let fd;
	try {
		fd = fs.openSync(temporary, "wx", 0o600);
		fs.writeFileSync(fd, bytes);
		fs.fsyncSync(fd);
		fs.closeSync(fd);
		fd = undefined;
		fs.renameSync(temporary, target);
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
		fs.rmSync(temporary, { force: true });
	}
}

module.exports = { Workspace };
