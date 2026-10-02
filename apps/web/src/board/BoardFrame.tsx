import { AgentCursor } from "../canvas/AgentCursor.tsx";
import { touchedCanvas } from "../camera/touched.ts";
import type { Board, Camera, ChatItem, WebStatus } from "@decks/protocol";
import { SourceEditor } from "./SourceEditor.tsx";
import { createEffect, createMemo, createSignal, For, Index, Match, onCleanup, Show, Switch, on, untrack } from "solid-js";
import { unwrap } from "solid-js/store";
import { boardUrl, deckFileUrl } from "../lib/api.ts";
import { Portal } from "solid-js/web";
import { Icon } from "../ui/icons.tsx";
import ExternalLink from "lucide-solid/icons/external-link";
import X from "lucide-solid/icons/x";
import MessageSquarePlus from "lucide-solid/icons/message-square-plus";
import BookOpen from "lucide-solid/icons/book-open";
import Maximize from "lucide-solid/icons/maximize-2";
import Scan from "lucide-solid/icons/scan";
import Ellipsis from "lucide-solid/icons/ellipsis";
import { INTERACT_ZOOM } from "../camera/camera.ts";
import { attachEditor, type EditorHost } from "./Editor.ts";
import { turnCards, type TurnCard } from "../chat/turn-cards.ts";
import { anchorPoint, bubbleSide, type Mark } from "../canvas/annotations.ts";
import { actRects, cursorFor, holding, landed, type AgentAct, type Rect } from "../canvas/acts.ts";
import { isRead, READ_MS, READ_ZOOM } from "./glow.ts";
import { attachFrameDrop, type FileDropHost } from "./file-drop.ts";
import { measureFrame } from "./extent.ts";
import { attachFrameGestures, type FrameGestureHost } from "./frame-gestures.ts";
import { attachLiveWant, liveDelta, pushLive, pushLiveWeb, type LiveWebReply } from "./live-chat.ts";
import { attachBoardOpen } from "./board-links.ts";
import { attachBoardEval } from "./board-eval.ts";
import { attachCommentSelect } from "../markup/comment-select.ts";
import { paintFrame } from "../lib/theme.ts";
import type { RendererChoice } from "../lib/renderer.ts";
import { canvasPixelRatio, drawScale, elementContext, needsRedraw, type PaintEvent, type PictureHost, pictureSize } from "../canvas/picture.ts";

/**
 * One board on the stage: a title above it, and the document itself in a frame.
 *
 * The frame is same-origin (DESIGN §4), so from M4 the editor reads and writes
 * `frame.contentDocument` directly. Two things follow already: the board is sized
 * in world units and left to scale with the stage rather than re-laid-out at every
 * zoom, and above `INTERACT_ZOOM` the frame stops taking pointer events so a pan
 * across a board is a pan.
 *
 * The title bar is deliberately outside the surface — a board is a document, not a
 * window, and its own top-left corner belongs to the page. It is also the drag
 * handle, so moving a board never depends on hitting a part of the page that
 * happens to be empty.
 */
/**
 * A board being edited: its file, in a textarea.
 *
 * It used to carry a `kind`, because a flow document could also be opened in a GrapesJS model that
 * wrote ops rather than the file. That editor is gone — see `BoardEditor` below for what it did —
 * so this is one surface standing in for the frame: same box, same size, same moment.
 */
export interface BoardEditing {
	source: string;
	onCommit: (text: string) => void;
	onCancel: () => void;
}

/** A copy of a canvas's pixels, to put back if the next draw turns out empty. */
function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
	const copy = document.createElement("canvas");
	copy.width = canvas.width;
	copy.height = canvas.height;
	copy.getContext("2d")?.drawImage(canvas, 0, 0);
	return copy;
}

/**
 * Whether a board's picture came out with nothing in it. Read from an 8 by 8 copy, one small read
 * rather than a read of the whole canvas: a board's page always paints a background, so a picture
 * with no opaque pixel at all is a snapshot of a page that has not painted yet.
 */
/**
 * The band along a live board's edge that moves it: screen pixels outside the border, and inside it.
 * Wider under a finger, which needs a bigger target than a pointer.
 */
const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const EDGE_OUT_PX = COARSE ? 16 : 8;
const EDGE_IN_PX = COARSE ? 6 : 4;

/** How long a page going to sleep waits for the sheet's picture of it before hiding anyway. */
const SLEEP_WAIT_MS = 800;

const probe = typeof document === "undefined" ? undefined : Object.assign(document.createElement("canvas"), { width: 8, height: 8 });
function isEmpty(canvas: HTMLCanvasElement): boolean {
	const ctx = probe?.getContext("2d", { willReadFrequently: true });
	if (!ctx || !probe) return false;
	ctx.clearRect(0, 0, 8, 8);
	ctx.drawImage(canvas, 0, 0, 8, 8);
	const data = ctx.getImageData(0, 0, 8, 8).data;
	for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) return false;
	return true;
}

