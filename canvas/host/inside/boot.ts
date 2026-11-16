import { life } from "./life.ts";
import { createSignal, untrack } from "solid-js";
import type { Page, Camera } from "@decks/protocol-old";
import type { PenDocument } from "@decks/pen";
import type { Editor, StageComment } from "../../types.ts";
import type { FrameChromeView, ViewOffer } from "../chrome.ts";
import { useInsets } from "../../camera/insets.ts";
import { isNews } from "../../items/news.ts";
import { pagesOf } from "../../drawing/drawing.ts";
import { pageItems } from "../../drawing/boxes.ts";
import { createBackend } from "./backend.ts";
import { installPresence } from "./presence.ts";
import { installMarks } from "./marks.ts";
import { createStudioLine } from "./studio-line.ts";
import type { FrameEnd, FramePage, Rect, Start } from "../messages.ts";
import { forgetMissing } from "../../items/missing.ts";
import { giveDeckImports } from "../../cards/card.ts";

/**
 * What the frame holds once `start` has come: who keeps the canvas, the drawing first read, the
 * cards and the page's look as signals, and the small answers every other part reads (a file's
 * address, a card's trust, the page's kept values). Made once per frame by `openFrame`; the editor
 * is put in it as soon as it is made (`made`), and everything that reads `handle()` runs after.
 */
export type FrameContext = Awaited<ReturnType<typeof openFrame>>;

export async function openFrame(root: HTMLElement, start: Start, end: FrameEnd, chrome: FrameChromeView | undefined) {
	const keeper = keeperOf(start, end);
	const { studio, backend } = keeper;
	const first = studio ? { ...(await studio.drawing()), base: start.files.base, cards: [] as Page[] } : await backend.drawing();
	/** The cards and boards on the canvas: their records from the harness, their places from the drawing. */
	const own = (path: string): FramePage["trust"] => (path.startsWith("shared/") ? "friend" : "own");
	const [pages, setPages] = createSignal<FramePage[]>(studio ? cardsOf(first.doc, own) : first.cards.map((card) => ({ ...card, trust: own(card.path) })));
	const { setRevision, ...look } = lookOf(root, start);
	const { items, drawn, ...editor } = editorRef(look.revision);
	/** Everyone else on this canvas: their pointers, selections and cameras, as the line says them (`presence.ts`); said down the harness's line, or Studio's. */
	const presence = installPresence({ camera: look.camera, send: (one) => (studio ? studio.presence(one) : backend.presence(one)), viewport: () => ({ width: innerWidth, height: innerHeight }) });
	/** Marks over what agents draw, each for a moment in the agent's colour (`marks.ts`). */
	const marks = installMarks();
	/** Every place the stage draws a page in: the cards and boards, and the document and app items. */
	const places = () => [...pages(), ...items()];
	/** Where each card is, read off the drawing at each change (`createCardPlacer`). */
	const placer = createCardPlacer({ drawn, pages: () => untrack(pages), setPages, own, ...(studio ? {} : { read: () => backend.drawing() }) });
	const placeCards = placer.place;
	const changed = () => {
		setRevision((n) => n + 1);
		queueMicrotask(placeCards);
	};
	const canWrite = () => start.canvas.role !== "view" && !start.look.readOnly;
	if (start.look.insets) useInsets(start.look.insets);
	document.documentElement.dataset.colorScheme = start.look.dark ? "dark" : "light";
	/** What is new on the canvas: a card an agent changed that you have not read since, in that agent's colour (`items/news.ts`). */
	const news = () => {
		const out: Record<string, string> = {};
		for (const page of pages()) if (isNews(page)) out[page.path] = (page.lastWrittenBy && look.agents()[page.lastWrittenBy]?.color) || "var(--canvas-accent)";
		return out;
	};
	const trust = (path: string) => untrack(pages).find((page) => page.path === path)?.trust ?? own(path);
	const stored = storedOf(start, end);
	const at = addressesOf(start, keeper);
	/*
	 * A document item's editor, on this frame's line (`item-surfaces.tsx`): what it sends goes to the harness,
	 * which answers only for files a document item on this canvas names, down this frame's own stream.
	 */
	const docListeners = new Set<(message: unknown) => void>();
	const hearDoc = (message: unknown) => {
		for (const listener of docListeners) listener(message);
	};
	/** Who is watching each app's state (`apps.watch`): its windows on this canvas, told as the stream says (`app.state`). */
	const appWatchers = new Map<string, Set<(state: { title?: string; status?: string }) => void>>();
	return {
		cardsReads: placer.reads,
		...stored,
		appWatchers,
		root,
		start,
		end,
		chrome,
		...keeper,
		first,
		own,
		pages,
		setPages,
		...look,
		presence,
		marks,
		places,
		changed,
		canWrite,
		news,
		trust,
		...at,
		docListeners,
		hearDoc,
		...editor,
	};
}

/** The editor, once it is made (`setMade`), and what is read off its drawing: the document and app items, a card's item, taking a card off. */
function editorRef(revision: () => number) {
	/** The document and app items on the drawing, placed as cards are (`drawing.ts`). */
	let made: Editor | undefined;
	const items = () => {
		revision();
		const doc = made?.handle.drawn();
		return doc ? pagesOf(doc).filter((one) => one.item).map((one) => ({ ...one, inContext: [], trust: "own" as const })) : [];
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
	const drawn = () => made?.handle.drawn();
	return { items, drawn, setMade: (editor: Editor) => void (made = editor), handle, cardItem, takeOff };
}

/*
 * Who keeps this canvas: a harness, which answers the canvas's calls, its cards' and its agents'
 * views as well; or Decks Studio, which keeps the drawing and its files and nothing else.
 */
function keeperOf(start: Start, end: FrameEnd) {
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
		// Another source (a harness back in reach, or gone) or the next pass on it: what was missing is asked for again.
		if (data.files && data.files.base !== filesBase) forgetMissing();
		if (data.files) filesBase = data.files.base;
		if (data.pictures) picturesAt = data.pictures;
	});
	return { studio, backend, backendToken, filesBase: () => filesBase, picturesAt: () => picturesAt };
}

