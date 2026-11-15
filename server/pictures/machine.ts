import { randomUUID } from "node:crypto";
import { layout, Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Bytes, type Context, type DeckPath, type Item, type Kernel } from "../kernel/index.ts";
import type { Browser } from "./browser.ts";
import { Native, nativeBinary } from "./native.ts";

// What the pictures' calls need beyond ctx: the browser, the server's own
// address, and a pass for a page. Rule 2.

export interface Machine {
	browser: Browser;
	/** The server's address, http://host:port; refuses unavailable when it is not known. */
	origin(): string;
	/** A card's page address with a fresh pass, and how to drop the pass after. */
	cardPage(card: string, canvas: string): { url: string; done(): void };
	/** The engine's native screenshot tool, when it is built here (rule 17). */
	native?(): Native | undefined;
	/** Stop the native tool, when the server stops. */
	shutdown?(): void;
}

export function machine(browser: Browser, origin: () => string | undefined, kernel: () => Kernel | undefined, useNative = true): Machine {
	const known = () => {
		const at = origin();
		if (!at) throw new Refused("unavailable", "This server has not said its own address, so its browser cannot load a page from it.", "card.get");
		return at.replace(/\/+$/, "");
	};
	let tool: Native | undefined;
	return {
		browser,
		origin: known,
		shutdown: () => tool?.stop(),
		native() {
			const binary = useNative ? nativeBinary() : undefined;
			if (!binary) return undefined;
			if (tool?.binary !== binary) tool = new Native(binary);
			return tool;
		},
		cardPage(card, canvas) {
			const k = kernel();
			if (!k) throw new Refused("unavailable", "The pictures feature has not started yet.", "card.get");
			const who: Caller = { kind: "card", id: `picture-${randomUUID()}`, name: card, canvas };
			const token = k.callers.issue(who, "picture");
			return { url: `${known()}/files/${card.split("/").map(encodeURIComponent).join("/")}?pass=${encodeURIComponent(token)}`, done: () => k.callers.revoke(who.id) };
		},
	};
}

/** A card named by its folder or its index.html, as its index.html. */
export function cardPath(raw: string): DeckPath {
	const trimmed = raw.replace(/\/+$/, "");
	const index = /\/index\.html$/i.test(trimmed) ? trimmed : `${trimmed}/index.html`;
	if (!layout.isCardPath(index)) throw new Refused("invalid", `${raw} is not a card: a card is canvases/<canvas>/cards/<name>/index.html.`, "card.list");
	return toDeckPath(index);
}

/** The card item for a path on a canvas, or a refusal that says how to put it there. */
export function placedCard(ctx: Context, card: string, canvas: string): Item & { id: string; box: { x1: number; y1: number; x2: number; y2: number } } {
	const found = ctx.canvas(canvas).read().find((item) => item.type === "card" && item.card === card);
	if (!found || typeof found.id !== "string" || !found.box) {
		throw new Refused("invalid", `${card} is not on the canvas ${canvas}, so there is no width to fit it at.`, "item.insert");
	}
	return found as Item & { id: string; box: { x1: number; y1: number; x2: number; y2: number } };
}

/** Writes bytes to a deck path as the caller, answering the path. */
export async function keep(ctx: Context, path: string, bytes: Bytes): Promise<string> {
	const at = toDeckPath(path);
	await ctx.deck.write(at, bytes, ctx.caller);
	return at;
}