export function BoardFrame(props: {
	board: Board;
	camera: Camera;
	/** Whether the board has a document: on screen, or off it for less than a moment (`Stage`). */
	mounted: boolean;
	/** Whether this is the board the focus view is showing (`state/ui.ts`). */
	focused?: boolean;
	/** Enter or leave that view for *this* board — the button in its own title bar. */
	onFocus?: () => void;

	/**
	 * Where to put the node, when the caller is not the canvas.
	 *
	 * Absent on the canvas — the board's own world position is right there and the world's
	 * transform applies the camera. The focus view passes `{ x: 0, y: 0 }`: it has neither.
	 */
	origin?: { x: number; y: number };
	/** Whether the board is on screen or within a viewport of it — what the title bar keys on. */
	visible: boolean;
	selected: boolean;
	/** Bumped by `stage.reload`, for a change the watcher cannot see. */
	nonce?: number;
	/** Where an agent is pointing, in board coordinates. */
	cursor?: { x: number; y: number; label: string; color: string };
	/** Agents pointing at components on this board. Transient; never written to the file. */
	marks?: Mark[];
	/** Agents at work on this board: a cursor each, and the blocks they hold or just wrote (`acts.ts`). */
	acts?: AgentAct[];
	/**
	 * Where an agent's cursor stands for its act on this board, in board coordinates, or undefined
	 * once the act has left it. The cursor itself is drawn by the stage (`Stage.tsx`), so it glides
	 * from board to board rather than leaving one and appearing on the next.
	 */
	onActPoint?: (agentId: string, at: { x: number; y: number } | undefined) => void;
	/** The board's size just changed from outside a drag: its box and bar ease to it (`Stage`'s `sizingPaths`). */
	sizing?: boolean;
	/**
	 * The board is news — an agent named it and the person has not read it — drawn as a glow in
	 * this colour (the writer's) until it is read. Absent for a board that is not news.
	 */
	news?: string;
	/**
	 * The board's document is showing, or has stopped showing: ready by its own word
	 * (`__boardReady`), or three seconds after it loaded, whichever is first. Until then the stage
	 * keeps the board's picture over it (`pen/scene.ts`), so a board never flashes white on its way
	 * from a picture to a page.
	 */
	onLive?: (live: boolean) => void;
	/**
	 * Take a picture of the page as it is, before it is let go (`canvas/shots/adaptors.ts`). When
	 * given, a page whose `mounted` turns off is held until the picture is taken, so the board
	 * keeps looking the way the reader left it.
	 */
	capture?: (frame: HTMLIFrameElement) => Promise<void>;
	/**
	 * Keep the page when it stops being shown (`mounted` off): photographed, then dormant rather
	 * than unloaded, so coming back is the page as it was left, not a fresh start. `Stage` keeps
	 * the most recently shown pages, as many as the device can afford.
	 */
	kept?: boolean;
	/** Loaded but off screen: dormant as a kept page is, until the camera rests on it (`Stage`). */
	asleep?: boolean;
	/** The sheet has this board's picture on screen, over the page: the page may now be hidden or let go. */
	pictured?: boolean;
	/** Asleep for a zoom: hidden only once `pictured`, never on the timer. */
	covering?: boolean;
	/**
	 * A drag carries this board's picture (`PenLayer.carry`): the page stays where it was picked up,
	 * hidden, until the move lands and the sheet draws the board in its new place.
	 */
	carried?: boolean;
	/** The board was read on the canvas: zoomed in on, mostly on screen, at rest (`glow.ts`). */
	onRead?: () => void;
	onSelect: () => void;
	onMove: (x: number, y: number) => void;
	/**
	 * A mouse or pen press on the title bar, offered to the stage first: it moves the board with the
	 * rest of a selection and snaps it (`Stage.dragBoard`). True means it took the drag.
	 */
	drag?: (event: PointerEvent) => boolean;
	/** The pointer came onto the board or its title bar, or left both: for the stage's hover outline. */
	onHover?: (on: boolean) => void;
	/**
	 * A drag of the board's own (a finger on its edge): where the board is being carried, and null
	 * when it ends. The stage moves the selection outline with it and hides the pill and handles.
	 */
	onDragging?: (at: { x: number; y: number } | null) => void;
	/** How far the stage is carrying this board in a drag of its own, until the move is sent. */
	shift?: { dx: number; dy: number };
	/**
	 * The board dragged to a new size, in board units.
	 *
	 * Sent on release rather than while dragging: a board's size is a number in its own file,
	 * and the frame showing it is the file. So the drag previews the *box* — the node is drawn
	 * at the size being asked for, with the document still at its old one inside it — and the
	 * write happens once, at the end, which is also what makes one gesture one revision.
	 *
	 * Only the dimensions the file can hold arrive here. A board sends both — a height is a floor
	 * in its `<meta>` tag, which the content raises when it needs to — and a slide deck sends the
	 * width alone, because its height follows from its aspect (`wire/boards.ts` decides that, not
	 * this file).
	 */
	onResize?: (size: { w: number; h: number }) => void;
	/** The box the stage's resize handles are asking for, drawn before the file has it. */
	resized?: { x: number; y: number; w: number; h: number } | undefined;
	onOpen: () => void;
	/**
	 * How much room this board's content took, once the document had finished mounting.
	 *
	 * Sent up rather than kept here because the frame is the only place a board is laid
	 * out, and the server is where the question gets asked (`stage.fit`, and `clipped` on
	 * `stage.boards()`). Reported once per load, with the revision it was measured at.
	 */
	onExtent?: (extent: { rev: number; w: number; h: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void;
	/** Only for a deck: take it fullscreen. */
	onPresent?: () => void;
	/**
	 * The board being edited, as its file in a textarea.
	 *
	 * Rendered *inside* this node rather than as a dialog, so the canvas positions and scales it
	 * exactly as it does the frame it stands in for — which is what makes the box feel like the
	 * board rather than like something on top of it.
	 */
	editing?: BoardEditing;
	/** Take this board off the canvas. It stays in the agent's context. */
	onHide?: () => void;
	/** Comment on the whole board, from its title bar. */
	onComment?: () => void;
	/** The stage's layer that does not zoom, where the title bar lives (`Stage.tsx`); none on a touch screen. */
	barLayer?: HTMLElement | undefined;
	/** Put a bar on screen for a board at this place and width, and keep it there as the camera moves. */
	placeBar?: (bar: HTMLElement, at: { x: number; y: number; w: number }) => void;
	/** Editing lives inside the frame, because the frame is same-origin (§4). */
	editor: EditorHost;
	/** Canvas gestures that start inside the frame and belong to the stage. */
	gestures: FrameGestureHost;
	/** A file dragged in from the desktop, which also arrives inside the frame. */
	drops: FileDropHost;
	/**
	 * The revision this frame should display, when that is not the newest one — after
	 * this browser's own edit, the DOM is already correct and reloading it would
	 * flash. Undefined means "whatever the board says".
	 */
	showRev?: number;
	/**
	 * A revision to render instead of the file, while the timeline is being previewed.
	 * Read-only by construction: it is a different URL, and the store never changes.
	 */
	previewSha?: string;
	/**
	 * A conversation, for a board that is a live view of one (`live-chat.ts`).
	 *
	 * Read inside an effect, so it has to be an accessor rather than a value: which agent
	 * a board wants is only known once the board has loaded and asked, and the answer has
	 * to stay reactive after that.
	 */
	transcript?: (agentId: string) => readonly ChatItem[] | undefined;
	/** Who that agent is, so a mirror can draw a header in their colour. */
	agentIdentity?: (agentId: string) => { name: string; color: string } | undefined;
	/**
	 * What that agent is doing, in the column's own words (`chat/working-sign.ts`), or nothing.
	 *
	 * The mirror draws a working line at the foot of its transcript, and the words are the
	 * column's — "typing…" while a reply arrives, "running tools…" for the long pause with no
	 * text in it. Read here rather than derived from the transcript by the board, because a
	 * board that derived it said "working…" for both and was therefore a second opinion about
	 * what the agent is doing.
	 */
	working?: (agentId: string) => string | undefined;
	/** The shared Chrome's state, for a board that is its status card (`live-web.js`). */
	webStatus?: () => { status: WebStatus; code?: string } | undefined;
	/** The user pressed Allow, Deny or Stop on that card. */
	onWebReply?: (reply: LiveWebReply) => void;
	/**
	 * A link **on** this board that points at another board (`board/board-links.ts`).
	 *
	 * `true` when the deck had that board and it is now on the canvas. A return value rather
	 * than two callbacks because only the app knows the deck; `false` is a path this deck does
	 * not hold, which the app has already said out loud.
	 */
	onOpenBoard?: (path: string, from: string) => boolean;
	/**
	 * A component on this board carrying code was pressed (`board/board-eval.ts`).
	 *
	 * The board posted the name of the code block; the path is stamped here, from the board
	 * this frame is showing, and the server reads the code out of that board's file.
	 */
	onBoardEval?: (path: string, id: string, value: unknown) => void;
	/**
	 * How this board is put on the stage (`lib/renderer.ts`): a document in a box, a
	 * document drawn into a canvas of its own, or a picture on the stage's one canvas.
	 */
	renderer: RendererChoice;
	/**
	 * Whether the camera's scale is moving right now. A canvas renderer draws nothing while
	 * it is — the picture is stretched — and draws once, at the new size, when it stops.
	 */
	scaling: boolean;
	/**
	 * Whether the camera is moving at all, scale or position. A pan makes Chrome report
	 * every drawable as changed; a draw then is work thrown away at the next step.
	 */
	moving: boolean;
	/** The stage's side of the canvas renderer: the redraw queue (`picture.ts`). */
	pictures: PictureHost;
}) {
	let detachEditor: (() => void) | undefined;
	let detachSelect: (() => void) | undefined;
	let detachComments: (() => void) | undefined;
	let detachGestures: (() => void) | undefined;
	let detachDrop: (() => void) | undefined;
	let detachLive: (() => void) | undefined;
	let detachLinks: (() => void) | undefined;
	let detachEval: (() => void) | undefined;
	/** The wait for `__boardReady`, cancelled if the frame reloads or goes away first. */
	let measuring: ReturnType<typeof setTimeout> | undefined;
	/** Whether the stage has been told this board's document is showing (`onLive`). */
	let liveNow = false;
	/*
	 * The page is being photographed on its way out (`capture`): kept until the picture is taken,
	 * then let go. Started when the browser is next idle, so the copy does not land in the same
	 * frames as the pages the camera just arrived at starting up.
	 */
	const [keptForShot, setKeptForShot] = createSignal(false);
	/** Where this page's picture is: none asked for yet, being taken, or taken since it was last mounted. */
	let shot: "none" | "taking" | "taken" = "none";
	const takeShot = () => {
		const frame = frameEl;
		if (!frame) return setKeptForShot(false);
		setKeptForShot(true);
		const idle = (go: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(go, { timeout: 1000 }) : setTimeout(go, 50));
		idle(() => {
			// Mounted again before it was taken: the page stays, and nothing needs a picture.
			if (props.mounted || frame !== frameEl || !props.capture) {
				shot = "none";
				return setKeptForShot(false);
			}
			void props
				.capture(frame)
				.catch(() => {})
				.finally(() => {
					shot = "taken";
					if (props.kept || props.mounted) return setKeptForShot(false);
					// Let go only once the sheet shows the picture in its place, as a page going to sleep does.
					setLiveNow(false);
					const began = performance.now();
					const letGo = () => {
						if (props.mounted || props.pictured || performance.now() - began > SLEEP_WAIT_MS) return setKeptForShot(false);
						requestAnimationFrame(letGo);
					};
					letGo();
				});
		});
	};
	/*
	 * Decided in the same step as whether the page is shown, not after it: by the time an effect
	 * heard `mounted` turn off, the frame would already be gone.
	 */
	const hasPage = createMemo<boolean>((had) => {
		if (props.mounted) {
			shot = "none";
			return true;
		}
		if (keptForShot()) return true;
		if (had && props.kept && frameEl?.isConnected) {
			// Kept: a picture first when it was showing, then the page stays, dormant (`dormant`).
			if (shot === "none" && props.capture && liveNow) {
				shot = "taking";
				queueMicrotask(takeShot);
			}
			return true;
		}
		if (had && shot === "none" && props.capture && liveNow && frameEl?.isConnected) {
			shot = "taking";
			queueMicrotask(takeShot);
			return true;
		}
		return false;
	}, false);
	let readying: ReturnType<typeof setTimeout> | undefined;
	const setLiveNow = (on: boolean) => {
		if (!on) clearTimeout(readying);
		if (on === liveNow) return;
		liveNow = on;
		props.onLive?.(on);
	};
	/*
	 * Dormant: kept, not shown, and its picture taken. Its box skips rendering
	 * (`content-visibility: hidden`, `canvas.css`), which stops its animations and timers from
	 * costing a frame while the document, its scroll and whatever was typed into it stay as they
	 * were; the sheet draws its picture. Shown again, it is unhidden and says it is showing once
	 * it has painted, with no load in between.
	 */
	const sleepy = createMemo(() => hasPage() && !keptForShot() && (props.asleep === true || (!props.mounted && props.kept === true)));
	/*
	 * Hidden only once the sheet's picture is over it: told first that the page is not showing, the
	 * sheet draws the picture a frame or more later (later still when the picture is new), and a page
	 * hidden before that left nothing on screen for those frames, which was the flicker of a zoom-out.
	 * A board the sheet does not reach (off its edge) sleeps after a short wait instead.
	 */
	const [waited, setWaited] = createSignal(false);
	let waiting: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(waiting));
	createEffect(
		on(sleepy, (now, was) => {
			clearTimeout(waiting);
			setWaited(false);
			if (now) {
				setLiveNow(false);
				waiting = setTimeout(() => setWaited(true), SLEEP_WAIT_MS);
			} else if (was && frameEl?.isConnected) whenReady(frameEl);
		}, { defer: true }),
	);
	/* Covered for a zoom or a move, the page stays until its picture is drawn, however long that takes:
	   hidden on the timer, a board whose picture was still coming was a blank for the whole gesture. */
	const dormant = createMemo(() => sleepy() && (props.pictured === true || (!props.covering && waited())));
	/*
	 * A loaded page that is shown and awake says so, whichever way it got here. Shown again while its
	 * picture was being handed to the sheet (`takeShot`), it had been told it was not showing and was
	 * never asked again, since it never slept: the sheet kept drawing its picture over it until the
	 * board next left the screen, so a board you zoomed in on and clicked stayed a picture.
	 */
	createEffect(() => {
		if (!hasPage() || sleepy() || keptForShot()) return;
		const frame = frameEl;
		if (frame?.isConnected && frame.dataset.wired !== undefined && !liveNow) whenReady(frame);
	});
	/** Say the document is showing once it says it is ready, or after three seconds of trying. */
	const whenReady = (frame: HTMLIFrameElement) => {
		clearTimeout(readying);
		if (!props.onLive || liveNow) return;
		const began = performance.now();
		const check = () => {
			readying = undefined;
			// A dormant page that reloads (a new revision) is ready for when it is shown, not now.
			if (frame !== frameEl || !frame.isConnected || sleepy()) return;
			const ready = (frame.contentWindow as (Window & { __boardReady?: boolean }) | null)?.__boardReady === true;
			if (ready || performance.now() - began > 3000) {
				// One more frame, so what it painted is on screen before the picture over it goes.
				requestAnimationFrame(() => frame === frameEl && !sleepy() && setLiveNow(true));
				return;
			}
			readying = setTimeout(check, 50);
		};
		check();
	};
	onCleanup(() => {
		detachSelect?.();
		detachComments?.();
		detachEditor?.();
		detachGestures?.();
		detachDrop?.();
		detachLive?.();
		clearTimeout(measuring);
		setLiveNow(false);
	});

	/**
	 * Measure the document once it has finished mounting, and send the reading up.
	 *
	 * `load` is too early by design: `board.js` renders markdown, maths, diagrams and
	 * embeds afterwards and only then sets `__boardReady`, so a measurement taken at
	 * `load` is of a document that does not exist yet. Polling rather than a message
	 * because a board is an ordinary document the deck can hold — it makes no promises to
	 * this app, and an old board that never sets the flag must cost nothing more than a
	 * few checks that come to nothing.
	 */
	const reportExtent = (frame: HTMLIFrameElement, rev: number) => {
		clearTimeout(measuring);
		if (!props.onExtent) return;
		let left = 150;
		const attempt = () => {
			measuring = undefined;
			// A reload replaced the document this measurement was for; the new one will
			// ask again on its own `load`.
			if (frame !== frameEl || !frame.isConnected) return;
			const extent = measureFrame(frame);
			if (extent) {
				props.onExtent?.({ rev, ...extent });
				return;
			}
			if (left-- > 0) measuring = setTimeout(attempt, 100);
		};
		measuring = setTimeout(attempt, 0);
	};

	/*
	 * And again on every revision, not only on every load.
	 *
	 * The user's own edits are applied to the live DOM rather than by reloading the frame
	 * — that is the whole point of the patch path — so a board being edited would keep
	 * reporting the size it had when it last loaded, and `clipped` would go quiet exactly
	 * while somebody is adding the paragraph that overflows it.
	 */
	createEffect(() => {
		const rev = props.board.rev;
		if (frameEl) reportExtent(frameEl, rev);
	});

	const [dragging, setDragging] = createSignal(false);

	/** Where the board sits while a drag is in flight, before the server knows. */
	const [ghost, setGhost] = createSignal<{ x: number; y: number } | null>(null);
	createEffect(
		on([dragging, ghost], ([now, at]) => props.onDragging?.(now ? (at ?? { x: props.board.x, y: props.board.y }) : null), { defer: true }),
	);
	/*
	 * The box being resized, from the stage's handles (`Stage.tsx`), held from the first move until
	 * the file comes back at it. The node is drawn at it, so the box follows the pointer without
	 * waiting for a round trip, and keeps following after the pointer is up, while the write lands.
	 */
	const sizing = () => props.resized;

	/**
	 * Where this node sits: the board's world position, or a place its caller chose.
	 *
	 * The canvas positions every node in *world* coordinates and lets the one transform on
	 * `.world` do the camera — which is what makes a pan a compositor change rather than a
	 * layout of every board. The focus view has no world and no camera, so it places the frame
	 * itself (`canvas/Stage.tsx`).
	 */
	const at = () => props.origin ?? (props.carried ? undefined : ghost()) ?? (props.resized ? { x: props.resized.x, y: props.resized.y } : undefined) ?? { x: props.board.x, y: props.board.y };
	/*
	 * The stage's drag of this board, as a transform over where it is: a move of `left` and `top`
	 * lays the page out again on every pointer move, where a transform is the compositor's alone.
	 */
	const shifted = () => (props.shift && !props.carried && !props.origin && !props.resized && !ghost() ? `translate(${props.shift.dx}px, ${props.shift.dy}px)` : undefined);
	const frameSrc = () => {
		if (props.previewSha) return `/api/revision/${props.previewSha}`;
		// 0 means unpinned: show whatever the board now is.
		const rev = props.showRev && props.showRev > 0 ? props.showRev : props.board.rev;
		const url = boardUrl({ path: props.board.path, rev });
		return props.nonce ? `${url}&r=${props.nonce}` : url;
	};
	/**
	 * The camera's scale, as the board's *chrome* uses it: held still while the camera moves.
	 *
	 * Everything counter-scaled here — the title bar, its buttons, the resize handle, an
	 * agent's marks and cursor — is sized in `--unit`, which is `1px / var(--zoom)`. So a new
	 * zoom is not a repaint, it is a **layout** of every one of those boxes, and during a
	 * camera fly that is sixteen bars laid out on every frame. Measured on one 420ms fly over
	 * sixteen boards: the move was drawn 21 times with the bars as they were and 25 times with
	 * them taken away entirely, and style and layout came to 187ms of the flight.
	 *
	 * So the chrome rides with the world while the camera is moving — for those few hundred
	 * milliseconds a bar scales like the board it sits on — and takes its true size again the
	 * moment the camera rests, which is when anyone looks at it. The memo returns its previous
	 * value rather than reading the camera, so nothing downstream even re-runs.
	 */
	const zoom = createMemo((previous?: number) => (props.moving && previous !== undefined ? previous : props.camera.zoom));
	/** The board or its bar is under the pointer: the bar's buttons show for either (`canvas.css`). */
	const [hovered, setHovered] = createSignal(false);
	createEffect(() => props.onHover?.(hovered()));
	/* Below the live zoom a board is a tile to pan across; the selected one is live and takes the pointer at any zoom. */
	const inert = createMemo(() => zoom() < INTERACT_ZOOM && !props.selected);

	/*
	 * A clock for re-measuring the board's own DOM.
	 *
	 * An annotation's position comes from `offsetLeft` on an element in *another document*,
	 * which no signal can depend on. So it is re-read when the camera moves, when the board
	 * changes revision, and — while there is anything to draw — a few times a second, which
	 * is what lets an arrow follow a component being dragged.
	 *
	 * The interval runs **only while this board has marks on it**, which is almost never: it
	 * is not a render loop, it is a poll that exists for a few seconds after an agent points
	 * at something.
	 */
	/*
	 * Tell the board's own document whether editing is on.
	 *
	 * The injected stylesheet hangs its hover affordances — the dotted underline and the
	 * I-beam — off `:root[data-decks-edit]`, and this is what sets it. An effect rather than
	 * something inside `attachEditor`, because `enabled()` is a signal and that file is plain
	 * DOM in somebody else's document with no way to observe one.
	 *
	 * Applied when the mode changes, and again as each document loads (`wire`): the frame reloads
	 * when another tab edits the board, and a fresh document has none of our attributes on it. Not
	 * on every mount and revision, which a zoom-out across forty boards made 442 ms of main thread.
	 */
	const markEditing = (frame: HTMLIFrameElement | undefined) => {
		const root = frame?.contentDocument?.documentElement;
		if (!root) return;
		if (untrack(() => props.editor.enabled())) root.setAttribute("data-decks-edit", "");
		else root.removeAttribute("data-decks-edit");
	};
	createEffect(() => {
		props.editor.enabled();
		markEditing(frameEl);
	});



	/*
	 * Feeding a live board.
	 *
	 * A mirror asks which conversation it is of once it has mounted, and keeps asking until
	 * it is answered — so this is a signal set by the board rather than a prop, and the
	 * effect below only starts existing once there is something to feed.
	 *
	 * `sent` is what that board is holding. It is deliberately *not* reactive state: it is
	 * a record of what went down the wire, and writing it inside the effect that reads the
	 * transcript would be a loop if it were.
	 */
	const [wants, setWants] = createSignal<string | undefined>(undefined);
	/** The cards last posted, so the next feed can say what changed rather than what is. */
	let sent: readonly TurnCard[] = [];
	/**
	 * Whether this board has been answered at all.
	 *
	 * The first feed goes out even when there is nothing in it. A conversation with no turns
	 * yet is the ordinary state of an agent you have just started, and a mirror of one sat
	 * saying "…" with no name and no colour until it had something to say — which reads as
	 * broken rather than as empty, and is also the first thing anybody would try.
	 */
	let fed = false;
	/** The working words last sent, so a change in them without a change in the turns still goes. */
	let sentWorking: string | undefined;
	createEffect(() => {
		const agent = wants();
		if (!agent || !props.transcript) return;
		/*
		 * Unwrapped, because `postMessage` cannot clone a proxy.
		 *
		 * The transcript comes out of a Solid store, so every item and everything nested in
		 * one is a proxy — and the structured clone algorithm refuses those with a
		 * `DataCloneError` that Solid reports as "Unknown error". The reactive read has
		 * already happened by the time this runs, so unwrapping costs no tracking. The cards
		 * are then built from plain items, so they are plain too — a `ToolChip`'s item is the
		 * same object that was unwrapped here.
		 */
		const items = unwrap(props.transcript(agent) ?? []) as readonly ChatItem[];
		const turns = turnCards(items);
		const working = props.working?.(agent);
		const delta = liveDelta(sent, turns);
		/*
		 * The working words are part of what a mirror holds, so a turn that does not change but
		 * is now being worked on is still something to send — a tool call starting changes the
		 * cards, and the moment the model begins its next sentence changes only this.
		 *
		 * Sent as an append of nothing for that case rather than as a reset: `from` past the end
		 * is not a thing the board will act on, and a board that rebuilt the whole transcript
		 * every time the state moved would throw a reader who had scrolled back up to the top
		 * of the conversation.
		 */
		if (!delta && fed && working === sentWorking) return;
		const frame = frameEl;
		if (!frame) return;
		sent = [...turns];
		sentWorking = working;
		fed = true;
		pushLive(frame, {
			decks: "live.chat",
			agent,
			from: delta?.from ?? turns.length,
			turns: delta?.turns ?? [],
			total: turns.length,
			...(working ? { working } : {}),
			...(props.agentIdentity?.(agent) ? { identity: props.agentIdentity(agent) as { name: string; color: string } } : {}),
		});
	});

	/*
	 * Feeding a web card: the whole status every time, because it is small and the card
	 * redraws from scratch. The signal is set by the board asking, exactly as `wants` is.
	 */
	const [wantsWeb, setWantsWeb] = createSignal(false);
	createEffect(() => {
		if (!wantsWeb() || !props.webStatus) return;
		const held = props.webStatus();
		const frame = frameEl;
		if (!held || !frame) return;
		pushLiveWeb(frame, { decks: "live.web", status: unwrap(held.status) as WebStatus, ...(held.code ? { code: held.code } : {}) });
	});

	const [tick, setTick] = createSignal(0);
	/** Who is acting on this board, as ids: a string is a stable key where an act object is not. */
	const actingAgents = createMemo(() => (props.acts ?? []).map((act) => act.agentId), [], { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) });
	createEffect(() => {
		if ((props.marks?.length ?? 0) === 0 && (props.acts?.length ?? 0) === 0) return;
		const timer = setInterval(() => setTick((n) => n + 1), 120);
		onCleanup(() => clearInterval(timer));
	});
	/*
	 * Only while there is something the tick moves: the marks and the acts are its only readers, and
	 * on a stage of hundreds of boards a tick per board per camera frame was script for nothing.
	 */
	createEffect(() => {
		if ((props.marks?.length ?? 0) === 0 && (props.acts?.length ?? 0) === 0) return;
		void props.camera;
		void props.board.rev;
		setTick((n) => n + 1);
	});

	/**
	 * Point the frame at a URL, but only when that URL actually changed.
	 *
	 * Assigning `src` reloads an iframe *even when the value is identical*, so this cannot
	 * be a plain reactive attribute. `frameSrc` reads `showRev` when the board is pinned
	 * and `board.rev` when it is not, and pinning happens the moment the user edits: the
	 * rev being pinned to is the rev already on screen, so the string does not change but
	 * the dependency does. As a JSX attribute that re-ran the setter and tore down the
	 * document the user was editing — a white flash on every component drag, to show the
	 * bytes the live DOM already had.
	 */
	let frameEl: HTMLIFrameElement | undefined;
	/** The node itself, for measuring how much of it is on the screen. */
	let nodeEl: HTMLDivElement | undefined;
	const applySrc = () => {
		const next = frameSrc();
		if (!frameEl || frameEl.getAttribute("src") === next) return;
		// Deaf until the new document is wired: see `wire`.
		delete frameEl.dataset.wired;
		frameEl.setAttribute("src", next);
	};
	createEffect(applySrc);

	/**
	 * Wire a document that has just loaded: theme, editor, gestures, drops, live feeds, and
	 * the measurement. Called from the frame's `load` whichever renderer put it there.
	 */
	const wire = (frame: HTMLIFrameElement) => {
		paintFrame(frame);
		markEditing(frame);
		// Re-attached on every load: a reload is a new document, and the
		// listeners went with the old one.
		detachEditor?.();
		detachGestures?.();
		detachDrop?.();
		detachLive?.();
		detachLinks?.();
		detachEval?.();
		detachSelect?.();
		/*
		 * A press inside a board selects that board — **every** format, either mode.
		 *
		 * It has to *say* so, because everything a board then responds to asks the canvas which
		 * board is selected: the arrow keys on a deck, the double-click that opens the source, the
		 * `f` that fills the window. The three other ways in are the title bar, the surface's own
		 * padding and the rail, and none of them is the board: a click on the board itself lands in
		 * the frame, which is a document of its own and sends nothing up.
		 *
		 * **It used to be the non-component formats only**, on the argument that on a component
		 * board a click means "this box" and the editor answers it. The editor does answer it — and
		 * only when there is an editor: `Editor.ts` returns on its first line unless the canvas is
		 * in edit mode and zoomed past the interaction threshold, and a press on the padding of a
		 * card already cleared the component and left the board. So in browse mode — which is where
		 * every session starts — clicking a placed board selected nothing at all, while clicking
		 * its title bar selected it, which is the same gesture meaning two things.
		 *
		 * **Capture, and it cannot fight the editor.** `Editor.ts` listens on the bubble phase and
		 * this runs first, so the order is: the board is selected, and then the editor says what was
		 * under the pointer — a component, which selects it and its board together, or nothing,
		 * which clears the component and leaves the board selected. That last part is the answer a
		 * press on a component board's background should give, and this is where it comes from.
		 *
		 * Here rather than in an effect, and that is the whole bug: an effect reads
		 * `contentDocument` before the load and lands on the `about:blank` the frame starts with,
		 * which is then thrown away.
		 */
		const doc = frame.contentDocument;
		// Shift and a mouse press on a live page adds the board to the selection, as on its picture.
		const select = (event: PointerEvent) => {
			if (event.shiftKey && event.pointerType === "mouse" && event.button === 0 && !props.focused && props.drag?.(event)) return;
			props.onSelect();
		};
		doc?.addEventListener("pointerdown", select, true);
		// A hand inside the page is a hand on the canvas: it holds the view against an agent's show.
		for (const kind of ["pointerdown", "wheel", "keydown"] as const) doc?.addEventListener(kind, touchedCanvas, { capture: true, passive: true });
		detachSelect = () => {
			doc?.removeEventListener("pointerdown", select, true);
			for (const kind of ["pointerdown", "wheel", "keydown"] as const) doc?.removeEventListener(kind, touchedCanvas, { capture: true });
		};
		// Words selected while browsing offer a comment on them (`comment-select.ts`).
		detachComments?.();
		detachComments = attachCommentSelect(frame, props.board.path);
		detachEditor = attachEditor(frame, props.board.path, props.editor);
		// Told where the board is, so a finger's position is arithmetic
		// rather than a layout read on every event (`frame-gestures.ts`).
		detachGestures = attachFrameGestures(frame, props.gestures, at);
		/*
		 * Now the frame may take the pointer (`canvas.css`, `iframe:not([data-wired])`). Until this
		 * moment its document is loading, or `about:blank`, and hands nothing to the stage: a
		 * trackpad pinch that landed there went to the browser and zoomed the whole page, which is
		 * what a board turning live under a pinch did.
		 */
		frame.dataset.wired = "";
		detachDrop = attachFrameDrop(frame, props.drops);
		/*
		 * A reloaded document holds nothing, so the record of what it has
		 * been sent is cleared with it — otherwise the next delta would be
		 * an append onto turns that are no longer there.
		 */
		sent = [];
		fed = false;
		setWants(undefined);
		setWantsWeb(false);
		detachLive = attachLiveWant(frame, (agent) => setWants(agent), {
			onWant: () => setWantsWeb(true),
			onReply: (reply) => props.onWebReply?.(reply),
		});
		/*
		 * A link on the board pointing at another board.
		 *
		 * The board refuses to navigate to it — a frame has no back button, so following the link
		 * would replace the board being read (`lib/board.js`) — and asks up here instead. Only a
		 * link to a board file gets this far: a link to anything else from the deck, or to
		 * anywhere else at all, was opened in a tab by the board itself, in the click, which is
		 * the only moment a browser will let a tab be opened.
		 */
		detachLinks = attachBoardOpen(frame, (path) => {
			props.onOpenBoard?.(path, props.board.path);
		});
		/*
		 * A component carrying code, pressed. The board sends the block's name and this frame's
		 * own path goes with it, which is what stops one board asking to run another's code
		 * (`board/board-eval.ts`).
		 */
		detachEval = props.onBoardEval
			? attachBoardEval(frame, (ask) => props.onBoardEval?.(props.board.path, ask.id, ask.value))
			: undefined;
		reportExtent(frame, props.board.rev);
	};

	/**
	 * Let go of everything attached to the frame's current document.
	 *
	 * The document can go away without a `load` to follow it: a board that leaves the
	 * visible margin is unmounted from inside this component — a `Show` — so the component's
	 * own cleanup has not run and never will. Whatever is attached to that document has to be
	 * let go here, or the gestures keep listening to a dead frame and, worse, the fingers it
	 * had reported to the stage are never handed back: the pool keeps them, and the next
	 * single touch anywhere on the canvas is read as a pinch.
	 */
	const unwire = (element: HTMLIFrameElement) => {
		delete element.dataset.wired;
		detachSelect?.();
		detachComments?.();
		detachEditor?.();
		detachGestures?.();
		detachDrop?.();
		detachLive?.();
		detachLinks?.();
		detachEval?.();
		detachSelect = detachComments = detachEditor = detachGestures = detachDrop = detachLive = detachLinks = detachEval = undefined;
		clearTimeout(measuring);
		if (frameEl === element) {
			frameEl = undefined;
			setLiveNow(false);
		}
	};

	/**
	 * The frame, as JSX, for the renderers that keep it in this box.
	 *
	 * A function rather than a constant because a `Show` creates it afresh each time the
	 * board mounts, and the two places it is used each need an element of their own.
	 */
	const frameNode = () => (
		<iframe
			ref={(element) => {
				frameEl = element;
				drawable = false;
				// The first src has to be set here rather than as an attribute: the
				// effect above is what owns this attribute, and letting JSX also
				// write it would navigate twice on mount.
				applySrc();
				onCleanup(() => unwire(element));
			}}
			data-path={props.board.path}
			title={props.board.title}
			width={props.board.w}
			height={props.board.h}
			referrerpolicy="no-referrer"
			// A drawable child of a canvas (`canvas-per-board`); ignored by a plain box.
			attr:drawable=""
			onLoad={(event) => {
				wire(event.currentTarget);
				whenReady(event.currentTarget);
				// Nothing to draw here: a document that has just loaded has no snapshot
				// recorded yet, so a draw now throws — after the resize has already cleared
				// whatever the canvas was holding. The canvas's own `paint` event is what
				// says the document is drawable, and it draws it.
			}}
		/>
	);

	// --- a canvas per board ---------------------------------------------------------

	/**
	 * The board's own canvas, when `canvas-per-board` is on.
	 *
	 * The frame is the canvas's child: laid out at the canvas's top-left at the board's own
	 * size, which is exactly where `drawElementImage` draws it, so a click on the picture
	 * lands on the document. The canvas has as many pixels as the board takes on screen —
	 * `pictureSize` — and is drawn on three occasions: when the document loads, when the
	 * browser says the document changed (the `paint` event), and when the camera rests after
	 * a zoom. Never during a pinch: the compositor stretches the picture, and a pinch that
	 * redrew sixteen documents a step is the thing this renderer exists to avoid.
	 *
	 * The picture outlives the document. `mounted` going false removes the frame and leaves
	 * the canvas as it was, so a board off screen for a while is a picture rather than a
	 * placeholder — which is also what makes zooming back to it instant.
	 */
	let canvasEl: HTMLCanvasElement | undefined;
	/** The size the picture was last drawn at, in backing-store pixels. */
	let have: { w: number; h: number } | undefined;
	/** The document changed while the scale was moving; draw it at rest even if the size is right. */
	let stale = false;
	/**
	 * Whether this document has ever been drawable.
	 *
	 * A resize clears the canvas, and a draw of a document whose first snapshot has not been
	 * recorded throws — so a redraw asked for before the document is ready wipes the picture
	 * and puts nothing back, which is a blank board until the next paint event. Chrome says
	 * when a document is drawable by firing `paint`; until it has, nothing here touches the
	 * canvas.
	 */
	let drawable = false;
	const [drawn, setDrawn] = createSignal(false);

	const drawPicture = (resize: boolean) => {
		const canvas = canvasEl;
		const frame = frameEl;
		if (!canvas || !frame || !frame.isConnected || frame.parentElement !== canvas) return;
		if (!drawable) return;
		/*
		 * Not while the board is off screen. Chrome's snapshot of a page it is not showing can be
		 * empty, and drawing it cleared the picture the board already had: a board panned away and
		 * back was blank the whole time it was gone and for half a second after. It is drawn once
		 * it is on screen again (the effect below watches `visible`).
		 */
		if (!props.visible) {
			stale = true;
			return;
		}
		const ctx = elementContext(canvas);
		if (!ctx) return;
		// What is on the canvas now, kept until the new snapshot is known to have something in it.
		const keep = drawn() && canvas.width > 1 ? copyOf(canvas) : undefined;
		const dpr = window.devicePixelRatio || 1;
		if (resize || !have) {
			const size = pictureSize(props.board, props.camera.zoom, dpr);
			if (canvas.width !== size.w || canvas.height !== size.h) {
				canvas.width = size.w;
				canvas.height = size.h;
			}
			have = { w: size.w, h: size.h };
		}
		/*
		 * Measured off the canvas and the frame, never worked out from the board and the zoom
		 * (`drawScale`): the frame arrives at its size on screen times the canvas's own pixels
		 * per CSS pixel, and here the frame *is* the canvas's box, so this comes out at 1 at
		 * every zoom and at every picture size.
		 *
		 * The ratio is the one from the browser's last rendering update, not the one this tick
		 * would give — a canvas's box is laid out, and layout has not run since the transform
		 * that moved it. Every draw here is a frame or more after the camera moved, which is
		 * what makes that safe: on load, on a paint event, and at rest through the queue.
		 */
		const ratio = canvasPixelRatio(canvas);
		const scale = ratio && drawScale({ w: canvas.width, h: canvas.height }, frame.getBoundingClientRect(), ratio);
		if (!scale) return;
		try {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
			ctx.drawElementImage(frame, 0, 0);
			if (keep && isEmpty(canvas)) {
				// An empty snapshot: the page is not painted yet. Put the old picture back, stretched to
				// the new size if there is one, and draw again at the page's next paint.
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.drawImage(keep, 0, 0, canvas.width, canvas.height);
				stale = true;
				return;
			}
			setDrawn(true);
		} catch {
			// "Before an initial snapshot has been recorded": the document is a frame away
			// from drawable. Its paint event will ask again.
		}
	};

	const onPaint = (event: Event) => {
		const changed = (event as PaintEvent).changedElements;
		if (changed && frameEl && !changed.includes(frameEl)) return;
		// Chrome has a snapshot of this document, which is the only thing that makes a draw
		// safe: before it, a draw throws and the resize that preceded it has already cleared.
		drawable = true;
		// While the scale is moving the picture is being stretched; a draw now would be at
		// the old size and thrown away at rest anyway. Remembered rather than dropped, so a
		// board that finished rendering during a zoom is drawn once the zoom rests.
		if (props.scaling || props.moving) {
			stale = true;
			return;
		}
		props.pictures.queue.add(props.board.path, () => drawPicture(false));
	};

	/*
	 * Redraw at rest, at the size the board now takes on screen — through the stage's queue,
	 * so sixteen boards settle over four frames rather than one long one. Runs on every
	 * camera change and does nothing on a pan: the size has not changed, and `needsRedraw`
	 * says so.
	 */
	createEffect(() => {
		if (props.renderer !== "canvas-per-board" || props.scaling || props.moving || !props.visible) return;
		const zoom = props.camera.zoom;
		void props.mounted;
		const size = pictureSize(props.board, zoom, window.devicePixelRatio || 1);
		if (!stale && !needsRedraw(have, size)) return;
		stale = false;
		props.pictures.queue.add(props.board.path, () => drawPicture(true));
	});
	onCleanup(() => props.pictures.queue.cancel(props.board.path));

	const startDrag = (event: PointerEvent) => {
		if (event.button !== 0) return;
		const touched = event.pointerType === "touch";
		/*
		 * A finger on the title bar is reported to the stage before it is used here.
		 *
		 * With a mouse this gesture is the board's alone and the event is stopped: there
		 * is one cursor and it is pressing this bar. A finger is not alone — the other one
		 * may be about to pinch, and a pinch that happens to start over a title bar used
		 * to drag the board instead of zooming, because both fingers were swallowed here
		 * and the stage never learnt they existed. So on touch the event goes on up: the
		 * stage counts the finger and is told the camera may not pan with it
		 * (`claimTouch`), which leaves the board draggable by one finger and pinchable by
		 * two. `pinching()` below is where the second finger takes the gesture back.
		 */
		if (!touched && props.drag?.(event)) return;
		if (touched) props.gestures.claimTouch(event.pointerId);
		else event.stopPropagation();
		event.preventDefault();
		props.onSelect();

		const handle = event.currentTarget as HTMLElement;
		/*
		 * Pointer capture, so a drag that outruns the cursor keeps dragging rather than
		 * stopping the moment the pointer leaves the 24px title bar. Not on touch: the
		 * stage captures the same finger to itself for the pan it might turn out to be,
		 * and the last capture wins — so the drag listens on the window, which sees the
		 * event wherever it is targeted.
		 */
		const listener: HTMLElement | Window = touched ? window : handle;
		if (!touched) handle.setPointerCapture(event.pointerId);
		setDragging(true);

		const from = { x: event.clientX, y: event.clientY };
		const origin = { x: props.board.x, y: props.board.y };
		const zoom = props.camera.zoom;
		let moved = false;

		let over = false;
		const move = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== event.pointerId) return;
			// A mouse move with no button held: the release went somewhere this never heard. It is over.
			if (moveEvent.pointerType === "mouse" && (moveEvent.buttons & 1) === 0) return finish();
			// A second finger means this was the start of a pinch, not of a move. The
			// board goes back to where it was and the camera takes over.
			if (touched && props.gestures.pinching()) {
				setGhost(null);
				finish(true);
				return;
			}
			moved = true;
			// Screen delta / zoom, because the board's coordinates are world units:
			// at 0.25 zoom the pointer travels four pixels for every one it moves.
			setGhost({
				x: origin.x + (moveEvent.clientX - from.x) / zoom,
				y: origin.y + (moveEvent.clientY - from.y) / zoom,
			});
		};

		/* Ended once: the release, a cancel or the capture being lost, wherever it is heard (`Stage.follow` says why). */
		const finish = (abandon = false) => {
			if (over) return;
			over = true;
			listener.removeEventListener("pointermove", move as EventListener);
			listener.removeEventListener("pointerup", end as EventListener);
			listener.removeEventListener("pointercancel", end as EventListener);
			handle.removeEventListener("lostpointercapture", end as EventListener);
			if (listener !== window) {
				window.removeEventListener("pointerup", end as EventListener, true);
				window.removeEventListener("pointercancel", end as EventListener, true);
			}
			setDragging(false);
			const landed = abandon ? null : ghost();
			// The ghost stays until the server's board.changed comes back with the
			// new position, or the board would jump home for a frame.
			if (landed && moved) props.onMove(Math.round(landed.x), Math.round(landed.y));
			setGhost(null);
		};
		const end = (endEvent: PointerEvent) => {
			if (endEvent.pointerId !== event.pointerId) return;
			finish();
		};

		listener.addEventListener("pointermove", move as EventListener);
		listener.addEventListener("pointerup", end as EventListener);
		listener.addEventListener("pointercancel", end as EventListener);
		handle.addEventListener("lostpointercapture", end as EventListener);
		if (listener !== window) {
			window.addEventListener("pointerup", end as EventListener, true);
			window.addEventListener("pointercancel", end as EventListener, true);
		}
	};

	/**
	 * The resize handle, dragged.
	 *
	 * The move drag's shape with the arithmetic turned through ninety degrees: the pointer's
	 * travel in screen pixels divided by the zoom is world pixels, added to the size the board
	 * had when the gesture started. No snapping — a board's size comes from `fit` and from what
	 * its content needs, and the values in this deck are 1008 and 1354 rather than multiples of
	 * anything, so a grid here would fight the numbers it is supposed to be producing.
	 *
	 * Only the width for a slide deck, and the drag refuses to pretend otherwise: the handle is
	 * drawn as a horizontal bar for one, and a height that follows from the aspect is not
	 * previewed as if it could be dragged. Every other board takes both — a height dragged out is
	 * a floor written into the file, and the content raises the board above it if it needs to.
	 */

	/*
	 * Reading a board that is news takes its glow off, everywhere the person is signed in.
	 *
	 * Measured rather than derived: whether the board is mostly on the screen is a fact about
	 * two rectangles, read each time the camera changes while a board that is news is at a
	 * readable zoom — which is rare, and nothing at all for a board that is not news. The rule
	 * itself is `isRead` (`glow.ts`); it has to hold for `READ_MS` without a break.
	 *
	 * **Panning counts.** Reading a board is often scrolling along it, and a rule that wanted the
	 * camera at rest never let a board that was being panned through lose its glow: every step of
	 * the pan started the moment again. So the moment runs while the board stays close and mostly
	 * on screen, moving or not, and only leaving that state starts it over. A fly past is over in
	 * well under the moment, so it still reads nothing.
	 */
	const [reading, setReading] = createSignal(false);
	let readTimer: ReturnType<typeof setTimeout> | undefined;
	const stopReading = () => {
		clearTimeout(readTimer);
		readTimer = undefined;
		setReading(false);
	};
	onCleanup(stopReading);
	createEffect(() => {
		void props.camera;
		const node = nodeEl;
		let now = false;
		if (props.news && props.visible && node && zoom() >= READ_ZOOM) {
			const stage = node.closest(".stage")?.getBoundingClientRect();
			const within = stage ? { x: stage.left, y: stage.top, w: stage.width, h: stage.height } : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
			const rect = node.getBoundingClientRect();
			now = isRead({ zoom: zoom(), moving: false, box: { x: rect.left, y: rect.top, w: rect.width, h: rect.height }, within });
		}
		if (!now) return stopReading();
		if (readTimer !== undefined) return;
		// Being read: the glow fades over the same moment, and goes when the read is stamped.
		setReading(true);
		readTimer = setTimeout(() => {
			readTimer = undefined;
			props.onRead?.();
		}, READ_MS);
	});

	/** Where the edge band sits, in board units: `EDGE_OUT_PX` outside the border and `EDGE_IN_PX` in. */
	const edgeBand = (side: "n" | "s" | "w" | "e") => {
		const out = EDGE_OUT_PX / props.camera.zoom;
		const band = (EDGE_OUT_PX + EDGE_IN_PX) / props.camera.zoom;
		const along = side === "n" || side === "s";
		return {
			left: `${side === "e" ? `calc(100% + ${out}px - ${band}px)` : `${-out}px`}`,
			top: `${side === "s" ? `calc(100% + ${out}px - ${band}px)` : `${-out}px`}`,
			width: along ? `calc(100% + ${2 * out}px)` : `${band}px`,
			height: along ? `${band}px` : `calc(100% + ${2 * out}px)`,
		};
	};

	return (
		<div
			class="board-node"
			ref={(element) => {
				nodeEl = element;
			}}
			data-dragging={dragging() || !!props.shift}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			data-hover={hovered() || undefined}
			data-selected={props.selected}
			data-inert={inert()}
			data-dormant={dormant() ? "" : undefined}
			data-carried={props.carried ? "" : undefined}
			data-sizing={props.sizing ? "true" : undefined}
			data-path={props.board.path}
			style={{
				left: `${at().x}px`,
				top: `${at().y}px`,
				transform: shifted(),
				width: `${(sizing()?.w ?? props.board.w)}px`,
				height: `${(sizing()?.h ?? props.board.h)}px`,
			}}
		>

			{/*
				The shadow and the outline, on a box of their own behind the surface. A shadow
				on the surface itself makes Chrome repaint every board's document on every
				step of a pan — see `.board-node > .shade` in `index.css`.
			*/}
			<div class="shade" aria-hidden="true" />

			{/*
				The title bar, on a desktop: in the stage's bar layer, which does not zoom, so it is the
				same size on screen at every zoom and is only moved (`Stage.placeBar`). It holds every
				action the touch screens' pill has (`BoardCallout`), shown while the board or its bar is
				under the pointer, or the board is selected.
			*/}
			<Show when={props.barLayer}>
				{(layer) => {
					/*
					 * The ⋯ menu: zoomed out below 50% (`Stage`'s `BAR_ZOOM`) the selected board's bar has
					 * no title and only ⋯ and ×, and ⋯ lists the other actions (`canvas.css`).
					 */
					const [menu, setMenu] = createSignal(false);
					createEffect(() => {
						if (!props.selected) setMenu(false);
					});
					const away = (event: Event) => {
						if (event instanceof KeyboardEvent ? event.key === "Escape" : !(event.target as Element | null)?.closest?.(".bar-menu, .act.more")) setMenu(false);
					};
					createEffect(() => {
						if (!menu()) return;
						window.addEventListener("pointerdown", away, true);
						window.addEventListener("keydown", away, true);
						onCleanup(() => {
							window.removeEventListener("pointerdown", away, true);
							window.removeEventListener("keydown", away, true);
						});
					});
					/** A row of the ⋯ menu, which closes it once pressed. */
					const row = (label: string, act: string, icon: typeof Scan, run: () => void) => (
						<button
							type="button"
							role="menuitem"
							data-row
							data-flat="true"
							data-act={act}
							onClick={() => {
								setMenu(false);
								run();
							}}
						>
							<span class="row-icon">
								<Icon of={icon} size={15} />
							</span>
							<span class="row-label">{label}</span>
						</button>
					);
					return (

					<Portal mount={layer()}>
						<div
							class="chrome"
							data-path={props.board.path}
							data-dragging={dragging() || !!props.shift}
							data-hover={hovered() || undefined}
							data-selected={props.selected || undefined}
							data-sizing={props.sizing ? "true" : undefined}
							ref={(bar) => {
								createEffect(() => props.placeBar?.(bar, { x: at().x, y: at().y, w: sizing()?.w ?? props.board.w }));
							}}
							onPointerDown={startDrag}
							onPointerEnter={() => setHovered(true)}
							onPointerLeave={() => setHovered(false)}
							onDblClick={() => props.onOpen()}
						>
							<span class="title">{props.board.title}</span>
							<span class="file">{props.board.path}</span>
							<span class="acts" onPointerDown={(event) => event.stopPropagation()} onDblClick={(event) => event.stopPropagation()}>
								<button type="button" class="act" data-act="Fit" title="Fit the board to the screen" aria-label={`Fit ${props.board.title}`} onClick={() => props.onOpen()}>
									<Icon of={Scan} size={12} />
								</button>
								<Show when={props.onFocus}>
									<button
										type="button"
										class="act"
										data-act="Focus"
										aria-pressed={props.focused}
										title={props.focused ? "Back to the canvas (or press d)" : "Focus on this board (or press d)"}
										aria-label={props.focused ? `Show the whole canvas instead of ${props.board.title}` : `Focus on ${props.board.title}`}
										onClick={() => props.onFocus?.()}
									>
										<Icon of={BookOpen} size={12} />
									</button>
								</Show>
								<Show when={props.onPresent && !props.board.live}>
									<button
										type="button"
										class="act"
										data-act={props.board.format === "slides" ? "Present" : "Fullscreen"}
										data-word={props.board.format === "slides" ? "true" : undefined}
										title={props.board.format === "slides" ? "Present this deck fullscreen (or press f)" : "Fill the window with this board (or press f)"}
										aria-label={`${props.board.format === "slides" ? "Present" : "Fullscreen"} ${props.board.title}`}
										onClick={() => props.onPresent?.()}
									>
										<Show when={props.board.format === "slides"} fallback={<Icon of={Maximize} size={12} />}>Present</Show>
									</button>
								</Show>
								<Show when={!props.board.live}>
									<a class="act" data-act="New tab" href={deckFileUrl(props.board.path)} target="_blank" rel="noopener" title="Open this board in its own tab" aria-label={`Open ${props.board.title} in its own tab`}>
										<Icon of={ExternalLink} size={12} />
									</a>
								</Show>
								<Show when={props.onComment}>
									<button type="button" class="act" data-act="Comment" title="Comment on this board" aria-label={`Comment on ${props.board.title}`} onClick={() => props.onComment?.()}>
										<Icon of={MessageSquarePlus} size={12} />
									</button>
								</Show>
								<button
									type="button"
									class="act more"
									data-act="More"
									aria-haspopup="menu"
									aria-expanded={menu()}
									title="More actions"
									aria-label={`More actions for ${props.board.title}`}
									onClick={() => setMenu((open) => !open)}
								>
									<Icon of={Ellipsis} size={12} />
								</button>
								<Show when={props.onHide}>
									<button type="button" class="act hide" data-act="Hide" title="Take this board off the canvas. The agent keeps it in context." aria-label={`Hide ${props.board.title}`} onClick={() => props.onHide?.()}>
										<Icon of={X} size={12} />
									</button>
								</Show>
								<Show when={menu() && props.selected}>
									<div class="popover bar-menu" role="menu" aria-label={`${props.board.title}: more actions`}>
										{row("Fit to screen", "Fit", Scan, () => props.onOpen())}
										<Show when={props.onFocus}>{row(props.focused ? "Back to the canvas" : "Focus", "Focus", BookOpen, () => props.onFocus?.())}</Show>
										<Show when={props.onPresent && !props.board.live}>
											{row(props.board.format === "slides" ? "Present" : "Fullscreen", props.board.format === "slides" ? "Present" : "Fullscreen", Maximize, () => props.onPresent?.())}
										</Show>
										<Show when={!props.board.live}>
											<a role="menuitem" data-row data-flat="true" data-act="New tab" href={deckFileUrl(props.board.path)} target="_blank" rel="noopener" onClick={() => setMenu(false)}>
												<span class="row-icon">
													<Icon of={ExternalLink} size={15} />
												</span>
												<span class="row-label">Open in a new tab</span>
											</a>
										</Show>
										<Show when={props.onComment}>{row("Comment", "Comment", MessageSquarePlus, () => props.onComment?.())}</Show>
									</div>
								</Show>
							</span>
						</div>
					</Portal>
					);
				}}
			</Show>

			{/*
				The glow on a board that is news: a soft drop shadow in the writer's colour, on a
				box of its own so its fade can never stutter. The breath is a keyframe animation
				on the pseudo-element; the fade is a transition on this element's opacity, so it
				starts from wherever the breath happens to be and reverses just as smoothly when
				the reading is interrupted. One property each, and they multiply.
			*/}
			<Show when={props.news}>
				<div class="news-glow" aria-hidden="true" data-reading={reading() ? "" : undefined} style={{ "--news": props.news, "--read-ms": `${READ_MS}ms` }} />
			</Show>

			{/*
				When the frame is inert — zoomed out far enough that a board is a tile on a
				map rather than a document — its whole body is the drag handle. The title
				bar alone is a 24px target that can sit behind a floating panel, and at that
				distance there is nothing inside the board to click anyway.

				**Except for a finger, which has no other way to pan.** One finger is the
				canvas moving (`Stage`, `frame-gestures.ts`), and a board whose body picks
				itself up would mean the gesture you use most does the thing you meant
				least — dragging the deck apart while trying to look at it. So on touch a
				board moves by its title bar at every zoom, which is the one target that
				means "this board" and nothing else. The bar is counter-scaled, so it is 24
				screen pixels however far out you are.
			*/}
			{/*
				The band along the edge of a board whose page takes the pointer: a press on it moves the
				board, since a press on the page is the page's. A child of the node, so a board stacked
				over this one covers its band too. Mostly outside the border, so the page keeps its edges;
				a mouse, a pen or one finger moves it; a second finger makes it a pinch.
			*/}
			<Show when={!inert() && !props.focused && !props.editing}>
				<For each={["n", "s", "w", "e"] as const}>
					{(side) => (
						<div
							class="board-edge"
							data-side={side}
							style={edgeBand(side)}
							onPointerDown={(event) => {
								// A finger moves the board too, and a second finger turns it into a pinch (`startDrag`).
								if (event.pointerType === "touch") return startDrag(event);
								props.drag?.(event);
							}}
						/>
					)}
				</For>
			</Show>
			<div
				class="surface"
				/*
				 * Drawn at the size being dragged, like the node. The document inside it is still
				 * the old file until the write lands, so the difference between the two is the
				 * empty panel the new area is — the honest picture of "this is the box you are
				 * asking for, and the board has not been rewritten yet".
				 */
				style={{
					width: `${(sizing()?.w ?? props.board.w)}px`,
					height: `${(sizing()?.h ?? props.board.h)}px`,
				}}
				onPointerDown={(event) => {
					// A mouse on a board's picture moves it and selects it (Shift adds it), as its bar once did.
					if (inert() && event.pointerType !== "touch" && event.button === 0) startDrag(event);
					else props.onSelect();
				}}
			>
				<Switch>
					<Match when={props.renderer === "canvas-per-board"}>
						<Show when={props.mounted ? props.editing : undefined} keyed>
							{(editing) => (
								<BoardEditor board={props.board} editing={editing} />
							)}
						</Show>
						{/*
							The picture, and the document as its child while the board has one. The
							canvas keeps what was drawn when the child goes, so the placeholder is
							only for a board that has never been drawn at all.
						*/}
						<canvas
							class="picture"
							attr:layoutsubtree=""
							width={1}
							height={1}
							ref={(element) => {
								canvasEl = element;
								element.addEventListener("paint", onPaint);
								onCleanup(() => element.removeEventListener("paint", onPaint));
							}}
						>
							<Show when={hasPage()}>{frameNode()}</Show>
						</canvas>
						<Show when={!hasPage() && !drawn()}>
							<div class="placeholder">{props.board.path}</div>
						</Show>
					</Match>
					<Match when={true}>
						<Show
							when={hasPage()}
							fallback={<div class="placeholder">{props.board.path}</div>}
						>
							<Show when={props.editing} keyed>
								{(editing) => (
									<BoardEditor board={props.board} editing={editing} />
								)}
							</Show>
							{frameNode()}
						</Show>
					</Match>
				</Switch>
				{/*
					The board's edge, claimed for the canvas.

					A scroll that lands exactly on a board's outline hits the frame's own border pixel,
					which the frame's document does not cover: the browser sends that wheel to neither
					document, and a trackpad latches the whole two-finger gesture to where it began, so
					the canvas would not pan at all until the fingers lifted. This ring, a few screen
					pixels wide and invisible, is over that pixel and belongs to this document, so the
					wheel reaches the stage.
				*/}
				<svg class="edge" aria-hidden="true">
					<rect x="0" y="0" width="100%" height="100%" />
				</svg>
			</div>



			{/*
				Agents pointing at components: a bubble with a small arrow, per mark.

				In the board's own coordinates and counter-scaled, exactly as the cursor below
				is — a board component's `offsetLeft`/`offsetTop` *are* board coordinates, so
				`anchorPoint` needs no camera maths and this file keeps its rule of having none.

				Re-resolved on every draw, which is what makes an arrow follow a component that
				is dragged: the drag rewrites the element's inline style and the next read sees
				it. `tick` is what forces that read — the position is not reactive state, it is
				a measurement of somebody else's DOM.
			*/}
			<For each={props.marks ?? []}>
				{(mark) => {
					const at = () => {
						void tick();
						return anchorPoint(frameEl?.contentDocument ?? undefined, mark.to);
					};
					return (
						<Show when={at()}>
							{(point) => (
								<div
									class="board-mark"
									data-tone={mark.tone}
									data-side={bubbleSide(point(), props.board.w)}
									style={{ left: `${point().x}px`, top: `${point().y}px`, "--zoom": zoom() }}
								>
									<span class="tip" aria-hidden="true" />
									<span class="mark-say">{mark.label}</span>
								</div>
							)}
						</Show>
					);
				}}
			</For>

			{/* An agent pointing at something, in the board's own coordinates and
			    counter-scaled so the label stays readable however far out you are. */}
			<AgentCursor cursor={props.cursor} zoom={zoom()} />

			{/*
				Agents at work on this board, said by the server rather than by them (`acts.ts`).

				One row per agent, keyed on its id so the cursor is the same element from the
				tool call to the landing and drifts between the two rather than re-mounting. The
				block rectangles are read off the board's own document on `tick`, as the marks'
				are, and compared by value so a poll that finds nothing moved redraws nothing.
				The hold and the landing are keyed on the act's own clock, which is what restarts
				their animations for a second act on the same block.
			*/}
			<For each={actingAgents()}>
				{(agentId) => {
					const act = () => props.acts?.find((one) => one.agentId === agentId);
					const rects = createMemo(
						() => {
							void tick();
							const current = act();
							return current ? actRects(frameEl?.contentDocument ?? undefined, current) : [];
						},
						[],
						{ equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
					);
					const boxes = () => (rects().length > 0 ? rects() : [{ x: 0, y: 0, w: props.board.w, h: props.board.h }]);
					const box = (rect: Rect, color: string) => ({ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, "--act": color, "--zoom": zoom() });
					createEffect(() => {
						const current = act();
						if (current) props.onActPoint?.(agentId, cursorFor(current, rects(), props.board));
					});
					onCleanup(() => props.onActPoint?.(agentId, undefined));
					return (
						<Show when={act()}>
							{(current) => (
								<>
									<Show when={holding(current()) ? current().at : undefined} keyed>
										<Index each={boxes()}>
											{(rect) => (
												<div class="act-hold" style={box(rect(), current().color)} />
											)}
										</Index>
									</Show>
									<Show when={landed(current()) ? current().at : undefined} keyed>
										<Index each={rects()}>{(rect) => <div class="act-land" style={box(rect(), current().color)} />}</Index>
									</Show>
								</>
							)}
						</Show>
					);
				}}
			</For>

		</div>
	);
}

