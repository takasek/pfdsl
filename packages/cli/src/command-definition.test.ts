import { describe, expect, it } from "vitest";
import { defineCommand, type OptionValues } from "./command-definition.js";

const schema = {
	json: { type: "boolean" },
	limit: { type: "string", multiple: true },
} as const;

// A helper can name its argument freely and retain the schema's input type.
function resultFor(options: OptionValues<typeof schema>) {
	return {
		stdout: JSON.stringify(options),
		stderr: "",
		exitCode: 0,
	};
}

describe("command definition", () => {
	it("types repeated boolean values as the parser's comma-joined string", async () => {
		const command = defineCommand(
			{ toggle: { type: "boolean", multiple: true } },
			{
				name: "repeated",
				synopsis: "repeated",
				description: [],
				help: "",
				run: (_positionals, options) => {
					const normalized: string | undefined = options.toggle;
					return { stdout: normalized ?? "", stderr: "", exitCode: 0 };
				},
			},
		);
		expect(await command.run([], { toggle: "true,true" })).toEqual({
			stdout: "true,true",
			stderr: "",
			exitCode: 0,
		});
	});
	it("passes normalized optional values to an extracted handler", async () => {
		const command = defineCommand(schema, {
			name: "sample",
			synopsis: "sample",
			description: [],
			help: "sample help",
			run: (_positionals, options) => resultFor(options),
		});
		expect(command.options).toBe(schema);
		expect(await command.run([], { json: true, limit: "1,2" })).toEqual({
			stdout: '{"json":true,"limit":"1,2"}',
			stderr: "",
			exitCode: 0,
		});
		expect(await command.run([], {})).toEqual({
			stdout: "{}",
			stderr: "",
			exitCode: 0,
		});
	});
});

// These use the production factory, and are checked by the package typecheck.
// They are never invoked: the negative accesses are compile-time witnesses.
function typeContracts(): void {
	defineCommand(schema, {
		name: "typed",
		synopsis: "typed",
		description: [],
		help: "",
		run: (_positionals, options) => {
			const json: boolean | undefined = options.json;
			const limit: string | undefined = options.limit;
			// @ts-expect-error An undeclared key must not widen the inferred schema.
			options.unknown;
			// @ts-expect-error Boolean options do not become string options.
			const wrongString: string | undefined = options.json;
			// @ts-expect-error Repeated string flags are normalized to strings, not arrays.
			const wrongArray: string[] | undefined = options.limit;
			void wrongString;
			void wrongArray;
			return resultFor({ json, limit });
		},
	});
	defineCommand(
		{},
		{
			name: "empty",
			synopsis: "empty",
			description: [],
			help: "",
			run: (_positionals, options) => {
				// @ts-expect-error A removed declaration cannot leave a handler read behind.
				options.json;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		},
	);
}
void typeContracts;
