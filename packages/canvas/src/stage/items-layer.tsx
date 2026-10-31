import type { Page, Camera } from "@decks/protocol";
import { For, Show, createEffect, createMemo, createSelector, createSignal, on, onCleanup, untrack, type Accessor, type Component } from "solid-js";
import { boxOf, INTERACT_ZOOM, toScreen, toWorld, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { canvasHost, openInTab } from "../host.ts";
import MediaPlayer from "../items/MediaPlayer.tsx";
import { chooseLive, NO_LIVE_CARDS, sameLive, type LiveCards } from "../items/live-cards.ts";
import type { ItemSlotProps } from "../items/item-slot.tsx";
import type { SceneCard } from "../render/types.ts";
import { docIndex } from "../model/doc-index.ts";
import { BoxIndex } from "../render/spatial.ts";
import { CARDS, DEVICE } from "../render/device.ts";
import { drawing } from "../edit/ink.ts";
import { scheme } from "../lib/theme.ts";
import { mediaOf, type PenNode } from "@decks/pen";
import { isLiveFile } from "../model/card-frame.ts";
import type { StageEngine } from "../render/engine.ts";
import type { StageEditor } from "../edit/index.ts";
import type { StageProps } from "./Stage.tsx";

/** What the items layer needs of the stage around it. */
export type ItemsLayerDeps = {
	props: StageProps;
	/** The host's slot for one placed item (`props.frame`, read once). */
	Frame: Component<ItemSlotProps>;
	/** The stage element, set once it is mounted. */
	element: () => HTMLDivElement | undefined;
	ctl: CameraController;
	view: () => Viewport;
	editor: StageEditor;
	penLayer: StageEngine;
	/** Counted up each time the engine lays the drawing out. */
	penDrawn: Accessor<number>;
	/** A writer's colour as the sheet can paint it (`Stage.tsx`). */
	resolveColour: (colour: string) => string;
	/** Fit boxes into the canvas column (`Stage.tsx`, `frame`). */
	frame: (boxes: Array<{ x: number; y: number; w: number; h: number }>) => Camera;
	/** What an item's slot asks of the stage's fingers (`input.ts`). */
	gestures: ItemSlotProps["gestures"];
};

/**
 * The placed items: cards, documents, apps and boards, which of them are near, have a slot and are
 * awake, how the sheet draws each, their sizes easing, the SVGs shown live, and the one film or sound
 * playing. Made inside `Stage`, after the editor, which it reads.
 */
export function createItemsLayer(deps: ItemsLayerDeps) {
	const { props, Frame, ctl, view, editor, penLayer, penDrawn, resolveColour, frame, gestures } = deps;
	const { moving, scaling, gliding, panning, push: pushCamera } = ctl;
	/** How many cards are awake at once besides the selected one, and how many let go are kept: this device's (`render/device.ts`). */
	const CARD_BUDGET = CARDS[DEVICE];
	/**
	 * A pinch on pictures: while the scale moves, the awake cards are hidden and the sheet draws each as
	 * its picture, so the page stretches one sheet and lays out, paints and layers no card.
	 *
	 * Off unless `?card-pictures=1` is in the page's address. Meant for an iPad or a phone, and measured
	 * there in a simulated iPad (`scripts/card-zoom.mjs`, Playwright's iPad Pro 11, CPU 4×, 3 cards awake):
	 * it changed nothing a pinch costs. Late frames in WebKit 2.0 and 2.0 per pinch off against 2.0 and
	 * 0.2 on, noise either way; Chromium's paint, raster and layer work 4, 15 and 7 ms per pinch off, 5,
	 * 14 and 7 on; the main thread's 71–98 ms off, 84–117 on, since each pinch tells the engine twice
	 * that its cards changed. With at most three cards awake and each on a layer the compositor stretches,
	 * there is little left for it to save. Kept for a measure on the real device.
	 */
	const PINCH_ON_PICTURES = typeof location !== "undefined" && new URLSearchParams(location.search).get("card-pictures") === "1";
	/** The awake cards are hidden: from the first step of a scale until it rests (`canvas.css`, `data-card-pictures`). */
	const cardsHidden = createMemo(() => PINCH_ON_PICTURES && scaling());
	/**
	 * The sheet draws the awake cards as pictures rather than holes: from the first step of a scale, and
	 * two frames past its rest, so a card shown again has painted under its picture before the hole
	 * opens over it, and no frame shows it blank.
	 */
	const [cardPictures, setCardPictures] = createSignal(false);
	{
		let raf: number | undefined;
		createEffect(
			on(cardsHidden, (hidden) => {
				if (raf !== undefined) cancelAnimationFrame(raf);
				raf = undefined;
				if (hidden) return setCardPictures(true);
				if (!untrack(cardPictures)) return;
				raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => ((raf = undefined), setCardPictures(false)))));
			}),
		);
		onCleanup(() => raf !== undefined && cancelAnimationFrame(raf));
	}

	/**
	 * How many awake items may be put on layers of their own while the scale moves before it stops being a saving.
	 *
	 * A layer is a picture the compositor keeps and can stretch without waking the main
	 * thread, and that trade is a good one until there are so many that compositing them
	 * costs more than drawing them. It reverses, and it was measured rather than guessed —
	 * 1400×900 at 4× CPU throttle, milliseconds of work per finger movement while pinching:
	 *
	 *     12 documents in view   56 on layers · 134 without
	 *     40 documents in view  126 on layers · 181 without
	 *    120 documents in view  700 on layers · 523 without   ← the trade has reversed
	 *
	 * Those documents were boards' iframes, which the canvas no longer runs. What goes on a layer now
	 * is an awake card's root, a document's editor or an app's window (`canvas.css`, `data-scaling`),
	 * a few elements each, and only those are counted: a board is its picture on the sheet and has no
	 * layer to make. Measured on a canvas of 65 cards, all on screen below 25%, a ctrl-wheel zoom
	 * across 2%–400% in headed Chrome: with the cards over the old 48 and so off layers, Chrome drew
	 * every card again at every step and a third of the frames were late (97 of 300 over 16.7 ms,
	 * p95 35 ms); on layers, 0–6 of 495, and a frame mid-zoom as sharp as at rest. 128 is twice what
	 * was measured.
	 */
	const LAYER_BUDGET = 128;

	/**
	 * Cards whose surfaces are showing, by how many of their slots say so: the sheet is a hole over each
	 * of them, and the card's picture everywhere else. A count and not a set, so a slot that goes as
	 * another comes for the same card never leaves it wrongly unmarked.
	 */
	const [liveCards, setLiveCards] = createSignal<ReadonlyMap<string, number>>(new Map());
	const markLive = (path: string, on: boolean) =>
		setLiveCards((was) => {
			const next = new Map(was);
			const count = (next.get(path) ?? 0) + (on ? 1 : -1);
			if (count > 0) next.set(path, count);
			else next.delete(path);
			return next;
		});

	/** The file items whose holes the sheet is showing, as of the frame on screen (`liveFiles`): their elements show then and not before. */
	const [holesShown, setHolesShown] = createSignal<ReadonlySet<string>>(new Set());
	let holesAsked: { ids: ReadonlySet<string>; mark: number } | undefined;
	/**
	 * The one film or sound playing, if any.
	 *
	 * **One at a time, on purpose.** A film at rest is paint and costs a picture; a film playing is
	 * a decoder, and eight of those are already the edge of a frame's budget on a machine with no
	 * graphics card — forty-eight cost a thousand times what forty-eight stills cost. So starting
	 * one stops the last, and the canvas never holds more than a single player.
	 */
	const [playing, setPlaying] = createSignal<{ id: string; kind: "video" | "audio"; file: string } | undefined>();
	/** The playing element, for a click on the item to pause and resume. */
	let playingElement: HTMLMediaElement | undefined;
	/** When the one playing was started, so the second press of a double-click does not pause it at once. */
	let playingSince = 0;
	/** Where each film or sound was left, so pressing it again goes on from there. */
	const playedTo = new Map<string, number>();
	/**
	 * A press on a film or a sound: it plays, or the one playing pauses or goes on. The press
	 * selects it as well, as a press on any item does, so it can still be moved and styled.
	 */
	const toggleMedia = (id: string, media: { kind: "video" | "audio"; file: string }) => {
		const now = playing();
		if (now?.id === id && playingElement) {
			if (playingElement.paused) void playingElement.play().catch(() => {});
			else if (performance.now() - playingSince > 400) playingElement.pause();
			return;
		}
		playingSince = performance.now();
		setPlaying({ id, kind: media.kind, file: media.file });
	};

	/**
	 * Each board as the sheet draws it: where it is, and whether it is a hole or a picture.
	 *
	 * A dragged board is where it was picked up, here: the sheet draws its picture once on the carried
	 * layer and the page slides that with the pointer (`carry` below), so a move redraws nothing.
	 */
	createEffect(() => {
		const live = liveCards();
		const look = scheme();
		const pictures = cardPictures();
		/*
		 * An awake card being sized is its surface, drawn over the sheet at the new box, so the sheet
		 * keeps it where it was until the file has the size: each step otherwise painted the whole
		 * sheet again, about 10 ms of the worker's time, to move a hole nobody can see. A board
		 * shown as a picture is drawn by the sheet, and one an arrow ends on is followed by the
		 * arrow, so those two are still sent at every step.
		 */
		const resize = editor.sheetResize((path) => live.has(path));
		const sendCards = (cards: SceneCard[]) => {
			/*
			 * The engine draws the cards' pictures, and hears of every card: an arrow follows the card it
			 * ends on, and a drawn item over a card gets the click shape that lets it be pressed there.
			 */
			penLayer.setCards(cards);
		};
		sendCards(
			props.boards
				.map((board) => {
					const sized = resize?.path === board.path ? resize : undefined;
					return {
						path: board.path,
						x: sized?.x ?? board.x,
						y: sized?.y ?? board.y,
						w: sized?.w ?? board.w,
						h: sized?.h ?? board.h,
						// A document or an app item draws itself at any zoom and has no picture (`item-surfaces.tsx`).
						live: board.item !== undefined || live.has(board.path),
						// An awake card's picture is kept ready, for a zoom on WebKit or a drag to show at once.
						...(live.has(board.path) ? { ready: true } : {}),
						// A card not live is its picture.
						picture: board.item ? "" : props.shots().picture(board, look),
						...(props.news?.[board.path] ? { news: resolveColour(props.news[board.path]!), glow: !isLive(board.path) } : {}),
					};
				}),
		);
	});
	// The boards a drag carries go with it on the engine's carried layer (`editor/dom/controller.ts`).
	/** The items whose carried picture is on screen: their slots hide where they were picked up (`item-slot.tsx`). */
	const [carriedPages, setCarriedPages] = createSignal<ReadonlySet<string>>(new Set());
	penLayer.carrying = setCarriedPages;
	/*
	 * An item a drag carries while the sheet draws it as its picture (not awake): its picture goes with the drag, so its slot waits unseen too, or its
	 * title stayed on screen where the drag began (a finger on a phone, `item-slot.tsx`, `fingerDrag`).
	 */
	const draggedAsPicture = createMemo<ReadonlySet<string>>(() => {
		const paths = [...(editor.pageDrag()?.paths ?? []), ...(editor.ownDrag() ? [editor.ownDrag()!.path] : [])];
		const live = liveCards();
		return new Set(paths.filter((path) => !live.has(path)));
	});

	/** A file shown live (`liveFiles`): which item, what it is, and its deck path. */
	type LiveFile = { id: string; file: string; name: string };
	/** The most file items alive at once, the nearest the middle of the screen: a frame each is a page's worth of work. */
	const LIVE_FILES = 12;
	/**
	 * For the browser checks: every card (and old board) on the canvas and where it is on screen, node or
	 * picture (`rendered`).
	 */
	const cardsOnScreen = () => {
		const element = deps.element();
		if (!element) return [];
		const r = element.getBoundingClientRect();
		const nodes = renderedPaths();
		return props.boards
			.map((board) => {
				const a = toScreen(ctl.now(), view(), { x: board.x, y: board.y });
				const b = toScreen(ctl.now(), view(), { x: board.x + board.w, y: board.y + board.h });
				return { path: board.path, node: nodes.has(board.path), rect: new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y) };
			});
	};
	(globalThis as { __decksCards?: typeof cardsOnScreen }).__decksCards = cardsOnScreen;

	/**
	 * Where the player sits, while something is playing: the item's own drawn box.
	 *
	 * It plays on while you work elsewhere on the canvas: letting go of the item, panning or zooming
	 * out does not stop it, because one decoder costs nothing a frame notices and a sound you are
	 * listening to should not end because you clicked away. It goes when it ends, when another is
	 * started, or when the item is gone from the file.
	 */
	const playingBox = createMemo(() => {
		penDrawn();
		const now = playing();
		if (!now) return undefined;
		const node = penLayer.placed.get(now.id)?.node;
		const box = penLayer.bounds.get(now.id);
		const media = mediaOf(node);
		if (!node || !box || !media) return undefined;
		const drag = editor.itemShift(now.id);
		return {
			...now,
			name: String(node.name ?? media.file.split("/").pop() ?? ""),
			...(media.seconds === undefined ? {} : { seconds: media.seconds }),
			...(media.peaks ? { peaks: media.peaks } : {}),
			radius: typeof node.cornerRadius === "number" ? node.cornerRadius : 8,
			x: box.x + drag.dx,
			y: box.y + drag.dy,
			w: box.w,
			h: box.h,
		};
	});
	// What stopped it above is still holding the file open: let it go, so nothing decodes off screen.
	createEffect(() => {
		if (playing() && !playingBox()) setPlaying(undefined);
	});

	/** The camera boards and their bookkeeping see: the settled one (`camera/controller.ts`). */
	const pageCamera = ctl.settled;
	/**
	 * The boards and cards within a window of the screen, by path, from the R-tree, as of the settled
	 * camera. A new set only when one enters or leaves it, so what reads it through `isNear` hears only
	 * about its own item, and a pan that keeps the same ones near reaches none of them.
	 */
	const nearPaths = createMemo<ReadonlySet<string>>(
		() => {
			if (view().width === 0) return new Set();
			const boards = props.boards;
			return new Set(pageIndex().search(reach()).map((at) => boards[at]!.path));
		},
		new Set(),
		{ equals: (a, b) => a.size === b.size && [...a].every((path) => b.has(path)) },
	);
	/** Whether a board is in `nearPaths`: each board is told only when its own answer changes. */
	const isNear = createSelector(nearPaths, (path: string, near) => near.has(path));
	/** On screen, or within a window of it: the R-tree's answer, not each board's own arithmetic. */
	const isVisible = (board: Page) => isNear(board.path);

	/** At or above this device's live zoom (`INTERACT_ZOOM`): items near the window have their slots, title and all. */
	const liveNow = createMemo(() => ctl.zoom() >= INTERACT_ZOOM);
	const pageIndex = createMemo(() => new BoxIndex(props.boards));
	const pageSlot = createMemo(() => new Map(props.boards.map((board, i) => [board.path, i])));
	/** The stage rectangle `isVisible` answers for: the window, and one window more on each side. */
	const reach = () => {
		const v = view();
		const cam = pageCamera();
		const corner = toWorld(cam, v, { x: -v.width, y: -v.height });
		return { x: corner.x, y: corner.y, w: (3 * v.width) / cam.zoom, h: (3 * v.height) / cam.zoom };
	};
	/*
	 * Which cards are awake (`items/live-cards.ts`): chosen from the camera at rest, so nothing mounts or
	 * unmounts while a pinch, a pan or a glide moves it; the nearest the middle of the screen, cut to this
	 * device's budget, none below `CARD_LIVE_ZOOM`, and the selected card at any zoom. Every other card
	 * sleeps as its picture. A board is never awake: the sheet draws it as its picture, and the canvas
	 * runs no board's page. A document or an app item is always awake (`item-surfaces.tsx`).
	 */
	const cardChoice = createMemo<LiveCards>((was) => {
		const v = view();
		if (v.width === 0) return was;
		const next = chooseLive({ index: pageIndex(), items: props.boards, rest: ctl.rest(), view: v, selected: props.selected, budget: CARD_BUDGET, was });
		return sameLive(was, next) ? was : next;
	}, NO_LIVE_CARDS);
	/** For the browser checks and `scripts/card-zoom.mjs`: the cards chosen awake and kept asleep. */
	(globalThis as { __decksLiveCards?: () => LiveCards }).__decksLiveCards = () => untrack(cardChoice);
	const livePaths = createMemo<ReadonlySet<string>>(() => new Set(cardChoice().live), new Set(), {
		equals: (a, b) => a.size === b.size && [...a].every((path) => b.has(path)),
	});
	/** Cards let go lately and kept with their roots, asleep (`cardChoice().kept`): waking one again is instant. */
	const keptPaths = createMemo<ReadonlySet<string>>(() => new Set(cardChoice().kept), new Set(), {
		equals: (a, b) => a.size === b.size && [...a].every((path) => b.has(path)),
	});
	const isKept = createSelector(keptPaths, (path: string, paths) => paths.has(path));
	/** Whether a card is awake: each slot is told only when its own answer changes. */
	const isLive = createSelector(livePaths, (path: string, paths) => paths.has(path));
	/**
	 * The items that have a slot on the page at all: those near the window at the live zoom, found
	 * through a spatial index (`spatial.ts`) rather than by asking every one, and any that must stay
	 * whatever the camera does: an awake card, the selected item, one being dragged or resized, and
	 * every document and app item.
	 *
	 * Below the live zoom a board or a sleeping card is its picture on the sheet and nothing else, so it
	 * has no node: 400 of them cost a pan step 10 ms of the page's time, and each camera step reached
	 * every one. The stage finds the one under a press itself (`editor/dom/pointer.ts`, `pictureUnder`).
	 */
	const rendered = createMemo<readonly Page[]>((was) => {
		const boards = props.boards;
		if (view().width === 0) return was ?? [];
		/*
		 * Only at rest: a pan or a zoom keeps the nodes it started with, and the items it brings in are
		 * drawn by the sheet until it stops. Making a zoom's new nodes mid-pinch, title bars and all,
		 * held camera steps for up to 52 ms on an iPad mini.
		 */
		const moved = was !== undefined && (moving() || panning() || scaling() || gliding());
		const found = new Set(
			moved
				? was.flatMap((board) => {
						const at = pageSlot().get(board.path);
						return at === undefined ? [] : [at];
					})
				: liveNow()
					? pageIndex().search(reach())
					: [],
		);
		const keep = (path: string | undefined) => {
			const at = path === undefined ? undefined : pageSlot().get(path);
			if (at !== undefined) found.add(at);
		};
		for (const path of liveCards().keys()) keep(path);
		keep(props.selected);
		for (const path of livePaths()) keep(path);
		for (const path of keptPaths()) keep(path);
		for (const path of editor.heldPages()) keep(path);
		// A document or an app item has no picture: it is drawn at any zoom (`item-surfaces.tsx`).
		for (const [at, board] of boards.entries()) if (board.item) found.add(at);
		const next = [...found]
			.sort((a, b) => a - b)
			.map((at) => boards[at]!);
		// The same boards as last frame, which is nearly every frame of a pan: the same array, so nothing downstream runs.
		return was && was.length === next.length && next.every((board, i) => board === was[i]) ? was : next;
	});

	/** `rendered`, as a set to look a board up in. */
	const slotPaths = createMemo(() => new Set(rendered().map((board) => board.path)));
	/** Whether a board has a node: each board's slot is told only when its own answer changes. */
	const isRendered = createSelector(slotPaths, (path: string, paths) => paths.has(path));
	/**
	 * The items whose node takes a press: those in `rendered` but a kept card asleep, which is its picture
	 * on the sheet as any sleeping card is, so the stage finds it under a press itself (`pictureUnder`).
	 */
	const renderedPaths = createMemo<ReadonlySet<string>>(() => {
		const kept = keptPaths();
		return kept.size === 0 ? slotPaths() : new Set([...slotPaths()].filter((path) => !kept.has(path)));
	});
	/** The awake items may go on layers while the scale moves: few enough of them near the window. Worked out once per change, not per read. */
	const layered = createMemo(() => scaling() && rendered().filter((board) => ((board.card && !cardsHidden()) || board.item) && isVisible(board)).length <= LAYER_BUDGET);

	/** The camera as of its last rest. */
	const restCamera = createMemo<Camera>((was) => (was !== undefined && (moving() || scaling() || panning() || gliding()) ? was : props.camera));

	/*
	 * SVGs shown live on the canvas (`liveFileItem`), each as an image. Each is an element in the boards' layer, under the sheet, which draws a hole
	 * where it is (`paint.ts`, `holes`): so it moves with the boards in the same frame, and what is drawn
	 * over it stays over it. As a board's page: only from the live zoom, only near the screen as of the
	 * camera's last rest, the nearest few; while a zoom moves, or the item is being moved or sized, the
	 * sheet draws its still over it instead, and the element waits underneath, still loaded.
	 */
	const liveFiles = createMemo(
		() => {
			penDrawn();
			const cam = restCamera();
			if (cam.zoom < INTERACT_ZOOM || !props.pen) return [] as LiveFile[];
			const v = view();
			const mx = v.width * 0.25;
			const my = v.height * 0.25;
			const near: Array<LiveFile & { d: number }> = [];
			for (const placed of penLayer.placed.values()) {
				const node = placed.node;
				if (!isLiveFile(node) || node.metadata?.kind !== "svg" || typeof node.metadata.file !== "string") continue;
				const box = penLayer.bounds.get(node.id) ?? placed.box;
				const a = toScreen(cam, v, { x: box.x, y: box.y });
				const b = toScreen(cam, v, { x: box.x + box.w, y: box.y + box.h });
				if (b.x < -mx || a.x > v.width + mx || b.y < -my || a.y > v.height + my) continue;
				near.push({ id: node.id, file: node.metadata.file, name: String(node.name ?? node.metadata.file.split("/").pop()), d: Math.hypot((a.x + b.x - v.width) / 2, (a.y + b.y - v.height) / 2) });
			}
			return near.sort((p, q) => p.d - q.d).slice(0, LIVE_FILES).map(({ d: _d, ...file }) => file);
		},
		[],
		{ equals: (a, b) => a.length === b.length && a.every((file, k) => file.id === b[k]!.id && file.file === b[k]!.file && file.name === b[k]!.name) },
	);
	/**
	 * The items the sheet draws as holes: the live ones, and none while a zoom moves. A moved or sized one
	 * stays live: its element goes with the drag as the sheet's hole does (`liveBox`), so an animation being
	 * carried keeps playing, not its still.
	 */
	const fileHoles = createMemo(
		() => {
			if (scaling()) return new Set<string>();
			return new Set(liveFiles().map((file) => file.id));
		},
		new Set<string>(),
		{ equals: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)) },
	);
	createEffect(
		on(fileHoles, (ids) => {
			penLayer.holes(ids);
			holesAsked = { ids, mark: penLayer.mark() };
		}),
	);
	/** Where each live file is on the stage, from the layout the sheet drew. */
	const liveBox = (id: string) => {
		penDrawn();
		const placed = penLayer.placed.get(id);
		const resized = editor.itemResize(id);
		if (resized) return { x: resized.x, y: resized.y, w: resized.w, h: resized.h, radius: Number(placed?.node.cornerRadius ?? 0) || 0 };
		const box = penLayer.bounds.get(id) ?? placed?.box;
		if (!box) return undefined;
		// Carried with the drag, from the frame the sheet carries it in (`shownDrag`).
		const drag = editor.itemShift(id);
		return { x: box.x + drag.dx, y: box.y + drag.dy, w: box.w, h: box.h, radius: Number(placed?.node.cornerRadius ?? 0) || 0 };
	};
	/** A double-click on a live SVG opens it in a tab. */
	const openLiveFile = (id: string): boolean => {
		const index = props.pen ? docIndex(props.pen.doc) : undefined;
		let node: PenNode | undefined;
		for (let at = index?.get(id); at && !node; at = at.parent ? index?.get(at.parent.id) : undefined) if (isLiveFile(at.node)) node = at.node;
		if (!node || typeof node.metadata?.file !== "string") return false;
		editor.select([node.id]);
		openInTab(canvasHost().fileUrl(node.metadata.file));
		return true;
	};

	/** One placed item's slot: the host's, told where it is and what it may do. */
	const pageNode = (board: Page) => (
		<Frame
			board={board}
			zoom={ctl.zoom()}
			mounted={board.item !== undefined || isLive(board.path) || isKept(board.path)}
			asleep={isKept(board.path)}
			visible={isNear(board.path)}
			onLive={(on: boolean) => markLive(board.path, on)}
			carried={carriedPages().has(board.path) || draggedAsPicture().has(board.path)}
			selected={props.selected === board.path}
			gestures={gestures}
			{...(props.onOpenPage ? { onOpenPage: props.onOpenPage } : {})}
			view={editor.pageView(board.path)}
			{...(props.onExtent ? { onExtent: (extent) => props.onExtent?.(board.path, extent) } : {})}
			onMove={(x, y) => props.onMove(board.path, x, y)}
			onOpen={() => pushCamera(frame([boxOf(board)]))}
			{...(props.onComment
				? {
						// Words selected in a card while browsing: a comment on them, as on a board's page before.
						onWords: (words: { quote: string; component?: string; anchor: () => DOMRect | undefined }) => {
							if (props.mode !== "browse" || drawing()) return;
							props.onComment?.({ path: board.path, title: board.title, quote: words.quote, ...(words.component ? { component: words.component } : {}), anchor: words.anchor });
						},
					}
				: {})}
		/>
	);

	/*
	 * Boards whose size just changed from outside a drag (`decks.canvas.fit`, an agent's `decks.canvas.update`, a write that
	 * measured taller): for `SIZE_MS` their box, title bar and outline ease to the new size rather
	 * than jump (`canvas.css`, `[data-sizing]`). A size the person drags is never eased: it follows
	 * the pointer, and the board takes it while `pageResize` still holds it, so nothing changes here.
	 */
	const SIZE_MS = 280;
	const [sizingPaths, setSizingPaths] = createSignal<ReadonlySet<string>>(new Set());
	const lastSizes = new Map<string, { size: string; since: number }>();
	/** A board that arrived this recently is still taking its measured height: it is not eased. */
	const SETTLE_MS = 2500;
	const sizingTimers = new Map<string, ReturnType<typeof setTimeout>>();
	createEffect(() => {
		const held = editor.resizingPage();
		const grew: string[] = [];
		for (const board of props.boards) {
			const size = `${board.w}x${board.h}`;
			const before = lastSizes.get(board.path);
			const now = performance.now();
			lastSizes.set(board.path, { size, since: before?.since ?? now });
			if (before !== undefined && before.size !== size && board.path !== held && now - before.since > SETTLE_MS) grew.push(board.path);
		}
		if (grew.length === 0) return;
		untrack(() => setSizingPaths(new Set([...sizingPaths(), ...grew])));
		for (const path of grew) {
			clearTimeout(sizingTimers.get(path));
			sizingTimers.set(
				path,
				setTimeout(() => {
					sizingTimers.delete(path);
					const next = new Set(sizingPaths());
					next.delete(path);
					setSizingPaths(next);
				}, SIZE_MS + 60),
			);
		}
	});
	onCleanup(() => {
		for (const timer of sizingTimers.values()) clearTimeout(timer);
	});

	/** A frame on screen shows the holes asked for: their files' elements show from then (`liveFiles`). */
	const presented = () => {
		if (holesAsked && penLayer.shows(holesAsked.mark)) {
			setHolesShown(holesAsked.ids);
			holesAsked = undefined;
		}
	};

	/** Every board's slot, in the world. */
	const slots = () => (
		<>

				{/*
				 * A place for every board on the canvas, in file order, filled while it is within reach.
				 *
				 * A list of only the boards in reach was reconciled as boards came and went, and the
				 * reconciler kept the order by moving nodes: **moving an iframe reloads its page**, and
				 * zooming out from 60 to 40% reloaded six loaded boards of twenty-three. Even a list that
				 * only gains boards in the middle is diffed with moves. So each board has a slot of its own
				 * that never moves (`display: contents`, so it lays nothing out), filled while the board
				 * is within reach: only a slot's inside changes, and boards still stack in file order.
				 */}
				<For each={props.boards} fallback={null}>
					{(board) => (
						<div class="card-slot">
							<Show when={isRendered(board.path)}>{pageNode(board)}</Show>
						</div>
					)}
				</For>
		</>
	);
	/** The live files' elements, after the slots. */
	const fileNodes = () => (
		<>

				{/* Files shown live, under the sheet's holes for them (`liveFiles`): after the boards, so over them, as the drawing is. */}
				<For each={liveFiles()}>
					{(file) => {
						const box = () => liveBox(file.id);
						const shown = () => holesShown().has(file.id);
						return (
							<Show when={box()}>
								{(at) => (
									<div
										class="file-live"
										data-live-file={file.id}
										style={{ left: `${at().x}px`, top: `${at().y}px`, width: `${at().w}px`, height: `${at().h}px`, "border-radius": `${at().radius}px`, visibility: shown() ? "visible" : "hidden" }}
									>
										<img src={canvasHost().fileUrl(file.file)} alt={file.name} draggable={false} />
									</div>
								)}
							</Show>
						);
					}}
				</For>
		</>
	);
	/** The one player, over the item it belongs to (inside the overlay layer). */
	const player = () => (
		<>

					{/*
					 * The one player, laid over the item it belongs to.
					 *
					 * A real element because nothing else can play: the canvas draws in a worker and there
					 * is no browser in there. It is the same bargain a board makes — a picture until you
					 * are close and have asked — and it is one element, never a wall of them.
					 */}
					<Show when={playingBox()?.id} keyed>
						{(id) => {
							const now = () => playingBox()!;
							const first = now();
							return (
								<Show when={playingBox()}>
									<MediaPlayer
										kind={first.kind}
										src={canvasHost().fileUrl(first.file)}
										name={first.name}
										{...(first.seconds === undefined ? {} : { seconds: first.seconds })}
										{...(first.peaks ? { peaks: first.peaks } : {})}
										box={{ x: now().x, y: now().y, w: now().w, h: now().h }}
										radius={now().radius}
										scheme={scheme()}
										{...(playedTo.get(id) ? { from: playedTo.get(id)! } : {})}
										ref={(element) => (playingElement = element)}
										onEnded={() => {
											playedTo.delete(id);
											setPlaying(undefined);
										}}
										onLeave={(at) => {
											playingElement = undefined;
											if (at > 0.5) playedTo.set(id, at);
										}}
									/>
								</Show>
							);
						}}
					</Show>
		</>
	);

	return { isLive, renderedPaths, pageIndex, liveNow, layered, cardsHidden, sizingPaths, toggleMedia, openLiveFile, presented, slots, fileNodes, player };
}
