import type { BoardPatch } from "@decks/protocol";
import type { Board, Camera, ChatItem, WebStatus } from "@decks/protocol";
import BookOpen from "lucide-solid/icons/book-open";
import FilePenLine from "lucide-solid/icons/file-pen-line";
import ExternalLink from "lucide-solid/icons/external-link";
import Maximize from "lucide-solid/icons/maximize-2";
import X from "lucide-solid/icons/x";
import { SourceEditor } from "./SourceEditor.tsx";
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { unwrap } from "solid-js/store";
import { Icon } from "../ui/icons.tsx";
import { boardUrl, deckFileUrl } from "../lib/api.ts";
import { INTERACT_ZOOM } from "../camera/camera.ts";
import { attachEditor, type EditorHost } from "./Editor.ts";
import { turnCards, type TurnCard } from "../chat/turn-cards.ts";
import { anchorPoint, bubbleSide, type Mark } from "./annotations.ts";
import { attachFrameDrop, type FileDropHost } from "./file-drop.ts";
import { measureFrame } from "./extent.ts";
import { attachFrameGestures, type FrameGestureHost } from "./frame-gestures.ts";
import { attachLiveWant, liveDelta, pushLive, pushLiveWeb, type LiveWebReply } from "./live-chat.ts";
import { attachBoardOpen } from "./board-links.ts";
import { attachBoardEval } from "./board-eval.ts";
import { InkLayer } from "./InkLayer.tsx";
import { readLayer, syncLayer } from "./ink-dom.ts";
import { attachCommentSelect } from "./comment-select.ts";
import { adoptInk, drawing, inkOf } from "../state/ink.ts";
import { paintFrame } from "../lib/theme.ts";
import type { RendererChoice } from "../lib/renderer.ts";
import { canvasPixelRatio, drawScale, elementContext, needsRedraw, type PaintEvent, type PictureHost, pictureSize } from "./picture.ts";

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
	onSelect: () => void;
	onMove: (x: number, y: number) => void;
	/**
	 * The board dragged to a new size, in board units.
	 *
	 * Sent on release rather than while dragging: a board's size is a number in its own file,
	 * and the frame showing it is the file. So the drag previews the *box* — the node is drawn
	 * at the size being asked for, with the document still at its old one inside it — and the
	 * write happens once, at the end, which is also what makes one gesture one revision.
	 *
	 * Only the dimensions the format can hold arrive here. A component board sends both; a flow
	 * document and a slide deck send the width, because a flow board's height is its content
	 * and a deck's follows from its aspect (`wire/boards.ts` decides that, not this file).
	 */
	onResize?: (size: { w: number; h: number }) => void;
	onOpen: () => void;
	/**
	 * How much room this board's content took, once the document had finished mounting.
	 *
	 * Sent up rather than kept here because the frame is the only place a board is laid
	 * out, and the server is where the question gets asked (`stage.fit`, and `clipped` on
	 * `stage.boards()`). Reported once per load, with the revision it was measured at.
	 */
	onExtent?: (extent: { rev: number; w: number; h: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void;
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
	 * A link **on** this board that points at another board (`canvas/board-links.ts`).
	 *
	 * `true` when the deck had that board and it is now on the canvas. A return value rather
	 * than two callbacks because only the app knows the deck; `false` is a path this deck does
	 * not hold, which the app has already said out loud.
	 */
	onOpenBoard?: (path: string, from: string) => boolean;
	/**
	 * A component on this board carrying code was pressed (`canvas/board-eval.ts`).
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
	/** The stage's side of a canvas renderer: the redraw queue, and the darkroom (`picture.ts`). */
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
	onCleanup(() => {
		detachSelect?.();
		detachComments?.();
		detachEditor?.();
		detachGestures?.();
		detachDrop?.();
		detachLive?.();
		clearTimeout(measuring);
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
	/*
	 * The size being dragged, held from the first move until the file comes back at it.
	 *
	 * The node is drawn at this size, so the box follows the pointer without waiting for a
	 * round trip — and it keeps following after the pointer is up, because the write is a file
	 * write and the frame reloads at the end of it. Dropping the drag's number on release would
	 * snap the board home for a frame, which is the same flicker the move ghost exists to avoid.
	 */
	const [sizing, setSizing] = createSignal<{ w: number; h: number } | null>(null);

	/**
	 * Where this node sits: the board's world position, or a place its caller chose.
	 *
	 * The canvas positions every node in *world* coordinates and lets the one transform on
	 * `.world` do the camera — which is what makes a pan a compositor change rather than a
	 * layout of every board. The focus view has no world and no camera, so it places the frame
	 * itself (`canvas/Stage.tsx`).
	 */
	const at = () => props.origin ?? ghost() ?? { x: props.board.x, y: props.board.y };
	const frameSrc = () => {
		if (props.previewSha) return `/api/revision/${props.previewSha}`;
		// 0 means unpinned: show whatever the board now is.
		const rev = props.showRev && props.showRev > 0 ? props.showRev : props.board.rev;
		const url = boardUrl({ path: props.board.path, rev });
		return props.nonce ? `${url}&r=${props.nonce}` : url;
	};
	const zoom = createMemo(() => props.camera.zoom);
	const inert = createMemo(() => zoom() < INTERACT_ZOOM);

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
	 * Re-applied on every mount as well as every change: the frame reloads when another tab
	 * edits the board, and a fresh document has none of our attributes on it.
	 */
	createEffect(() => {
		const can = props.editor.enabled();
		void props.mounted;
		void props.board.rev;
		const root = frameEl?.contentDocument?.documentElement;
		if (!root) return;
		if (can) root.setAttribute("data-decks-edit", "");
		else root.removeAttribute("data-decks-edit");
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
	createEffect(() => {
		if ((props.marks?.length ?? 0) === 0) return;
		const timer = setInterval(() => setTick((n) => n + 1), 120);
		onCleanup(() => clearInterval(timer));
	});
	createEffect(() => {
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
	const applySrc = () => {
		const next = frameSrc();
		if (!frameEl || frameEl.getAttribute("src") === next) return;
		frameEl.setAttribute("src", next);
	};
	createEffect(applySrc);

	/**
	 * Ink: the strokes this board should be showing, kept in the frame's own document.
	 *
	 * Not a deck of slides, whose one layer would sit over every slide alike, and not a live
	 * view, which has no file of its own to keep a drawing in.
	 */
	const inkable = () => props.board.format !== "slides" && !props.board.live;
	const [inkDoc, setInkDoc] = createSignal<Document | undefined>(undefined);
	createEffect(() => {
		const doc = inkDoc();
		if (doc && doc === frameEl?.contentDocument) syncLayer(doc, inkOf(props.board.path));
	});

	/**
	 * Wire a document that has just loaded: theme, editor, gestures, drops, live feeds, and
	 * the measurement. Called from the frame's `load` whichever renderer put it there.
	 */
	const wire = (frame: HTMLIFrameElement) => {
		paintFrame(frame);
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
		const select = () => props.onSelect();
		doc?.addEventListener("pointerdown", select, true);
		detachSelect = () => doc?.removeEventListener("pointerdown", select, true);
		// Words selected while browsing offer a comment on them (`comment-select.ts`).
		detachComments?.();
		detachComments = attachCommentSelect(frame, props.board.path);
		// What is drawn on this board, read out of the document that has just loaded.
		if (inkable()) {
			adoptInk(props.board.path, readLayer(doc));
			setInkDoc(doc ?? undefined);
		}
		detachEditor = attachEditor(frame, props.board.path, props.editor);
		// Told where the board is, so a finger's position is arithmetic
		// rather than a layout read on every event (`frame-gestures.ts`).
		detachGestures = attachFrameGestures(frame, props.gestures, at);
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
		 * (`canvas/board-eval.ts`).
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
		if (frameEl === element) frameEl = undefined;
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
		const ctx = elementContext(canvas);
		if (!ctx) return;
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
		if (props.renderer !== "canvas-per-board" || props.scaling || props.moving) return;
		const zoom = props.camera.zoom;
		void props.mounted;
		const size = pictureSize(props.board, zoom, window.devicePixelRatio || 1);
		if (!stale && !needsRedraw(have, size)) return;
		stale = false;
		props.pictures.queue.add(props.board.path, () => drawPicture(true));
	});
	onCleanup(() => props.pictures.queue.cancel(props.board.path));

	// --- one canvas for the stage ---------------------------------------------------

	/*
	 * Under `one-canvas` the document does not live in this box at all: it is a child of the
	 * stage's darkroom canvas, which is the only place the stage can draw it from. Made here
	 * by hand rather than by JSX because it has to be appended to an element this component
	 * does not own, and Solid tidies up the nodes *it* inserted where it inserted them. It is
	 * inert — nothing inside a picture can be clicked, and a laid-out document that took
	 * focus or pointer events at the stage's top-left would be a trap.
	 */
	createEffect(() => {
		const darkroom = props.pictures.darkroom;
		if (props.renderer !== "one-canvas" || !darkroom || !props.mounted) return;
		const element = document.createElement("iframe");
		element.dataset.path = props.board.path;
		element.title = props.board.title;
		element.width = String(props.board.w);
		element.height = String(props.board.h);
		element.referrerPolicy = "no-referrer";
		element.setAttribute("drawable", "");
		element.inert = true;
		element.addEventListener("load", () => {
			wire(element);
			props.pictures.changed(props.board.path);
		});
		frameEl = element;
		applySrc();
		darkroom.appendChild(element);
		onCleanup(() => {
			unwire(element);
			element.remove();
		});
	});

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

		const move = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== event.pointerId) return;
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

		const finish = (abandon = false) => {
			listener.removeEventListener("pointermove", move as EventListener);
			listener.removeEventListener("pointerup", end as EventListener);
			listener.removeEventListener("pointercancel", end as EventListener);
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
	 * Only the width for a flow document or a slide deck, and the drag refuses to pretend
	 * otherwise: the handle is drawn as a horizontal bar for those, and a height that cannot be
	 * stored is not previewed as if it could.
	 */
	const startSizing = (event: PointerEvent) => {
		if (!props.onResize) return;
		if (event.button !== 0) return;
		// The canvas pans on a press that reaches it, and the frame would take this as a click.
		event.stopPropagation();
		event.preventDefault();
		props.onSelect();

		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const from = { x: event.clientX, y: event.clientY };
		const origin = { w: props.board.w, h: props.board.h };
		const zoom = props.camera.zoom;
		const both = props.board.format === "component";
		let moved = false;

		const move = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== event.pointerId) return;
			moved = true;
			setSizing({
				w: Math.max(320, Math.round(origin.w + (moveEvent.clientX - from.x) / zoom)),
				h: both ? Math.max(200, Math.round(origin.h + (moveEvent.clientY - from.y) / zoom)) : origin.h,
			});
		};

		const finish = (abandon = false) => {
			handle.removeEventListener("pointermove", move as EventListener);
			handle.removeEventListener("pointerup", end as EventListener);
			handle.removeEventListener("pointercancel", end as EventListener);
			const landed = abandon ? null : sizing();
			if (landed && moved) props.onResize?.({ w: landed.w, h: landed.h });
			// Nothing dragged: leave no box behind to wait for a file that is not coming.
			if (abandon || !moved) setSizing(null);
		};
		const end = (endEvent: PointerEvent) => {
			if (endEvent.pointerId !== event.pointerId) return;
			finish();
		};

		handle.addEventListener("pointermove", move as EventListener);
		handle.addEventListener("pointerup", end as EventListener);
		handle.addEventListener("pointercancel", end as EventListener);
	};

	/*
	 * The drag's number is let go of when the board *is* that size, which is when the write has
	 * landed and the frame has reloaded at it. A flow document's height is the browser's to
	 * report and arrives a beat later, so this watches the width there — the height it was
	 * holding is the one it had, and the report replaces it.
	 */
	createEffect(() => {
		const held = sizing();
		if (!held) return;
		const both = props.board.format === "component";
		if (props.board.w === held.w && (!both || props.board.h === held.h)) setSizing(null);
	});

	return (
		<div
			class="board-node"
			data-dragging={dragging()}
			data-selected={props.selected}
			data-inert={inert()}
			data-path={props.board.path}
			style={{
				left: `${at().x}px`,
				top: `${at().y}px`,
				width: `${(sizing()?.w ?? props.board.w)}px`,
				height: `${(sizing()?.h ?? props.board.h)}px`,
			}}
		>
			{/*
				Only for a board that is on screen — `visible`, not `mounted`: a document is
				kept for a moment after its board leaves the screen, and a bar for it would
				be laid out and painted on every zoom step for nothing.

				The bar is the one thing on a board node that has to be redrawn when the
				*zoom* changes and not when the camera merely moves: it is counter-scaled, so
				its width and its offset are both functions of the zoom, and writing them
				dirties layout. That is per board, per frame, for every board on the canvas —
				and it was being paid for boards nobody could see. Measured on a canvas of
				120 boards at 4× CPU throttle: 110ms of work per finger movement while
				pinching, against 51ms while panning, and taking the bars away closed the gap
				entirely (48ms). Off-screen boards do not load their documents for the same
				reason; this is the rest of that rule.
			*/}
			<Show when={props.visible}>
			{/*
				Counter-scaled against the camera, so the title stays legible at any zoom —
				one that shrinks with the board is unreadable exactly when the board is too
				small to identify by its content.

				The scale, the offset and the width are CSS (`index.css`, `.board-node >
				.chrome`), derived from the one number written here: `--zoom`, a registered
				non-inherited property, so a change to it restyles this box and nothing
				beneath it. One write per board per frame of a zoom, and none during a pan —
				`zoom()` is a memo, so a camera that only moved re-runs nothing here.
			*/}
			<div
				class="chrome"
				/*
				 * The size being dragged, like the node and the surface — not the record's, which is the
				 * size the *file* still holds. The bar is the board's own width, so it is the most visible
				 * thing about a resize: leaving it on `props.board.w` meant the board grew and its title
				 * stayed behind, a bar hanging over 60 pixels of nothing until the write landed.
				 */
				style={{ "--zoom": zoom(), width: `${(sizing()?.w ?? props.board.w)}px` }}
				onPointerDown={startDrag}
				onDblClick={() => props.onOpen()}
			>
				<span class="title">{props.board.title}</span>
				<span class="file">{props.board.path}</span>
				{/*
					The right-hand end of the bar, as one group.

					A group rather than two buttons that each ask to be pushed right: two
					`margin-left: auto` siblings *share* the free space, so Present sat in the
					middle of the bar and the × at the end, half a board apart. One auto margin,
					on the box that holds them both.
				*/}
				<span class="acts">
				{/*
					The only thing on a board you cannot get from the keyboard without knowing
					about it. `f` works once the board is selected, and nothing in the app says
					so — a button in the title bar is where somebody looks for "how do I show
					this to a room".

					Every format now, not only a deck: a document is readable fullscreen and a
					component board is usable there, which is the point (`canvas/Present.tsx`).
					The word changes with the format because "present" is what you do with a
					deck and "fullscreen" is what you do with a page.

					**Only a deck gets the word.** The bar is counter-scaled, so at the zoom where
					a board is a tile its buttons take the whole of it — and "Fullscreen" is 64px
					of the 160px a 760px board has down there, which puts an invisible button
					where the *title* is. A double-click meant to fly to the board then presses
					it. A deck's bar is 960px wide and the word is the design's own, so this is
					about the two formats whose bars are narrow rather than about words.

					Not on a live board. A mirror draws itself from what the app posts into it,
					so a second frame of it says nothing the first one does not, and its bar is
					narrow enough that a third button is where the title was.
				*/}
				{/*
					The board on its own, in its own tab.

					A **link** rather than a button with `window.open` in it, and that is the whole
					difference: the address ends up in the page, so it can be copied, middle-clicked
					or opened with a modifier, and the browser's own "open in a new tab" is the
					behaviour rather than an imitation of it.

					No `?rev=`: a tab opened now shows the board as it *is* rather than as it was
					when the canvas last loaded it (`deckFileUrl`). What arrives there is
					browse-only — no canvas, so no camera, no editor and no inspector — and the
					board is clickable at any size, which is not true of the canvas below half zoom.

					Not on a live board: a mirror in a bare tab has nobody to feed it, and says so
					itself (`.live[data-state="alone"]`).
				*/}
				<Show when={!props.board.live}>
					<a
						class="open-tab"
						href={deckFileUrl(props.board.path)}
						target="_blank"
						rel="noopener"
						title="Open this board in its own tab"
						aria-label={`Open ${props.board.title} in its own tab`}
						onPointerDown={(event) => event.stopPropagation()}
					>
						<Icon of={ExternalLink} size={12} />
					</a>
				</Show>
				{/*
					Focus: this board as the page, with the canvas out of the way.
					
					The fourth thing a board's bar offers — beside its file's address, filling the
					window, and going away — and the only one about *reading* rather than about where
					the board is. `BookOpen` rather than a document glyph: the fullscreen button next
					to it is already the frame-corners one, and two squares would be two buttons
					nobody can tell apart.
				*/}
				<Show when={props.onFocus}>
					<button
						class="focus-open"
						type="button"
						data-on={props.focused ? "soft" : undefined}
						aria-pressed={props.focused}
						title={
							props.focused
								? "Back to the canvas (or press d)"
								: "Focus on this board: read and scroll it like a document (or press d)"
						}
						aria-label={props.focused ? `Show the whole canvas instead of ${props.board.title}` : `Focus on ${props.board.title}`}
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							props.onFocus?.();
						}}
					>
						<Icon of={BookOpen} size={12} />
					</button>
				</Show>
				<Show when={Boolean(props.onPresent && !props.board.live)}>
					<button
						class="present-open"
						/* A deck's button is a word and sizes to it; every other board's is a
						   glyph, and a glyph button has to be the same 18px box as the three beside
						   it — which it was not, because `width: auto` plus its padding made it
						   26px while they were 18. The attribute rather than `:has(svg)`: this file
						   already says which one it is drawing, and a selector that re-derives it
						   from the markup is a second answer to the same question. */
						data-glyph={props.board.format === "slides" ? undefined : "true"}
						type="button"
						title={
							props.board.format === "slides"
								? "Present this deck fullscreen (or press f with it selected)"
								: "Fill the window with this board (or press f with it selected)"
						}
						aria-label={`${props.board.format === "slides" ? "Present" : "Fullscreen"} ${props.board.title}`}
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							props.onPresent?.();
						}}
					>
						<Show when={props.board.format === "slides"} fallback={<Icon of={Maximize} size={12} />}>Present</Show>
					</button>
				</Show>
				<Show when={props.onHide}>
					{(hide) => (
						<button
							class="hide"
							type="button"
							title="Take this board off the canvas. The agent keeps it in context."
							aria-label="Take this board off the canvas"
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.stopPropagation();
								hide()();
							}}
						>
							<Icon of={X} size={14} />
						</button>
					)}
				</Show>
				</span>
			</div>
			</Show>

			{/*
				The shadow and the outline, on a box of their own behind the surface. A shadow
				on the surface itself makes Chrome repaint every board's document on every
				step of a pan — see `.board-node > .shade` in `index.css`.
			*/}
			<div class="shade" aria-hidden="true" />

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
					props.onSelect();
					if (inert() && event.pointerType !== "touch") startDrag(event);
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
							<Show when={props.mounted}>{frameNode()}</Show>
						</canvas>
						<Show when={!props.mounted && !drawn()}>
							<div class="placeholder">{props.board.path}</div>
						</Show>
					</Match>
					<Match when={props.renderer === "one-canvas"}>
						{/* The stage draws the board; this box is only the shadow, the bar and the marks. */}
						<Show when={!props.mounted && !props.pictures.has(props.board.path)}>
							<div class="placeholder">{props.board.path}</div>
						</Show>
					</Match>
					<Match when={true}>
						<Show
							when={props.mounted}
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
			</div>

			{/* The sheet the draw tool draws on. Over the surface, so the press never reaches the board. */}
			<Show when={drawing() && props.mounted && inkable() && !props.editing}>
				<InkLayer path={props.board.path} w={props.board.w} h={props.board.h} gestures={props.gestures} />
			</Show>

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
									<span class="say">{mark.label}</span>
								</div>
							)}
						</Show>
					);
				}}
			</For>

			{/* An agent pointing at something, in the board's own coordinates and
			    counter-scaled so the label stays readable however far out you are. */}
			<Show when={props.cursor}>
				{(cursor) => (
					<div
						class="agent-cursor"
						style={{
							left: `${cursor().x}px`,
							top: `${cursor().y}px`,
							"--zoom": zoom(),
							"--cursor-color": cursor().color,
						}}
					>
						<span class="dot" />
						<span class="label">{cursor().label}</span>
					</div>
				)}
			</Show>

			{/*
			 * The resize handle, on the selected board — **one handle, every kind of document**.
			 *
			 * Selected rather than hovered: there is a *write* at the end of this, and the board a press is
			 * about to rewrite is not the same claim as the one a pointer happens to be over. Selection in
			 * this app already means "the board you are working on" — the inspector is showing it, the bar's
			 * focus and fullscreen buttons act on it — and a handle belongs to that sentence rather than to
			 * a passing cursor.
			 *
			 * It used to be a square on a component board and a long flat bar on a flow document or a slide
			 * deck, on the theory that the shape would say how many dimensions the drag would write. It made
			 * the handle a *different object* per format for a difference that is not the handle's to
			 * express: a flow document's height is its content's and a deck's is its aspect's, so those two
			 * drags write the width — and that is decided by the server, which is the only thing that knows
			 * what the file can hold. What the handle says is *where the resize is*, which is the
			 * bottom-right corner in every case.
			 *
			 * The braces are load-bearing, and this is worth knowing before adding another comment here: a
			 * block comment written in the **children** position of JSX is not a comment, it is text. It is
			 * also valid JSX, so the type checker is happy and esbuild strips it — and Solid's compiler, which
			 * is what runs in this app, renders it as a text node. This one put ninety words of source under
			 * eight boards on the canvas. `e2e/checks/geometry.mjs` asserts that nothing drawn on the canvas
			 * came out of a source comment, because the DOM is the only place this is catchable.
			 */
			}
			<Show when={props.onResize && props.selected}>
				<div
					class="sizer"
					/*
					 * `--zoom` here, on this box alone, because that is what `--unit` is derived
					 * from (`index.css`) and a handle on a canvas has to be a handle at every
					 * zoom. On the node instead it would restyle the whole board's subtree on
					 * every step of a pinch; the bar writes it on itself for the same reason.
					 */
					style={{ "--zoom": zoom() }}
					role="separator"
					aria-label={`Resize ${props.board.title}`}
					title="Drag to resize this board"
					onPointerDown={startSizing}
				/>
			</Show>
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
