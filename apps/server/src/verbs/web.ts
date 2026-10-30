import type { WebTarget } from "../stage/service.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** The person's own Chrome, shared through the Decks extension. */
export function webVerbs(ctx: VerbContext): Pick<Stage, "web"> {
	const { images, needWeb, needTarget } = ctx;
	return {
		/**
		 * The user's own Chrome, shared with the deck through the Decks extension.
		 *
		 * Every call throws a sentence when no tab is shared, which is the state to expect
		 * first: the user has to pair the extension once and share a tab each time. There is
		 * no picture of the tab — it is on the user's own screen — so `read` is how the agent
		 * sees it: the address, the title, and the accessibility tree with every field's
		 * label and value.
		 */
		web: {
			/** Connected or not, which tab, what the agent did; the settings show this. */
			status: async () => needWeb().status(),
			/** What to put in the extension: the address is the one the browser uses for Decks. */
			pairing: async () => ({ code: needWeb().code(), path: "/api/web/relay", note: "Paste the Decks address and this code into the Decks extension's popup, then share a tab." }),
			/** A fresh code; the extension has to be paired again. */
			repair: async () => ({ code: needWeb().repair() }),
			open: async (url: string) => {
				if (!url?.trim()) throw new Error("open needs a URL");
				return needWeb().open(url.trim());
			},
			read: async () => needWeb().read(),
			/**
			 * A picture of the tab, attached to this call's result so you see it at once, and
			 * saved to `file` for a second look. `full: true` is the whole page.
			 */
			screenshot: async (options?: { full?: boolean }) => {
				const shot = await needWeb().screenshot(options);
				images.push({ data: shot.png.toString("base64"), mimeType: "image/png" });
				return { file: shot.file, width: shot.width, height: shot.height };
			},
			fill: async (field: WebTarget, text: string) => needWeb().fill(needTarget(field, "fill needs the field's label, or a { ref } from decks web read"), String(text ?? "")),
			select: async (field: WebTarget, option: string) => needWeb().select(needTarget(field, "select needs the field's label, or a { ref } from decks web read"), option),
			click: async (what: WebTarget) => needWeb().click(needTarget(what, "click needs the button's or link's name, or a { ref } from decks web read")),
			press: async (key: string) => needWeb().press(key),
			/**
			 * Press the named button, or Enter, once the user has allowed it on the status
			 * board. Pass `{ ask: false }` only when the user has said they do not want to be
			 * asked for this site.
			 */
			submit: async (what?: WebTarget, options?: { ask?: boolean }) =>
				needWeb().submit(what === undefined ? undefined : needTarget(what, "submit needs the button's name, or a { ref } from decks web read"), options),
			/** Detach from the shared tab. */
			stop: async () => needWeb().stop(),
		},
	};
}
