import { baseTheme, placements, serialize, type PenEdit } from "@decks/pen";
import { createSignal, untrack } from "solid-js";
import { render } from "solid-js/web";
import type { Board } from "@decks/protocol";
import { createEditor } from "../../mount.tsx";
import type { Editor, StageComment } from "../../types.ts";
import { passless, passOf, setCanvasHost, withPass } from "../../host.ts";
import { drawing, setDrawing } from "../../edit/ink.ts";
import type { Camera } from "@decks/protocol";
import type { FrameChromeView } from "../chrome.ts";
import { canvasBox, useInsets } from "../../camera/insets.ts";
import { fitInto } from "../../camera/camera.ts";
import { cardCalls } from "./card-calls.ts";
import { runStageCall } from "../../camera/stage-ops.ts";
import type { ViewOffer } from "../chrome.ts";
import { AgentCursor } from "../../ui/AgentCursor.tsx";
import { isNews } from "../../items/news.ts";
import { cardShot } from "../../items/card-surface.tsx";
import { boardsOf } from "../../model/drawing.ts";
import { pageItems, placedItems } from "../../model/boxes.ts";
import { handsOn } from "../../camera/touched.ts";
import { createBackend, drawingFollower } from "./backend.ts";
import { createStudioLine } from "./studio-line.ts";
import { PROTOCOL, peer, type CardSlot, type FrameEnd, type Hello, type Page, type Rect, type Start, type StartMessage } from "../protocol.ts";

/**
 * The canvas, run inside its frame: says `hello` to its parent, takes `start` and the port, reads its
 * drawing from the harness on the canvas token (`backend.ts`), makes the editor, follows the canvas's
 * stream and sends your edits itself. With the page it trades only what is the page's: its chrome, the
 * composer, your storage (`protocol.ts`).
 *
 * What a host answered with a function (a board's address, its picture, its storage) is worked out
 * here from `start`: the files' ticketed address, the pages' trust, the page's kept values.
 */
export function bootFrame(root: HTMLElement, options: { chrome?: FrameChromeView } = {}): void {
	const parent = window.parent;
	if (parent === window) throw new Error("The canvas frame runs inside the app's page.");
	// The canvas's own styles are scoped to it (`canvas.css`, `.decks-canvas`), as `mountCanvas` scopes them.
	root.classList.add("decks-canvas");
	const onStart = (event: MessageEvent<StartMessage>) => {
		// Only the parent's answer, with its port: nothing else is read, then or later.
		if (event.source !== parent || event.data?.t !== "start" || !event.ports[0]) return;
		removeEventListener("message", onStart);
		void run(root, event.data.start, peer(event.ports[0]) as FrameEnd, options.chrome);
	};
	addEventListener("message", onStart);
	parent.postMessage({ t: "hello", protocol: PROTOCOL } satisfies Hello, "*");
}

/** A rectangle on this frame's screen, as the page places it (it adds where the frame sits). */
const rectOf = (box: DOMRect | undefined): Rect | undefined => (box ? { x: box.x, y: box.y, w: box.width, h: box.height } : undefined);

