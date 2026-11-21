#!/usr/bin/env node
import { run } from "./index.js";

/** Resolve once the data has been handed to the OS; a piped stream writes asynchronously. */
function write(
	stream: NodeJS.WriteStream,
	data: string | Uint8Array | undefined,
): Promise<void> {
	if (!data || data.length === 0) return Promise.resolve();
	// A reader that closed early (e.g. `| head`) is not a failure of this command.
	return new Promise((resolve, reject) =>
		stream.write(data, (error) =>
			error && (error as NodeJS.ErrnoException).code !== "EPIPE"
				? reject(error)
				: resolve(),
		),
	);
}

for (const stream of [process.stdout, process.stderr])
	stream.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code !== "EPIPE") throw error;
	});

const argv = process.argv.slice(2);
const result = await run(argv);
// process.exit() right after write() drops output beyond the pipe buffer.
await write(process.stdout, result.binaryOutput ?? result.stdout);
await write(process.stderr, result.stderr);
process.exit(result.exitCode);
