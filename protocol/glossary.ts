// The nouns every program shares, and the retired words. A retired word may
// appear only in compat/ and upgrade/; the gate reads `retired` from here.

export const SERVER_NOUNS = ["deck", "canvas", "item", "card", "file", "frame", "app", "port", "agent", "view", "tab", "studio", "google"] as const;
export const HARNESS_NOUNS = ["chat", "account", "runtime"] as const;
export const NOUNS = [...SERVER_NOUNS, ...HARNESS_NOUNS] as const;
export type Noun = (typeof NOUNS)[number];

export const nouns: Record<Noun, string> = {
	deck: "The folder that holds everything: canvases, assets, docs and apps. One server serves one deck.",
	canvas: "A pen.dev drawing and the folder around it: canvases/<name>/, with its cards, frames and files.",
	item: "Anything on a canvas: a note, text, a shape, an arrow, a frame, a card, an app or a document.",
	card: "A piece of HTML drawn on a canvas, kept as a folder: cards/<name>/index.html and its files.",
	file: "Any file in the deck, named by its path from the deck's root.",
	frame: "A reusable pen.dev file in a canvas's frames/, placed on the canvas as a ref.",
	app: "A folder in apps/ that the server serves, builds or runs, shown on a canvas as an item.",
	port: "A local server forwarded so a card or an app can frame it.",
	agent: "Who works on the deck: its name, avatar, home canvas, tags and inbox.",
	view: "What a screen shows of a canvas: its camera, its size, and where people point.",
	tab: "The person's shared Chrome tab, driven through the Decks extension.",
	studio: "The hosted Decks a server syncs with.",
	google: "The Google sign-in the server edits Google Docs with.",
	chat: "An agent's conversation, as the harness keeps it.",
	account: "A login the harness spends from.",
	runtime: "A kind of agent the harness can run, and the harness's own settings.",
};

/** Words the rewrite no longer uses, each with the word that replaced it. */
export const retired: readonly { word: string; now: string }[] = [
	{ word: "board", now: "card" },
	{ word: "stage", now: "canvas" },
];

/** The verbs (a call name's second word) that mean the same on every noun. */
export const SHARED_VERBS = ["list", "get", "create", "update", "delete", "move", "copy"] as const;
/** An item's verbs are pen.dev's own ops, so a batch is a list of the same words. */
export const ITEM_OPS = ["insert", "update", "replace", "delete", "move", "copy"] as const;
