import { calls, events, type Handled } from "../../../protocol/index.ts";
import { handle, toDeckPath, type Context, type Deck } from "../../kernel/types.ts";
import { Typesetter, type Compiled, type Run } from "./compile.ts";

// The LaTeX part of the documents feature: file.compile, each finished run told as file.compiled.

export type { Run } from "./compile.ts";
export { readErrors, tectonicCandidates } from "./tectonic.ts";

/** The handlers; machine is read at call time, since the kernel arrives at start (rule 11). */
export function latexCalls(machine: () => Run | undefined, candidates?: string[]): Handled<Context>[] {
	const typesetter = new Typesetter(machine, candidates);
	return [
		handle(calls.file.compile, async (ctx, { path }) => {
			const done = await typesetter.compile(ctx.deck, path, ctx.caller);
			const { path: ids, ...told } = done;
			ctx.events.emit(events.fileCompiled, { ...told, ids: [ids], by: ctx.caller.id, rev: await revisionOf(ctx.deck, ids) });
			return done;
		}),
	];
}

/** The document's current revision, for the event (protocol rule 7); 0 when the deck keeps none. */
async function revisionOf(deck: Deck, path: string): Promise<number> {
	const all = (await deck.revisions?.(toDeckPath(path))) ?? [];
	return all.at(-1)?.rev ?? 0;
}

export type { Compiled };
