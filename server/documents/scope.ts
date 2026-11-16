import { layout, Refused, type Handled } from "../../protocol/index.ts";
import { deckPathFrom, inside, type Context } from "../kernel/types.ts";

// README rule 15: a pass (a caller held to a scope) reaches a document only inside its own canvas's folder
// or placed on its canvas. Every call of this feature is held so, whatever else lets a pass call it.

/** Whether a canvas places an item at a path: the kernel's placed, once the feature has started. */
export type Placed = (canvas: string, path: string) => boolean;

/** Calls that name no document and read nothing of one, which a pass may make as before. */
const OPEN = new Set(["google.status"]);

/** These handlers, each refusing a pass whose path its canvas neither holds nor places. */
export function heldToCanvas(handled: Handled<Context>[], placed: () => Placed | undefined): Handled<Context>[] {
	return handled.map((one) => ({
		call: one.call,
		run: (ctx: Context, args: never) => {
			hold(ctx, one.call.name, args, placed());
			return one.run(ctx, args);
		},
	}));
}

function hold(ctx: Context, name: string, args: unknown, placed: Placed | undefined): void {
	if (!ctx.scope || OPEN.has(name)) return;
	const canvas = ctx.scope.canvas;
	const raw = typeof args === "object" && args !== null ? (args as { path?: unknown }).path : undefined;
	if (canvas === undefined || typeof raw !== "string") throw new Refused("refused", `A pass may not call ${name}: it names no document on its canvas.`, name);
	let path: string;
	try {
		path = deckPathFrom(raw);
	} catch {
		throw new Refused("refused", `A pass may not call ${name} on ${raw}: it is not a path inside the deck.`, name);
	}
	if (inside(path, layout.canvasFolder(canvas).replace(/\/$/, "")) || placed?.(canvas, path)) return;
	throw new Refused("refused", `A pass may not reach ${path}: it is neither in ${canvas}'s folder nor a document ${canvas} places.`, name);
}