/**
 * The editor a board gets, chosen where the board is: a file in a textarea, or a document on a
 * surface that writes ops.
 *
 * One component for the two rather than a condition at each mount point, because they have to
 * stand in for the frame in exactly the same way — same box, same size, same moment — and the
 * renderer switch has three branches that each need the same answer.
 *
 * The rich editor needs somewhere to fall back to, and that is the source textarea for the same
 * board: a refusal is the ops being unable to express what somebody did, and the honest reply is
 * the file rather than a document quietly rewritten into a shape they did not choose.
 */
function BoardEditor(props: {
	board: { path: string; w: number; h: number };
	editing: {
		source: string;
		onCommit: (text: string) => void;
		onCancel: () => void;
	};
}) {
	/*
	 * One editor, and it is the file.
	 *
	 * There was a second one here — a GrapesJS model over a flow document, writing ops instead of the
	 * whole file — and this is what is left of it. It is gone because of what it did: it put its own
	 * `wrapper` element between its canvas's body and the board's components, so every board's root
	 * rule (`body.board > *`, where `position: absolute` lives) matched the wrapper and not one
	 * component, and a page of positioned boxes drew as a stack of full-width blocks. Measured
	 * alongside that: 0 of 57 components round-tripped byte-identically through its serialiser, and
	 * its race guard refused every card with more than one child.
	 *
	 * What it bought was editing a flow document's *blocks* as a document. What that costs now is
	 * that a flow document is edited by ⌥ and the text — which is what a board from somewhere else
	 * has always needed anyway.
	 */
	return (
		<SourceEditor
			path={props.board.path}
			source={props.editing.source}
			w={props.board.w}
			h={props.board.h}
			onCommit={props.editing.onCommit}
			onCancel={props.editing.onCancel}
		/>
	);
}
