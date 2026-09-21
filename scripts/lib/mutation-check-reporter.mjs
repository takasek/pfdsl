// Structured events preserve names, skip/todo and suite aggregation.
// Test stdout is never parsed as results.
// start/pass/fail are declaration-ordered even when tests run concurrently:
// https://nodejs.org/docs/latest-v24.x/api/test.html#class-testsstream
export default async function* mutationReporter(source) {
	const ancestors = [];
	const tests = [];
	let summary;
	for await (const { type, data } of source) {
		if (type === "test:start") {
			ancestors.length = data.nesting;
			ancestors.push(data.name);
		}
		if (type === "test:pass" || type === "test:fail") {
			const error = data.details?.error;
			tests.push({
				file: data.file,
				name: [...ancestors.slice(0, data.nesting), data.name],
				kind: data.details?.type,
				passed: type === "test:pass",
				skip: Boolean(data.skip),
				todo: Boolean(data.todo),
				failureType: error?.failureType,
				message: error?.cause?.message ?? error?.message,
			});
		}
		if (type === "test:summary" && !data.file) summary = data;
	}
	yield `${JSON.stringify({ tests, summary })}\n`;
}
