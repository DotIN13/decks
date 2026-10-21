import { attachBoardStorage, SHARED_SANDBOX, storageHash, storageKeeper } from "./board-storage.ts";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { BoardHost } from "./board-host.ts";
import type { StageBoardProps } from "./board-slot.ts";
import { INTERACT_ZOOM } from "./camera/camera.ts";
import { pointFromBoard, type FrameAt } from "./camera/coords.ts";

const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** The band along a live board's edge that moves it, in screen pixels outside the border and inside it (as `BoardFrame`). */
const EDGE_OUT_PX = COARSE ? 16 : 8;
const EDGE_IN_PX = COARSE ? 6 : 4;
/** Fingers reported from a board's page get ids of their own, clear of the stage's (as `board.js` gives an embed's). */
let nextFinger = 800001;

/** A page's address without its ticket (`decks_ticket`), to tell a new ticket from a new page. */
function withoutTicket(address: string): string {
	// A friend's board's folder ticket rides in the path (`/api/t/<ticket>/board/…`): the same page under a new ticket.
	address = address.replace(/\/api\/t\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/board\//, "/api/t/-/board/");
	if (!address.includes("decks_ticket=")) return address;
	try {
		const url = new URL(address, location.href);
		url.searchParams.delete("decks_ticket");
		return url.toString();
	} catch {
		return address;
	}
}

/**
 * A board as a host with no board editor draws it: its page in a frame while the stage lets it
 * have one, and nothing otherwise, since the stage's sheet draws every board without a page as
 * its picture (`StageShots.picture`).
 *
 * The Decks app draws boards with `board/BoardFrame.tsx`, which edits a board's own document,
 * runs live chats and takes file drops; this is the part of it that is the canvas's, with the same
 * rules for the pointer. Below the live zoom a board is a tile: a press picks it up, a drag moves
 * it, a scroll over it pans. At the live zoom its page is used directly, and the board moves by its
 * title bar or the band along its edge.
 *
 * A host's page is usually from another origin, so nothing here can listen inside it as
 * `frame-gestures.ts` does. The board's own runtime (`board.js`) loads `embed-guest.js` when its
 * parent is another origin, and that posts up what the canvas should have: a scroll nothing in the
 * page can take, a pinch, fingers, Space and a middle-drag. They are replayed here to the stage.
 * Until the page says it does that (`decks:embed-ready`) it does not take the pointer, so a pinch
 * over it never zooms the browser's page instead of the canvas.
 */
/** Where sandboxed boards' storage is kept: this page's own `localStorage` (`board-storage.ts`). */
const sandboxKeeper = storageKeeper(typeof localStorage === "undefined" ? undefined : localStorage, "decks.board-storage:");

/** A sandboxed board's address with its storage after the `#`, so it reads it as it starts. */
function withStorage(address: string | undefined, key: string): string | undefined {
	return address === undefined ? undefined : `${address.split("#")[0]}${storageHash(sandboxKeeper.read(key))}`;
}

export function PlainBoard(props: StageBoardProps & { page?: string | undefined; boardHost?: BoardHost | undefined; sandboxed?: { key: () => string } | undefined }) {
	const at = createMemo(() => {
		const resized = props.view.resized();
		return props.origin ?? { x: resized?.x ?? props.board.x, y: resized?.y ?? props.board.y };
	});
	const size = () => {
		const resized = props.view.resized();
		return { w: resized?.w ?? props.board.w, h: resized?.h ?? props.board.h };
	};
	const shift = () => {
		const by = props.view.shift();
		return by ? `translate(${by.dx}px, ${by.dy}px)` : undefined;
	};
	/** A press on the board, its bar or its edge: the editor takes it as a move of the selection, or it selects the board. */
	const press = (event: PointerEvent) => {
		if (event.button !== 0) return;
		if (event.pointerType !== "touch" && props.view.press(event)) return;
		props.view.select();
	};
	const zoom = () => props.camera.zoom;
	const live = () => props.mounted && props.page !== undefined;
	/*
	 * The address the frame keeps while it is up. A host that admits each page by a short-lived ticket
	 * in its address (`decks_ticket`, Studio's) hands a new address every few minutes for the same
	 * page; a loaded page needs no fresh ticket, and giving the frame the new address would reload it.
	 * So an address that differs only in its ticket keeps the one the frame was first given, until the
	 * frame goes and is made again, which then takes the address of the moment.
	 */
	const src = createMemo<string | undefined>((given) => {
		if (!live()) return undefined;
		const next = props.page;
		return given !== undefined && next !== undefined && withoutTicket(given) === withoutTicket(next) ? given : next;
	});
	/*
	 * Below the live zoom a board is a tile to pan across and to pick up by its body, selected or not.
	 * `BoardFrame` makes the selected one live at any zoom, and there the drag that selects a tile
	 * makes the next drag a press on its page, so a tile moves once and then not again.
	 */
	const inert = createMemo(() => zoom() < INTERACT_ZOOM);
	const [hovered, setHovered] = createSignal(false);
	createEffect(() => props.view.hover(hovered()));
	/** The page has loaded and said it hands the canvas its gestures: only then does it take the pointer. */
	const [guest, setGuest] = createSignal(false);
	createEffect(() => {
		if (!live()) setGuest(false);
	});
	const wired = () => live() && guest() && !inert();

	let frame: HTMLIFrameElement | undefined;
	/** Where the page is on the stage, from the camera: the frame sits at the board's corner, drawn at the zoom. */
	const geometry = (): FrameAt => {
		const on = props.gestures.screenOf(at());
		return { left: on.x, top: on.y, scale: on.scale };
	};
	/** Words selected in the page, as it said (`board.js`), in the page's pixels: a comment is offered on them. */
	const [words, setWords] = createSignal<{ quote: string; component?: string; rect: { x: number; y: number; w: number; h: number } }>();
	createEffect(() => {
		if (!wired() || !props.onCommentWords) setWords(undefined);
	});
	/** Where the words are on the screen now, from where the frame is drawn: the camera may have moved since. */
	const wordsOnScreen = (): DOMRect | undefined => {
		const w = words();
		if (!w || !frame) return undefined;
		const r = frame.getBoundingClientRect();
		const scale = r.width / Math.max(1, size().w);
		return new DOMRect(r.left + w.rect.x * scale, r.top + w.rect.y * scale, w.rect.w * scale, w.rect.h * scale);
	};
	/** The page's fingers -> the ones the stage is told about. */
	const fingers = new Map<number, number>();
	let panFrom: { sx: number; sy: number } | undefined;
	const onMessage = (event: MessageEvent) => {
		if (!frame || event.source !== frame.contentWindow) return;
		const message = event.data as Record<string, unknown> | null;
		if (!message || typeof message !== "object") return;
		const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
		switch (message.t) {
			case "decks:embed-ready":
				setGuest(true);
				return;
			case "decks:selection": {
				const quote = typeof message.quote === "string" ? message.quote : "";
				const rect = message.rect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined;
				if (!quote || !rect || !props.onCommentWords) return setWords(undefined);
				setWords({ quote, ...(typeof message.component === "string" ? { component: message.component } : {}), rect: { x: num(rect.x), y: num(rect.y), w: num(rect.w), h: num(rect.h) } });
				return;
			}
			case "decks:wheel": {
				const point = pointFromBoard(geometry(), num(message.x), num(message.y));
				const zooming = message.zooming === true;
				props.gestures.wheel({ x: point.x, y: point.y, deltaX: num(message.dx), deltaY: num(message.dy), zooming, pinch: zooming });
				return;
			}
			case "decks:scroll-ask": {
				// A box in the page scrolls by the wheel's screen pixels turned into the page's at this zoom.
				const scale = geometry().scale || 1;
				frame.contentWindow?.postMessage({ t: "decks:scroll", id: message.id, dx: num(message.dx) / scale, dy: num(message.dy) / scale }, "*");
				return;
			}
			case "decks:space":
				props.gestures.space(message.held === true);
				return;
			case "decks:pointer": {
				const now = { sx: num(message.sx), sy: num(message.sy) };
				if (message.phase === "down") panFrom = now;
				else if (panFrom) {
					props.gestures.pan(now.sx - panFrom.sx, now.sy - panFrom.sy);
					panFrom = message.phase === "up" ? undefined : now;
				}
				return;
			}
			case "decks:touch": {
				const phase = message.phase;
				if (phase !== "down" && phase !== "move" && phase !== "up") return;
				const raw = num(message.id);
				let id = fingers.get(raw);
				if (id === undefined) {
					if (phase !== "down") return;
					id = nextFinger++;
					fingers.set(raw, id);
				}
				const point = pointFromBoard(geometry(), num(message.x), num(message.y));
				props.gestures.touch(phase, { id, x: point.x, y: point.y });
				if (phase === "up") fingers.delete(raw);
				return;
			}
		}
	};
	window.addEventListener("message", onMessage);
	/*
	 * A click inside the page selects the board, as a press on a Decks board does. The page is another
	 * document and its pointer events never reach this one, but the focus going into its frame does.
	 */
	const onBlur = () =>
		queueMicrotask(() => {
			if (frame && document.activeElement === frame && !props.selected) props.view.select();
		});
	window.addEventListener("blur", onBlur);
	onCleanup(() => {
		window.removeEventListener("message", onMessage);
		window.removeEventListener("blur", onBlur);
		for (const id of fingers.values()) props.gestures.touch("up", { id, x: 0, y: 0 });
		fingers.clear();
	});

	/** Where an edge band sits, in board units: `EDGE_OUT_PX` outside the border and `EDGE_IN_PX` in. */
	const edgeBand = (side: "n" | "s" | "w" | "e") => {
		const out = EDGE_OUT_PX / zoom();
		const band = (EDGE_OUT_PX + EDGE_IN_PX) / zoom();
		const along = side === "n" || side === "s";
		return {
			left: side === "e" ? `calc(100% + ${out}px - ${band}px)` : `${-out}px`,
			top: side === "s" ? `calc(100% + ${out}px - ${band}px)` : `${-out}px`,
			width: along ? `calc(100% + ${2 * out}px)` : `${band}px`,
			height: along ? `${band}px` : `calc(100% + ${2 * out}px)`,
		};
	};

	/*
	 * The stage's sheet draws a board's picture until the board says its page is showing
	 * (`onLive`), and again once it is gone: said on the page's load, and when it is unmounted.
	 */
	let said = false;
	const say = (on: boolean) => {
		if (on === said) return;
		said = on;
		props.onLive?.(on);
	};
	createEffect(() => {
		if (!live()) say(false);
	});
	onCleanup(() => say(false));
	return (
		<div
			class="board-node plain-board"
			data-path={props.board.path}
			data-selected={props.selected}
			data-inert={inert() || !live()}
			data-carried={props.carried ? "" : undefined}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			style={{
				left: `${at().x}px`,
				top: `${at().y}px`,
				transform: shift(),
				width: `${size().w}px`,
				height: `${size().h}px`,
			}}
		>
			<div class="shade" aria-hidden="true" />
			<Show when={props.visible}>
				<div class="plain-board-bar" title={props.board.path} onPointerDown={press} onDblClick={() => props.onOpen()}>
					{props.board.title}
				</div>
			</Show>
			{/* The band along the edge of a board whose page takes the pointer: a press on the page is the page's, so this moves it. */}
			<Show when={wired() && (hovered() || props.selected)}>
				<For each={["n", "s", "w", "e"] as const}>{(side) => <div class="board-edge" data-side={side} style={edgeBand(side)} onPointerDown={press} />}</For>
			</Show>
			{/* Over the selected words, at screen size whatever the zoom: a comment on them goes to the host. */}
			<Show when={words()}>
				{(w) => (
					<button
						type="button"
						class="plain-board-comment"
						style={{ left: `${w().rect.x + w().rect.w / 2}px`, top: `${w().rect.y}px`, transform: `translate(-50%, calc(-100% - 6px)) scale(${1 / zoom()})`, "transform-origin": "50% 100%" }}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => {
							const got = w();
							props.onCommentWords?.({ quote: got.quote, ...(got.component ? { component: got.component } : {}), anchor: wordsOnScreen });
							setWords(undefined);
						}}
					>
						Comment
					</button>
				)}
			</Show>
			<div class="surface" style={{ width: `${size().w}px`, height: `${size().h}px` }} onPointerDown={(event) => !wired() && press(event)}>
				<Show when={live()}>
					<iframe
						ref={(element) => {
							frame = element;
							// Its board's own token, for the board's buttons, handed to this frame alone (`board-host.ts`);
							// a friend's board, sandboxed, has none, and its storage is kept here (`board-storage.ts`).
							const detach = props.sandboxed ? attachBoardStorage(element, props.sandboxed.key, sandboxKeeper) : props.boardHost?.attach(element, { path: () => props.board.path, page: src });
							if (detach) onCleanup(detach);
						}}
						class="plain-board-page"
						src={props.sandboxed ? withStorage(src(), props.sandboxed.key()) : src()}
						sandbox={props.sandboxed ? SHARED_SANDBOX : undefined}
						onLoad={() => say(live())}
						data-wired={wired() ? "" : undefined}
						title={props.board.title}
						data-path={props.board.path}
						style={{ width: "100%", height: "100%", border: "0" }}
					/>
				</Show>
			</div>
		</div>
	);
}
