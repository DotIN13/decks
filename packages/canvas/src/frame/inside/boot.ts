import { createSignal, untrack } from "solid-js";
import type { Board, Camera } from "@decks/protocol";
import type { PenDocument } from "@decks/pen";
import type { Editor, StageComment } from "../../types.ts";
import type { FrameChromeView, ViewOffer } from "../chrome.ts";
import { useInsets } from "../../camera/insets.ts";
import { isNews } from "../../items/news.ts";
import { boardsOf } from "../../model/drawing.ts";
import { pageItems } from "../../model/boxes.ts";
import { createBackend } from "./backend.ts";
import { createStudioLine } from "./studio-line.ts";
import type { FrameEnd, Page, Rect, Start } from "../protocol.ts";

/**
 * What the frame holds once `start` has come: who keeps the canvas, the drawing first read, the
 * cards and the page's look as signals, and the small answers every other part reads (a file's
 * address, a card's trust, the page's kept values). Made once per frame by `openFrame`; the editor
 * is put in it as soon as it is made (`made`), and everything that reads `handle()` runs after.
 */
export type FrameContext = Awaited<ReturnType<typeof openFrame>>;

export async function openFrame(root: HTMLElement, start: Start, end: FrameEnd, chrome: FrameChromeView | undefined) {
	/*
	 * Who keeps this canvas: a harness, which answers the canvas's calls, its cards' and its agents'
	 * views as well; or Decks Studio, which keeps the drawing and its files and nothing else.
	 */
	const studio = start.backend.kind === "studio" ? createStudioLine(start.backend.api, start.canvas.name, start.backend.token) : undefined;
	const backend = createBackend(start.backend.api, start.canvas.name, start.backend.token);
	let currentToken = start.backend.token;
	const backendToken = () => currentToken;
	/*
	 * Where the canvas's files and pictures are read, with the pass in the address: renewed with the pass
	 * (`token`), so what is read from then on carries the new one. What is already loaded stays as it is.
	 */
	let filesBase = start.files.base;
	let picturesAt = start.pictures;
	end.on("token", (data) => {
		currentToken = data.token;
		backend.setToken(data.token);
		studio?.setToken(data.token);
		if (data.files) filesBase = data.files.base;
		if (data.pictures) picturesAt = data.pictures;
	});
	const first = studio ? { ...(await studio.drawing()), base: start.files.base, cards: [] as Board[] } : await backend.drawing();
	/** The cards and boards on the canvas: their records from the harness, their places from the drawing. */
	const own = (path: string): Page["trust"] => (path.startsWith("shared/") ? "friend" : "own");
	const [pages, setPages] = createSignal<Page[]>(studio ? cardsOf(first.doc, own) : first.cards.map((card) => ({ ...card, trust: own(card.path) })));
	const [camera, setCamera] = createSignal<Camera>(start.camera ?? { x: 0, y: 0, zoom: 1 });
	const [mode, setMode] = createSignal<"edit" | "browse">(start.look.mode);
	const [dark, setDark] = createSignal(start.look.dark);
	const [comment, setComment] = createSignal<StageComment>();
	const [revision, setRevision] = createSignal(0);
	const [agent, setAgent] = createSignal<string | undefined>(start.look.agent);
	const [offer, setOffer] = createSignal<ViewOffer>();
	const [dock, setDock] = createSignal(0);
	/** Where the page's composer is on this frame's screen, as the page last said. */
	let composerBox: Rect | null = null;
	const [narrow, setNarrow] = createSignal(innerWidth < 600);
	/*
	 * On the frame's root, for its styles: a phone's width (`data-phone`, the properties rise as a sheet, as on
	 * the app's page), and how far up the page's composer reaches (`--frame-dock`), which the sheet stands on.
	 */
	const reflect = () => {
		if (untrack(narrow)) root.dataset.phone = "true";
		else delete root.dataset.phone;
		root.style.setProperty("--frame-dock", `${untrack(dock)}px`);
	};
	addEventListener("resize", () => {
		setNarrow(innerWidth < 600);
		reflect();
	});
	reflect();
	/** An agent's cursor on a card (`decks view cursor`), at a point of that card. */
	const [cursor, setCursor] = createSignal<{ path: string; x: number; y: number; label: string; color: string } | null>(null);
	/** The document and app items on the drawing, placed as cards are (`drawing.ts`). */
	let made: Editor | undefined;
	const items = () => {
		revision();
		const doc = made?.handle.drawn();
		return doc ? boardsOf(doc).filter((one) => one.item).map((one) => ({ ...one, inContext: [], trust: "own" as const })) : [];
	};
	/** Every place the stage draws a page in: the cards and boards, and the document and app items. */
	const places = () => [...pages(), ...items()];
	const changed = () => {
		setRevision((n) => n + 1);
		queueMicrotask(placeCards);
	};
	/*
	 * Where each card is, read off the drawing at each change: the same boxes the harness gives
	 * (`StagePens.boards`). A card placed or taken off that the list does not know yet is read again.
	 */
	let cardsReading = false;
	function placeCards(): void {
		const doc = made?.handle.drawn();
		if (!doc) return;
		const boxes = new Map(pageItems(doc).map((item) => [item.path!, item.box]));
		const now = untrack(pages);
		const same = now.length === boxes.size && now.every((page) => boxes.has(page.path));
		// Studio keeps no records of cards: the drawing is all there is of them.
		if (!same && studio) return void setPages(cardsOf(doc, own));
		if (!same) {
			if (cardsReading) return;
			cardsReading = true;
			void backend
				.drawing()
				.then((read) => setPages(read.cards.map((card) => ({ ...card, ...(boxes.get(card.path) ?? {}), trust: own(card.path) }))))
				.catch(() => undefined)
				.finally(() => (cardsReading = false));
			return;
		}
		if (now.some((page) => { const box = boxes.get(page.path)!; return box.x !== page.x || box.y !== page.y || box.w !== page.w || box.h !== page.h; }))
			setPages(now.map((page) => ({ ...page, ...boxes.get(page.path)! })));
	}
	const canWrite = () => start.canvas.role !== "view" && !start.look.readOnly;
	if (start.look.insets) useInsets(start.look.insets);
	document.documentElement.dataset.colorScheme = start.look.dark ? "dark" : "light";
	/** Each agent's name and colour, from the page: what is new glows in its writer's colour. */
	const [agents, setAgents] = createSignal<Record<string, { name: string; color: string }>>(start.look.agents ?? {});
	/** What is new on the canvas: a card an agent changed that you have not read since, in that agent's colour (`board-news.ts`). */
	const news = () => {
		const out: Record<string, string> = {};
		for (const page of pages()) if (isNews(page)) out[page.path] = (page.lastWrittenBy && agents()[page.lastWrittenBy]?.color) || "var(--color-accent)";
		return out;
	};
	const [busy, setBusy] = createSignal<{ writer?: { name?: string; color: string } }>(start.writer ? { writer: start.writer } : {});
	const trust = (path: string) => untrack(pages).find((page) => page.path === path)?.trust ?? own(path);
	const kept = new Map(Object.entries(start.stored));
	/** What each app inside the canvas saved in this browser, by app name: the page keeps it (`app-store`), and an app's address carries it (`options.ts`). */
	const appStored = new Map(Object.entries(start.appStored ?? {}));
	/** The page keeps what this frame cannot: it has no storage of its own. */
	const storage = {
		getItem: (key: string) => kept.get(key) ?? null,
		setItem: (key: string, value: string) => {
			kept.set(key, value);
			end.emit("store", { key, value });
		},
	};
	/** A deck path's address, read on the canvas's ticket. */
	const address = (path: string) => `${filesBase}${path.split("/").map(encodeURIComponent).join("/")}`;
	/*
	 * What a host answers for the canvas (`host.ts`), from the ticket: a deck file in the drawing is read in
	 * the canvas's own folder, where the deck's `assets/` and `docs/` are served beside it too
	 * (`deck/layout.ts`); a link from a board to another is its deck path, when it is one on this canvas.
	 */
	const folder = `canvases/${start.canvas.name}/`;
	// On Studio the address is the canvas's own folder already.
	const inFolder = (path: string) => (studio || path.startsWith(folder) || path.startsWith("shared/") ? path : `${folder}${path}`);
	/*
	 * A document item's editor, on this frame's line (`item-surfaces.tsx`): what it sends goes to the harness,
	 * which answers only for files a document item on this canvas names, down this frame's own stream.
	 */
	const docListeners = new Set<(message: unknown) => void>();
	const hearDoc = (message: unknown) => {
		for (const listener of docListeners) listener(message);
	};
	/** The editor's handle, once it is made: only ever read by what runs after. */
	const handle = () => made!.handle;
	/** A card's item on the drawing, by its path. */
	function cardItem(path: string): { id: string; metadata?: { path?: string; scripts?: unknown; from?: unknown; [key: string]: unknown } } | undefined {
		return ((made?.handle.drawn().children ?? []) as unknown as Array<{ id: string; metadata?: { path?: string } }>).find((one) => one.metadata?.path === path);
	}
	/** Take a card off the drawing by its path, as an edit of yours: what Studio does for Hide and Delete. */
	function takeOff(path: string): boolean {
		const child = ((handle().drawn().children ?? []) as unknown as Array<{ id?: string; metadata?: { path?: string } }>).find((one) => one.metadata?.path === path);
		if (!child?.id) return false;
		handle().edit([{ op: "delete", id: child.id }]);
		return true;
	}
	return {
		appStored,
		root,
		start,
		end,
		chrome,
		studio,
		backend,
		backendToken,
		filesBase: () => filesBase,
		picturesAt: () => picturesAt,
		first,
		own,
		pages,
		setPages,
		camera,
		setCamera,
		mode,
		setMode,
		dark,
		setDark,
		comment,
		setComment,
		revision,
		agent,
		setAgent,
		offer,
		setOffer,
		dock,
		setDock,
		composerBox: () => composerBox,
		setComposerBox: (box: Rect | null) => void (composerBox = box),
		narrow,
		reflect,
		cursor,
		setCursor,
		places,
		changed,
		canWrite,
		agents,
		setAgents,
		news,
		busy,
		setBusy,
		trust,
		storage,
		address,
		folder,
		inFolder,
		docListeners,
		hearDoc,
		setMade: (editor: Editor) => void (made = editor),
		handle,
		cardItem,
		takeOff,
	};
}

/** The cards and boards a drawing places, as the frame lists them, for a canvas kept where cards have no records of their own (Studio). */
function cardsOf(doc: PenDocument, trust: (path: string) => Page["trust"]): Page[] {
	return pageItems(doc).map((item) => ({ path: item.path!, title: item.name ?? item.path!.split("/").slice(-2).join("/"), rev: 0, ...item.box, inContext: [], ...(item.type === "decks.card" ? { card: true as const } : {}), trust: trust(item.path!) }));
}
