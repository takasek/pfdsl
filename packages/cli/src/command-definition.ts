import type { CommandResult } from "./index.js";

export type OptionSpec = {
	type: "boolean" | "string";
	multiple?: true;
	placeholder?: string;
	required?: true;
};

/** Values after strict parsing and comma-joining repeated option values. */
export type OptionValues<S extends Record<string, OptionSpec>> = {
	[K in keyof S]?:
		| (S[K] extends { multiple: true }
				? string
				: S[K]["type"] extends "boolean"
					? boolean
					: string)
		| undefined;
};

/**
 * The heterogeneous table's dispatch boundary, after strict argv parsing.
 * `run` is a function reference rather than a string-keyed lookup (#902).
 * The listing and full help continue to use the same entry as dispatch.
 */
export interface CommandEntry {
	name: string;
	synopsis: string;
	description: readonly string[];
	help: string;
	options: Record<string, OptionSpec>;
	run: (
		positional: string[],
		flags: Record<string, string | boolean>,
	) => CommandResult | Promise<CommandResult>;
}

/**
 * Infer the input solely from the option declaration, even when a handler
 * reads an unknown key. Runtime dispatch must pass strictly parsed values;
 * this boundary preserves the parser's existing normalization, not a second
 * parser or a guarantee that the handler gives each option an effect.
 */
export function defineCommand<const S extends Record<string, OptionSpec>>(
	options: S,
	definition: Omit<CommandEntry, "options" | "run"> & {
		run: (
			positional: string[],
			options: OptionValues<NoInfer<S>>,
		) => CommandResult | Promise<CommandResult>;
	},
): CommandEntry {
	return {
		...definition,
		options,
		run: (positional, flags) =>
			definition.run(positional, flags as OptionValues<S>),
	};
}
