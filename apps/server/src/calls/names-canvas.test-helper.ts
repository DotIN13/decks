import { VERB_BY_NAME } from "@decks/api";
import type { DecksTool } from "./tool.ts";

/**
 * For tests: an agent names its canvas in every canvas call (`context.ts`, `canvasOf`), and a test
 * whose subject is something else would say `{ canvas }` in every line. This names it for the calls
 * that left it out: the verb's options that take a `canvas` are given this one, unless they name a
 * canvas or a frame file already. The rule itself is tested where it is the subject, with calls made
 * as they are.
 */
export function namingCanvas(verb: string, args: readonly unknown[], canvas: string | undefined): unknown[] {
	const params = VERB_BY_NAME.get(verb)?.params ?? [];
	// The options of a call that acts on a canvas: not an agent's own record or a new agent's, whose `canvas` is where a camera goes.
	const at = params.findIndex((param) => {
		const schema = param.schema as { type?: string; properties?: Record<string, unknown> };
		return param.name === "options" && schema.type === "object" && !!schema.properties && "canvas" in schema.properties;
	});
	// Not past a missing argument before it: a call short of its own arguments is refused as it would be.
	if (!canvas || at < 0 || args.length < at) return [...args];
	const given = args[at];
	if (given !== undefined && given !== null && (typeof given !== "object" || Array.isArray(given))) return [...args];
	const options = (given ?? {}) as { canvas?: unknown; frame?: unknown };
	if ((options.canvas !== undefined && options.canvas !== null) || (options.frame !== undefined && options.frame !== null)) return [...args];
	const out = [...args];
	out[at] = { ...options, canvas };
	return out;
}

/** A tool whose canvas calls name `canvas` when they name none (`namingCanvas`). */
export function onCanvas(tool: DecksTool, canvas: string): DecksTool {
	return { ...tool, call: (name, args, on) => tool.call(name, namingCanvas(name, args, canvas), on) };
}
