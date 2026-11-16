import { randomUUID } from "node:crypto";
import { Refused, type Caller } from "../../protocol/index.ts";
import type { Kernel } from "../kernel/index.ts";
import type { Browser } from "./browser.ts";
import { Native, nativeBinary } from "./native.ts";

// What the pictures' calls need beyond ctx (rule 2): the browser, the server's
// own address, a pass for a page and the native tool.

export interface PictureTools {
	browser: Browser;
	/** The server's address, http://host:port; refuses unavailable when it is not known. */
	origin(): string;
	/** A card's page address with a fresh pass, and how to drop the pass after. */
	cardPage(card: string, canvas: string): { url: string; done(): void };
	/** The engine's native screenshot tool, when it is built here (rule 17). */
	native?(): Native | undefined;
	/** Stop the native tool, when the server stops. */
	shutdown?(): void;
	/** Whether a canvas places an item at a deck path (the kernel's answer); false before the server starts. */
	placed?(canvas: string, path: string): boolean;
}

const PICTURE_MS = 10 * 60_000;

export function pictureTools(browser: Browser, origin: () => string | undefined, kernel: () => Kernel | undefined, useNative = true): PictureTools {
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
		placed: (canvas, path) => kernel()?.placed(canvas, path) ?? false,
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
			// Its own canvas, no calls (the page only loads files), and an end: done, or ten minutes at most.
			const token = k.callers.issue(who, "picture", { canvas, calls: [], until: Date.now() + PICTURE_MS });
			return { url: `${known()}/files/${card.split("/").map(encodeURIComponent).join("/")}?pass=${encodeURIComponent(token)}`, done: () => k.callers.revoke(who.id) };
		},
	};
}