/** The page's look and the frame's own state, as signals: camera, mode, scheme, comment, agent, offer, dock, width, cursor, agents, who is busy. */
function lookOf(root: HTMLElement, start: Start) {
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
	}, { signal: life() });
	reflect();
	/** An agent's cursor on a card (`decks view cursor`), at a point of that card. */
	const [cursor, setCursor] = createSignal<{ path: string; x: number; y: number; label: string; color: string } | null>(null);
	/** Each agent's name and colour, from the page: what is new glows in its writer's colour. */
	const [agents, setAgents] = createSignal<Record<string, { name: string; color: string }>>(start.look.agents ?? {});
	const [busy, setBusy] = createSignal<{ writer?: { name?: string; color: string } }>(start.writer ? { writer: start.writer } : {});
	return {
		camera,
		setCamera,
		mode,
		setMode,
		dark,
		setDark,
		comment,
		setComment,
		revision,
		setRevision,
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
		agents,
		setAgents,
		busy,
		setBusy,
	};
}

/** What the page keeps for the frame, which has no storage of its own: its values, and what each app inside it saved. */
function storedOf(start: Start, end: FrameEnd) {
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
	return { appStored, storage };
}

/** A deck path's address, read on the canvas's ticket, and where a path in the drawing is read. */
function addressesOf(start: Start, keeper: ReturnType<typeof keeperOf>) {
	const { studio } = keeper;
	const address = (path: string) => `${keeper.filesBase()}${path.split("/").map(encodeURIComponent).join("/")}`;
	/*
	 * What a host answers for the canvas (`host.ts`), from the ticket: a deck file in the drawing is read in
	 * the canvas's own folder, where the deck's `assets/` and `docs/` are served beside it too
	 * (`deck/layout.ts`); a link from a board to another is its deck path, when it is one on this canvas.
	 */
	const folder = `canvases/${start.canvas.name}/`;
	// The deck's import map, once for every card here (the harness's), before any card's script runs: its paths under assets/ read beside this canvas's cards, where the deck's assets/ is served.
	if (start.imports) giveDeckImports(start.imports, new URL(folder, start.files.base).href);
	// On Studio the address is the canvas's own folder already.
	const inFolder = (path: string) => (studio || path.startsWith(folder) || path.startsWith("shared/") ? path : `${folder}${path}`);
	return { address, folder, inFolder };
}

/** The cards and boards a drawing places, as the frame lists them, for a canvas kept where cards have no records of their own (Studio). */
function cardsOf(doc: PenDocument, trust: (path: string) => FramePage["trust"]): FramePage[] {
	return pageItems(doc).map((item) => ({ path: item.path!, title: item.name ?? item.path!.split("/").slice(-2).join("/"), rev: 0, ...item.box, inContext: [], ...(item.type === "decks.card" ? { card: true as const } : {}), trust: trust(item.path!) }));
}

/** What `createCardPlacer` reads and writes, so it runs, and is tested, without a frame. */
export interface CardPlacerDeps {
	drawn(): PenDocument | undefined;
	pages(): FramePage[];
	setPages(next: FramePage[]): void;
	own(path: string): FramePage["trust"];
	/** The host's card records; none for Studio, which keeps no records of cards. */
	read?: () => Promise<{ cards: Page[] }>;
}

/**
 * The frame's card list kept in step with the drawing, which says what is on the canvas: a card the
 * drawing no longer has leaves the list at once; a card it has that the list lacks is read again from
 * the host, one read at a time, and once more when the drawing changed while a read was out.
 */
export function createCardPlacer(deps: CardPlacerDeps): { place(): void; reads(): number } {
	let reading = false;
	let again = false;
	let reads = 0;
	const boxesOf = (doc: PenDocument) => new Map(pageItems(doc).map((item) => [item.path!, item.box]));
	const read = (doc: PenDocument) => {
		if (reading) return void (again = true);
		reading = true;
		reads++;
		void deps.read!()
			.then((answer) => {
				// What the drawing has when the answer comes: a read that crossed a removal does not bring the card back.
				const boxes = boxesOf(deps.drawn() ?? doc);
				deps.setPages(answer.cards.filter((card) => boxes.has(card.path)).map((card) => ({ ...card, ...boxes.get(card.path)!, trust: deps.own(card.path) })));
			})
			.catch(() => undefined)
			.finally(() => {
				reading = false;
				if (again) { again = false; place(); }
			});
	};
	function place(): void {
		const doc = deps.drawn();
		if (!doc) return;
		const boxes = boxesOf(doc);
		const now = deps.pages();
		const kept = now.filter((page) => boxes.has(page.path));
		const lacking = kept.length < boxes.size;
		if (!deps.read) return void ((lacking || kept.length < now.length) && deps.setPages(cardsOf(doc, deps.own)));
		const placed = kept.map((page) => ({ ...page, ...boxes.get(page.path)! }));
		const moved = placed.some((page, i) => page.x !== kept[i]!.x || page.y !== kept[i]!.y || page.w !== kept[i]!.w || page.h !== kept[i]!.h);
		if (kept.length < now.length || moved) deps.setPages(placed);
		if (lacking) read(doc);
	}
	return { place, reads: () => reads };
}
