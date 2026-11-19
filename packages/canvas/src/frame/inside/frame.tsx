import type { FrameChromeView } from "../chrome.ts";
import { bootGuest } from "@decks/frame";
import type { AppEnd, AppStart } from "../app/protocol.ts";
import type { CardEnd, CardStart } from "../card/protocol.ts";
import type { DocumentEnd, DocumentStart } from "../document/protocol.ts";
import { peer, type FrameEnd, type Start } from "../protocol.ts";

/**
 * What a frame can show, each kind's code loaded when a frame of that kind is wanted and not before.
 *
 * A frame has no cache in the browser, so everything its page names is fetched whole each time one
 * starts. A canvas needs the editor and the drawing engine, megabytes of them; a card, a document or
 * an app shown whole (`card/`, `document/`, `app/`) needs a small part of that, and used to load it
 * all. So the frame's own entry holds only this: hello, the start, and which kind's code to ask for.
 */
const KINDS = {
	canvas: () => import("./canvas-run.tsx"),
	card: () => import("../card/guest.tsx"),
	document: () => import("../document/guest.tsx"),
	app: () => import("../app/guest.tsx"),
};

/** The app's own chrome for the canvas, or how to load it: a frame that shows a card needs none. */
type Chrome = FrameChromeView | (() => Promise<FrameChromeView>);

/**
 * The frame's own beginning, whatever it goes on to show (`@decks/frame`, `bootGuest`): hello to its
 * parent, then the page's start and the port, and the kind the start names is run (`KINDS`): a card,
 * a document or an app whole, or a canvas, whose start names none (`canvas-run.tsx`).
 *
 * The page says in the frame's address which kind it means to start (`?kind=`), and that kind's code
 * is asked for at once, beside hello, so it is on its way while the page fetches the frame's pass.
 * The page moves a frame to another of your canvases in place (`reset`), rather than making a new
 * frame: what this canvas started goes (its editor and engine, its cards, its line, its listeners),
 * and the frame says hello again for the next one, keeping what it loaded (its code, the engine's
 * compiled module). The page decides when, and makes a new frame for a friend's canvas.
 */
export function bootFrame(root: HTMLElement, options: { chrome?: Chrome; /** The font files the app serves itself, beside its own page (`look/font-files.ts`, `useShippedFonts`): where, and which. */ fonts?: { base: string; files: readonly string[] } } = {}): void {
	// The canvas's own styles are scoped to it (`canvas.css`, `.decks-canvas`), as the editor's root is.
	root.classList.add("decks-canvas");
	/** The chrome, loaded once it is known a canvas is coming: a function that takes no chrome is how to load one. */
	let chrome: Promise<FrameChromeView | undefined> | undefined;
	const chromeOf = () => (chrome ??= Promise.resolve(options.chrome === undefined ? undefined : options.chrome.length === 0 ? (options.chrome as () => Promise<FrameChromeView>)() : (options.chrome as FrameChromeView)));
	const ask = <Kind extends keyof typeof KINDS>(kind: Kind): ReturnType<(typeof KINDS)[Kind]> => {
		if (kind === "canvas") void chromeOf();
		return KINDS[kind]() as ReturnType<(typeof KINDS)[Kind]>;
	};
	const told = new URLSearchParams(location.search).get("kind");
	if (told && told in KINDS) void ask(told as keyof typeof KINDS).catch(() => {});
	bootGuest<Start | CardStart | DocumentStart | AppStart>({
		run: async (start, port) => {
			if (!("kind" in start)) return (await ask("canvas")).run(root, start, peer(port) as FrameEnd, await chromeOf(), options.fonts);
			if (start.kind === "card") return (await ask("card")).runCard(root, start, peer(port) as CardEnd);
			return start.kind === "document" ? (await ask("document")).runDocument(root, start, peer(port) as DocumentEnd) : (await ask("app")).runApp(root, start, peer(port) as AppEnd);
		},
		cleared: () => {
			void import("../../base/missing.ts").then((missing) => missing.forgetMissing());
			root.replaceChildren();
		},
		// Kept spare by the page for the next canvas: its code is loaded and its drawing engine started, with nothing to draw.
		warm: () => void ask("canvas").then((canvas) => canvas.warm()),
	});
}
