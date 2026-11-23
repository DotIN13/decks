import type { WebTarget } from "../canvas/service.ts";
import type { Verbs as Stage } from "@decks/sdk";
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
			/** Every tab in the Decks group, numbered from 1, and which one the other verbs act on. */
			tabs: async () => needWeb().tabs(),
			/** Open a new tab in the Decks group (at `url`, when given) and act on it from now on. */
			newTab: async (url?: string) => needWeb().newTab(url),
			/** Act on another tab of the group from now on: its number from `tabs`, or words in its address or title. */
			tab: async (which: number | string) => {
				if (which === undefined || which === null || String(which).trim() === "") throw new Error("tab needs a tab's number from decks web tabs, or words in its address or title");
				return needWeb().useTab(which);
			},
			/** Close a tab of the group: the one acted on, or the one named. The last shared tab cannot be closed. */
			closeTab: async (which?: number | string) => needWeb().closeTab(which),
			/** Every field on the page, frames included, with its label and current value. */
			values: async () => needWeb().values(),
			/** The page as a tree of fields and buttons; long option lists are folded unless `full: true`. */
			read: async (options?: { full?: boolean }) => needWeb().read(options),
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
			/**
			 * Click a button or link. One whose words say it sends, emails, invites, pays or deletes
			 * waits for the user's Allow on the status board, as submit does; `{ ask: false }` only
			 * when the user has said not to be asked for this site.
			 */
			click: async (what: WebTarget, options?: { ask?: boolean }) => needWeb().click(needTarget(what, "click needs the button's or link's name, or a { ref } from decks web read"), options),
			press: async (key: string) => needWeb().press(key),
			/** Put the keyboard's focus on a field or button without clicking it. */
			focus: async (what: WebTarget) => needWeb().focus(needTarget(what, "focus needs the field's label, or a { ref } from decks web read")),
			/** Type text key by key into the focused field, or into `into` first. */
			type: async (text: string, into?: WebTarget) =>
				needWeb().type(String(text ?? ""), into === undefined ? undefined : needTarget(into, "type needs the field's label, or a { ref } from decks web read")),
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