async function run(root: HTMLElement, start: Start, end: FrameEnd, chrome: FrameChromeView | undefined): Promise<void> {
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
	/** When the person last pressed, scrolled or typed here: an agent's view waits while they are at it. */
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
	let restUntil: ReturnType<typeof setTimeout> | undefined;
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
	setCanvasHost({
		fileUrl: (path, rev) => `${address(inFolder(path))}${rev === undefined ? "" : `?rev=${rev}`}`,
		canWrite: () => start.canvas.role !== "view" && !start.look.readOnly,
		// A card loaded on an older pass reads its files on the current one.
		freshAddress: (url) => {
			const pass = passOf(filesBase);
			return pass ? withPass(url, pass) : url;
		},
		boardLink: (href, base) => {
			try {
				const url = new URL(href, base);
				// Against any pass the canvas has had: a card loaded before a renewal links on the pass it was loaded with.
				const at = passless(url.href);
				const folder = passless(filesBase);
				return at.startsWith(folder) ? decodeURIComponent(at.slice(folder.length).split(/[?#]/)[0]!) : undefined;
			} catch {
				return undefined;
			}
		},
		...(studio
			? {}
			: {
					documents: {
						send: (message: unknown) => void backend.post("doc", { frame: backend.frame, message }).then((answer) => answer.ok === false && console.warn(answer.error)),
						listen: (listener: (message: unknown) => void) => {
							docListeners.add(listener);
							return () => docListeners.delete(listener);
						},
						// The canvas's own `lib/`, beside its cards, as a card reads it.
						lib: address(inFolder("lib/")),
					},
				}),
		// An app opens in a tab, which the page opens, outside this sandbox; the frame only asks what it is.
		apps: {
			status: async (name: string) => {
				if (studio) return undefined;
				try {
					const response = await fetch(`${start.backend.api.replace(/\/+$/, "")}/apps/${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${backendToken()}` } });
					return response.ok ? ((await response.json()) as { title?: string; status?: string }) : undefined;
				} catch {
					return undefined;
				}
			},
			open: (name: string) => end.emit("open-app", { name }),
		},
		// So is any other tab a link opens: this sandbox may not open one.
		openLink: (href) => end.emit("open-link", { href }),
		// The composer is the page's, where the page said it is: a drag let go over it is a mention, sent as a draft.
		composer: {
			at: (x, y) => {
				const box = composerBox;
				return !!box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
			},
			mark: (on) => end.emit("refer", { over: on }),
		},
		// A card's `card.decks` calls: here, on this canvas by the harness, or the page's (`card-calls.ts`).
		cardCall: cardCalls({
			canvas: start.canvas.name,
			camera: () => untrack(camera),
			move: (next, glide) => (glide ? handle.glide(next, glide) : handle.setCamera(next)),
			focus: (targets) => focus(targets),
			viewport: () => ({ width: innerWidth, height: innerHeight }),
			reload: (path) => handle.reloadBoard(path),
			harness: (verb, args) => (studio ? Promise.resolve({ ok: false, error: `${verb}: a canvas kept by Studio takes its changes from its page here, not from a card.` }) : backend.call(verb, args)),
			page: (verb, args, card) => end.call("agent", { verb, args, card }),
		}),
	});

	const editor: Editor = createEditor({
		text: serialize(first.doc),
		base: first.base,
		dark: start.look.dark,
		mode: start.look.mode,
		// With chrome of its own, the frame's mode and pen are the editor's state, set by its toolbars.
		...(chrome ? { state: { mode: [mode, setMode], inking: () => drawing() && mode() === "browse" } } : {}),
		readOnly: start.look.readOnly,
		toolbar: start.look.toolbar,
		...(start.camera ? { camera: start.camera } : {}),
		/*
		 * Studio's view is the canvas's, kept here on this device. A harness's page keeps one per agent and
		 * canvas itself (`camera/landing.ts`) and hands it in as `start.camera`: a view kept here per canvas
		 * alone would open every agent on the last one's.
		 */
		...(studio ? { views: { scope: () => start.canvas.name, storage, key: "frame" } } : {}),
		canvasName: () => start.canvas.name,
		/*
		 * On Studio the editor keeps the drawing and its undo, as Studio's own page does, and each edit is
		 * sent as it is made (`studio-line.ts`). On a harness the harness keeps both (`document`).
		 */
		...(studio ? { onEdits: (edits: PenEdit[]) => {
			changed();
			studio.save(edits);
		} } : {}),
		...(studio ? {} : { document: {
			// Your edits, straight to the harness; one it refuses is dropped, and the drawing read again.
			send: async (ops, edit) => {
				changed();
				const answer = await backend.call("canvas.batch", [ops], edit);
				if (!answer.ok) reread();
				return answer.ok;
			},
			step: (direction, edit) => {
				void backend.call("canvas.step", [direction], edit).then((answer) => {
					if (answer.ok) return;
					if (edit) handle.refused(edit);
					console.info(answer.error);
				});
			},
		} }),
		boards: {
			list: () => places() as Board[],
			page: (path) => {
				// A document or an app item has no page to load: it is drawn in place, and only needs saying it may be.
				if (path.startsWith("item:")) return path;
				const page = pages().find((one) => one.path === path);
				return page ? `${address(path)}?rev=${page.rev}` : undefined;
			},
			picture: (path, scheme) => {
				const page = untrack(pages).find((one) => one.path === path);
				const at = path.split("/").map(encodeURIComponent).join("/");
				if (picturesAt.includes("{path}")) return picturesAt.replace("{path}", at).replace("{scheme}", scheme);
				// The whole page's picture (`whole=1`), which the server sends at the GPU's widths and compressed; without it, a gallery card's.
				return `${picturesAt}${at}?scheme=${scheme}${page ? `&v=${page.rev}` : ""}&whole=1`;
			},
			cardScripts: (path) => trust(path) !== "friend",
			// How a card measured, kept by the harness for `decks canvas fit` to report.
			onExtent: (path, extent) => void (studio ? undefined : backend.post("board-extent", { path, ...extent })),
			onOpenLink: (path, from) => {
				void end.call("open", { path, from });
				return true;
			},
			news: () => news(),
			onRead: (path) => void (studio ? undefined : backend.post("board-seen", { path })),
			// Hidden is the card taken off the drawing, as canvas.delete does, but as an edit of yours: gone at once, not when the harness answers.
			onHide: (path) => {
				if (!takeOff(path) && !studio) void backend.call("canvas.delete", [path]);
			},
		},
		// Said once the camera rests, not for every step of a pan: the page keeps it, and the view is drawn here.
		onCamera: (moved) => {
			setCamera(moved);
			clearTimeout(restUntil);
			restUntil = setTimeout(() => end.emit("camera", { camera: moved }), 250);
		},
		// What you point at, a comment, a sketch: drafts for the composer, which the page sends only on your Send.
		onSelection: (ids) => end.emit("composer", { selection: { ids: [...ids] } }),
		onSelect: (path) => end.emit("composer", { selection: { ids: [], ...(path ? { page: path } : {}) } }),
		onViewport: (viewport) => end.emit("viewport", viewport),
		onRefer: (pills) => end.emit("composer", { pills }),
		onComment: (target) => {
			if (chrome) return void setComment(target);
			const at = rectOf(target.anchor());
			end.emit("comment", { path: target.path, title: target.title, quote: target.quote, ...(target.component ? { component: target.component } : {}), ...(target.items ? { items: target.items } : {}), ...(at ? { at } : {}) });
		},
		onExport: (ids) => end.emit("export", { ids }),
		onInk: (request) => end.emit("composer", { ink: { action: request.action, ids: request.ids, canvas: request.canvas, box: request.box } }),
		inkAgent: () => busy().writer?.name,
		// Taking a card off the canvas is an edit like any other, undone the same way: no question first.
		onDeleteBoard: async (path) => {
			if (studio) return takeOff(path);
			const answer = await backend.call("canvas.delete", [path]);
			return answer.ok;
		},
	});
	const { handle } = editor;
	made = editor;
	changed();
	// For the checks: the drawing as this frame has it (a card can read it anyway, with canvas.read).
	(globalThis as { __decksFrameDrawn?: () => unknown }).__decksFrameDrawn = () => handle.drawn();
	(globalThis as { __decksFrameNews?: () => unknown }).__decksFrameNews = () => news();
	(globalThis as { __decksFrameState?: () => unknown }).__decksFrameState = () => ({ dock: dock(), agents: Object.keys(agents()).length, agent: agent(), cursor: cursor(), pages: pages().length });
	/** Take a card off the drawing by its path, as an edit of yours: what Studio does for Hide and Delete. */
	function takeOff(path: string): boolean {
		const child = ((handle.drawn().children ?? []) as unknown as Array<{ id?: string; metadata?: { path?: string } }>).find((one) => one.metadata?.path === path);
		if (!child?.id) return false;
		handle.edit([{ op: "delete", id: child.id }]);
		return true;
	}

	/** Frame these items, by id or by a card's path, as `view.focus` does. */
	const focus = (targets: string[]) => {
		const doc = handle.drawn();
		const items = placedItems(doc);
		const boxes = targets
			.map((target) => (items.find((item) => item.id === target) ?? items.find((item) => item.path && (item.path === target || target.endsWith(item.path) || item.path.endsWith(target))))?.box)
			.filter((box): box is NonNullable<typeof box> => !!box);
		if (!boxes.length) throw new Error(`Nothing on this canvas is ${targets.join(", ")}.`);
		const view = { width: innerWidth, height: innerHeight };
		handle.glide(fitInto(boxes, view, canvasBox(view)), 400);
	};

	/*
	 * The drawing as the harness changes it, from its stream: each change is said once per agent on the
	 * canvas, so one already held is passed over, and a gap reads the drawing whole again.
	 */
	let reading = false;
	const follower = drawingFollower({
		whole: (doc, base, made) => {
			handle.setDocument(serialize(doc), base, made);
			changed();
		},
		edits: (edits, base, made) => {
			const applied = handle.applyEdits(edits, base, made) !== false;
			changed();
			return applied;
		},
		reread: () => reread(),
	});
	function reread(): void {
		if (reading) return;
		reading = true;
		void backend
			.drawing()
			.then((now) => {
				follower.at(now.rev);
				handle.setDocument(serialize(now.doc), now.base);
				changed();
			})
			.catch((error: unknown) => console.warn(error))
			.finally(() => (reading = false));
	}
	follower.at(first.rev);

	/** Select a card by its path; `asPress`, as a press on it would, the card itself selected too (what the page restores as a frame starts). */
	const selectCard = (path: string | undefined, asPress = false) => {
		if (!path) return;
		const child = ((handle.drawn().children ?? []) as unknown as Array<{ id?: string; metadata?: { path?: string } }>).find((one) => one.metadata?.path === path || path.endsWith(one.metadata?.path ?? "\u0000"));
		if (child?.id) handle.select([child.id], asPress ? child.metadata!.path : undefined);
	};
	// The card the page had selected on this canvas when the frame was made again (an agent switch and back).
	selectCard(start.selected, true);
	const moveTo = (to: Camera, animate?: boolean) => (animate ? handle.glide(to, 400) : handle.setCamera(to));
	/*
	 * An agent's `decks view …` on this canvas, from the stream: carried out as the page carries it out
	 * for a canvas it holds (`stage-ops.ts`), and answered to the harness.
	 */
	const stageCall = (call: import("@decks/protocol").StageCall) => {
		if (call.op === "shot") return void shootCard(call);
		let value: unknown;
		try {
			value = runStageCall(call, {
				boards: () => untrack(pages) as Board[],
				viewport: () => ({ width: innerWidth, height: innerHeight }),
				focused: () => untrack(agent),
				stageOnScreen: () => start.canvas.name,
				setCamera: (to, options) => moveTo(to, options?.animate),
				handsOn,
				offerView: (from, to, selected, what) => setOffer({ agent: from, what, go: () => {
					moveTo(to, true);
					selectCard(selected);
					setOffer(undefined);
				} }),
				// Kept by the page with the views it parks (`camera/landing.ts`): it arrives when that chat opens.
				rememberView: (id, to, selected) => end.emit("camera", { camera: to, agent: id, ...(selected ? { selected } : {}) }),
				select: selectCard,
				reload: (path) => handle.reloadBoard(path),
				cursor: (at) => setCursor(at),
			});
		} catch (error) {
			value = { error: error instanceof Error ? error.message : String(error) };
		}
		backend.answer(call.id, value);
	};
	/*
	 * A card as the person has it now, for an agent's `decks canvas screenshot` of it (`stage.call` op
	 * `shot`): its live root written out (`card-snapshot.ts`) and drawn by the harness's Chrome, so the
	 * picture has what they typed, scrolled and drew in it. `none` when the card is not mounted here, and
	 * the harness takes its own picture from the file.
	 */
	const NONE_AFTER = 1500;
	const shootCard = async (call: import("@decks/protocol").StageCall) => {
		const path = (call.args as { path?: unknown } | undefined)?.path;
		let value: unknown;
		try {
			const shot = typeof path === "string" ? cardShot(path) : undefined;
			if (typeof path !== "string" || !shot) {
				/*
				 * Said a moment later: the first answer is the one taken, and another tab showing this canvas
				 * may have the card awake.
				 */
				await new Promise((done) => setTimeout(done, NONE_AFTER));
				value = { how: "none", why: "the card is not awake on the person's canvas" };
			} else {
				const drawn = await backend.snapshot(path, shot);
				value = "data" in drawn ? { how: "snapshot", ...drawn } : { how: "none", why: drawn.why };
			}
		} catch (error) {
			value = { how: "none", why: error instanceof Error ? error.message : String(error) };
		}
		backend.answer(call.id, value);
	};
	// On Studio: the drawing as Studio's revisions change it, kept in step as Studio's own page keeps it.
	if (studio)
		studio.follow(
			(doc) => {
				handle.setDocument(serialize(doc));
				changed();
			},
			() => handle.document(),
			first.rev,
		);
	else backend.follow((message) => {
		if (message.type === "stage.call") return stageCall(message.call);
		if (message.type.startsWith("doc.")) return hearDoc(message);
		// A card's file changed: its record taken, its place kept, as the drawing says it.
		if (message.type === "board.changed") {
			if (message.removed || !message.board) return;
			const record = message.board;
			setPages(untrack(pages).map((page) => (page.path === record.path ? { ...record, x: page.x, y: page.y, w: page.w, h: page.h, trust: page.trust } : page)));
			return;
		}
		follower.hear(message);
	});
	end.on("reload", (data) => handle.reloadBoard(data.path));
	end.on("look", (data) => {
		if (data.agent !== undefined && data.agent !== untrack(agent)) setAgent(data.agent);
		if (data.insets) useInsets(data.insets);
		if (data.agents) setAgents(data.agents);
		if (data.dock !== undefined) {
			setDock(data.dock);
			reflect();
		}
		if (data.composer !== undefined) composerBox = data.composer;
		if (data.dark !== undefined) {
			document.documentElement.dataset.colorScheme = data.dark ? "dark" : "light";
			setDark(data.dark);
			handle.setDark(data.dark);
		}
		if (data.mode !== undefined) handle.setMode(data.mode);
	});
	end.on("tool", (data) => {
		if (data.tool) handle.setTool(data.tool);
		if (data.ink) setDrawing(data.ink.on);
	});
	end.on("camera", (data) => (data.glide ? handle.glide(data.camera, data.glide) : handle.setCamera(data.camera)));
	end.on("fit", () => handle.fit());
	end.on("select", (data) => (data.page ? selectCard(data.page) : handle.select(data.ids)));
	end.on("step", (data) => (data.direction === "undo" ? handle.undo() : handle.redo()));
	end.on("busy", (data) => setBusy({ ...untrack(busy), ...data }));
	end.answer("edit", (data) => {
		handle.edit(data.ops);
		return true as const;
	});
	end.answer("read", () => handle.drawn());

	/*
	 * Files dropped from outside the browser: never opened in place (a dropped file's default is to
	 * replace the page with it), but handed to the page, which uploads them into this canvas's folder
	 * and places them where they landed, as it does a drop of its own.
	 */
	const carries = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
	addEventListener("dragover", (event) => {
		if (!carries(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
	});
	addEventListener("drop", (event) => {
		if (!carries(event)) return;
		event.preventDefault();
		const at = { x: event.clientX, y: event.clientY };
		// Over a card they go into it, between its blocks where they land: only the stage here knows what is under the point.
		const card = (globalThis as { __decksCardAt?: (x: number, y: number) => CardSlot | undefined }).__decksCardAt?.(at.x, at.y);
		const files = Array.from(event.dataTransfer?.files ?? []);
		void Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: await file.arrayBuffer() }))).then((read) =>
			end.call("upload", { files: read, at, ...(card ? { card } : {}) }, read.map((one) => one.bytes)).catch((error: unknown) => console.warn(error)),
		);
	});

	/*
	 * A shortcut the canvas did not take goes to the page, so the app's own keys work wherever the focus
	 * is: only one with a modifier, since a bare letter typed here is the canvas's or a card's.
	 */
	addEventListener("keydown", (event) => {
		if (event.defaultPrevented || !(event.metaKey || event.ctrlKey || event.altKey)) return;
		end.emit("keys", { key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
	});

	/*
	 * The agent's cursor, over the canvas on a layer that follows the camera: the card's place plus the
	 * point on it, drifting from one place to the next and one size on the screen at any zoom.
	 */
	const cursorAt = () => {
		const at = cursor();
		const card = at ? pages().find((page) => page.path === at.path) : undefined;
		return at && card ? { x: card.x + at.x, y: card.y + at.y, label: at.label, color: at.color } : null;
	};
	const cursors = () => (
		<div class="frame-cursors" style={{ position: "absolute", inset: "0", overflow: "hidden", "pointer-events": "none", "z-index": "5" }}>
			<div style={{ position: "absolute", left: "0", top: "0", "transform-origin": "0 0", transform: `translate(${innerWidth / 2}px, ${innerHeight / 2}px) scale(${camera().zoom}) translate(${-camera().x}px, ${-camera().y}px)` }}>
				<AgentCursor cursor={cursorAt()} zoom={camera().zoom} />
			</div>
		</div>
	);

	if (chrome) {
		// The app's own chrome, here beside the canvas: its tools are this frame's, and nothing of them crosses.
		// Made inside the render's root, so its effects and its parts' onMount run (a float's grip, the pen's state).
		const view = () => chrome({
			handle,
			revision,
			offer,
			dismissOffer: () => setOffer(undefined),
			camera,
			mode,
			setMode: (next) => {
				if (next === "edit" && !canWrite()) return;
				setMode(next);
			},
			canWrite,
			dark,
			comment,
			setComment,
			compose: (part) => end.emit("composer", part),
			exportPicture: (ids) => end.emit("export", { ids }),
			narrow,
			dock,
			panel: (name) => end.emit("panel", { name }),
			storage,
			canvas: start.canvas.name,
		});
		render(() => (
			<>
				{editor.surface()}
				{cursors()}
				{view()}
			</>
		), root);
		return;
	}

	/*
	 * No chrome of its own (Studio, until it brings one): the editor's own bars, or none. Nothing of the
	 * tools crosses the frame line: an app's chrome lives in the frame beside the canvas.
	 */
	render(() => (
		<>
			{start.look.toolbar ? editor.root() : editor.surface()}
			{cursors()}
		</>
	), root);
}

/** The cards and boards a drawing places, as the frame lists them, for a canvas kept where cards have no records of their own (Studio). */
function cardsOf(doc: import("@decks/pen").PenDocument, trust: (path: string) => Page["trust"]): Page[] {
	return pageItems(doc).map((item) => ({ path: item.path!, title: item.name ?? item.path!.split("/").slice(-2).join("/"), rev: 0, ...item.box, inContext: [], ...(item.type === "decks.card" ? { card: true as const } : {}), trust: trust(item.path!) }));
}
