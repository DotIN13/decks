import { randomUUID } from "node:crypto";
import { Refused, type Caller } from "../../protocol/index.ts";
import type { Kernel } from "../kernel/index.ts";
import type { Browser } from "./browser.ts";
import { Native, nativeBinary } from "./native.ts";

// What the pictures' calls need beyond ctx (rule 2): the browser, the server's
// own address, a pass for a page and the native tool.

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
