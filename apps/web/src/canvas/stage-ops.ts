import type { Board, Camera, StageCall } from "@decks/protocol";
import { boxOf, fit } from "../camera/camera.ts";

/**
 * What the browser does when an agent asks something of the canvas.
 *
 * These are the operations only the browser can carry out — the camera, the
 * highlight, the pointer. Everything an agent can be told from the server (which
 * boards exist, what one says) never gets here.
 *
 * Highlighting reaches into the board's own document and sets `data-selected` on the
 * component, which `board.css` already styles. That is the same-origin decision
 * (DESIGN §4) doing real work: no message protocol, no cooperation from the board,
 * three lines.
 */

export interface StageOpsHost {
	boards(): Board[];
	viewport(): { width: number; height: number };
	/** Which conversation is on screen, so an op that moves the view can tell whose it is. */
	focused(): string | undefined;
	/** The canvas on this screen, by folder name. */
	stageOnScreen?(): string | undefined;
	/** A conversation on that canvas, `prefer` first when it is on it. */
	agentOn?(stage: string, prefer?: string): string | undefined;
	/** Show that conversation, and so its canvas (`view.goto`). */
	goto?(agentId: string): void;
	/** Offer a button that goes there instead. */
	offerGoto?(agentId: string, stage: string, target: string): void;
	/**
	 * Move the view, and *arrive* at it when the caller asked for that.
	 *
	 * `animate` is the agent's own request — `stage.show(paths, { animate: true })` — and it is off
	 * by default, which is not an oversight: an op is a statement about where to look, and the
	 * people reading this file's checks measure it a frame later. A gesture is the other way round
	 * (`App.tsx`), because a click *is* about the journey to what was clicked.
	 */
	setCamera(camera: Camera, options?: { animate?: boolean }): void;
	/** The person has used the canvas in the last few seconds (`camera/touched.ts`): the view is theirs. */
	handsOn?(): boolean;
	/** Offer the held view instead: a notice whose button moves there (`state/notices.ts`, `offer`). */
	offerView?(agentId: string, camera: Camera, selected: string | undefined, what: "board" | "view"): void;
	/**
	 * Keep a view for an agent that is not the one on screen.
	 *
	 * Not applied — remembered against that agent, so it arrives framed as it intended the
	 * moment you open that chat. The same store `focusAgent` parks the live view in.
	 */
	rememberView(agentId: string, camera: Camera, selected?: string): void;
	select(path: string | undefined): void;
	reload(path: string): void;
	cursor(cursor: { path: string; x: number; y: number; label: string; color: string } | null): void;
}

/**
 * A background agent's view waits for you, and it is told that it is waiting.
 *
 * The canvas is per conversation — it draws the focused agent's in-play set and nothing else
 * — and the camera has to follow the same rule or it is the one part of the view an agent
 * you are not watching can reach into. It could, and did: an agent working in another corner
 * of the deck flew your camera to a board that was not drawn on your canvas at all, which is
 * an empty view arriving while you sit still.
 *
 * So the fit is *remembered against that agent* rather than applied, and `viewOnSwitch` hands
 * it to you when you open that chat. Returns the sentence to put in the agent's result, or
 * nothing when the agent asking is the one on screen and the op should simply happen.
 */
function defer(call: StageCall, host: StageOpsHost, camera: Camera, selected?: string, what: "board" | "view" = "view"): { deferred: string } | undefined {
	/*
	 * And the agent on screen waits too while the person is using the canvas: a view pulled out from
	 * under someone reading or dragging is the same intrusion. Nothing is remembered for later, since
	 * this is their conversation already; the board is on the stage where it was put.
	 */
	if (call.agentId && call.agentId === host.focused() && host.handsOn?.()) {
		host.offerView?.(call.agentId, camera, selected, what);
		return { deferred: "the person is using the canvas, so the view stayed where they had it and they were offered a button to go there" };
	}
	if (!call.agentId || call.agentId === host.focused()) return undefined;
	host.rememberView(call.agentId, camera, selected);
	return { deferred: "you are not the conversation on screen, so this view is waiting in your chat rather than moving the canvas" };
}

export function runStageCall(call: StageCall, host: StageOpsHost): unknown {
	const args = (call.args ?? {}) as Record<string, unknown>;

	switch (call.op) {
		case "show": {
			// A canvas named (`view.focus`) that is not the one on this screen: nothing here to move to.
			if (typeof args.stage === "string" && host.stageOnScreen && host.stageOnScreen() !== args.stage) {
				return { shown: [], deferred: "the person's screen shows another canvas; decks view goto brings it to this one first" };
			}
			const paths = (Array.isArray(args.paths) ? args.paths : []).filter((path): path is string => typeof path === "string");
			const boards = host.boards().filter((board) => paths.includes(board.path));
			/*
			 * Drawn items arrive as boxes the server measured off the stage's layout, because an
			 * item's id means nothing to this file: the drawing is painted on a canvas, not
			 * mounted, so there is no node to look up. They frame like a board and are not
			 * selected — selection here means a *board*, and an item has its own on the stage.
			 */
			const items = (Array.isArray(args.items) ? args.items : []).filter(
				(item): item is { id: string; box: { x: number; y: number; w: number; h: number } } =>
					Boolean(item) && typeof (item as { id?: unknown }).id === "string" && typeof (item as { box?: { w?: unknown } }).box?.w === "number",
			);
			if (boards.length === 0 && items.length === 0) return { error: "none of those boards are on the canvas" };

			const shown = [...boards.map((board) => board.path), ...items.map((item) => item.id)];
			const boxes = [...boards.map(boxOf), ...items.map((item) => item.box)];
			const fitAll = args.fit === "all" || boxes.length > 1;
			const wanted = fit(fitAll ? boxes : [boxes[0]!], host.viewport());
			const waiting = defer(call, host, wanted, boards[0]?.path, "board");
			if (waiting) return { shown, ...waiting };
			host.setCamera(wanted, { animate: args.animate === true });
			if (boards[0]) host.select(boards[0].path);

			if (typeof args.highlight === "string" && boards[0]) highlight(boards[0].path, args.highlight);
			return { shown };
		}

		case "camera": {
			const { x, y, zoom } = args as { x?: number; y?: number; zoom?: number };
			if (![x, y, zoom].every((value) => typeof value === "number" && Number.isFinite(value))) {
				return { error: "camera needs numeric x, y and zoom" };
			}
			const wanted = { x: x!, y: y!, zoom: zoom! };
			const waiting = defer(call, host, wanted);
			if (waiting) return { camera: wanted, ...waiting };

			host.setCamera(wanted, { animate: args.animate === true });
			return { camera: { x, y, zoom } };
		}

		case "reload": {
			if (typeof args.path !== "string") return { error: "reload needs a path" };
			// Counted (`view.reload`): this page reloads the board only if its canvas shows it.
			if (args.count === true) {
				if (typeof args.stage === "string" && host.stageOnScreen && host.stageOnScreen() !== args.stage) return { pages: 0 };
				if (!host.boards().some((board) => board.path === args.path)) return { pages: 0 };
				host.reload(args.path);
				return { reloaded: args.path, pages: 1 };
			}
			host.reload(args.path);
			return { reloaded: args.path };
		}

		case "goto": {
			const stage = args.stage;
			if (typeof stage !== "string" || !stage) return { error: "goto needs a canvas" };
			if (host.stageOnScreen?.() === stage) return { moved: true, note: "the person's screen was on that canvas already" };
			const target = host.agentOn?.(stage, call.agentId);
			if (!target || !host.goto) return { moved: false, note: "no conversation is on that canvas, and a screen shows a canvas beside a conversation: decks agent update --canvas makes it your home, then view goto shows it" };
			// Someone else's call, or the person mid-gesture: offered, not done.
			if (call.agentId !== host.focused() || host.handsOn?.()) {
				host.offerGoto?.(call.agentId, stage, target);
				return { moved: false, deferred: "the person was offered a button to go there, since the screen is theirs right now" };
			}
			host.goto(target);
			return { moved: true };
		}

		case "cursor": {
			if (typeof args.path !== "string") return { error: "cursor needs a path" };
			const at = args.at as { x?: number; y?: number } | null;
			host.cursor(
				at && typeof at.x === "number" && typeof at.y === "number"
					? {
							path: args.path,
							x: at.x,
							y: at.y,
							label: typeof args.label === "string" ? args.label : "agent",
							color: typeof args.color === "string" ? args.color : "var(--color-accent)",
						}
					: null,
			);
			return { cursor: at ? "shown" : "cleared" };
		}

		default:
			return { error: `unknown stage operation: ${call.op}` };
	}
}

/** Outline one component inside a board, and take it off again on its own. */
let clearLast: { run: () => void } | undefined;

export function highlight(path: string, id: string): void {
	clearLast?.run();
	clearLast = undefined;

	const frame = document.querySelector<HTMLIFrameElement>(`.board-node[data-path="${cssEscape(path)}"] iframe`);
	const target = frame?.contentDocument?.querySelector<HTMLElement>(`[data-id="${cssEscape(id)}"]`);
	if (!target) return;

	target.dataset.selected = "true";
	const timer = setTimeout(() => {
		delete target.dataset.selected;
		clearLast = undefined;
	}, 6000);
	clearLast = {
		run: () => {
			clearTimeout(timer);
			delete target.dataset.selected;
		},
	};
}

/** `CSS.escape` is everywhere it matters, but a board path is user data either way. */
function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function"
		? CSS.escape(value)
		: value.replace(/["\\]/g, "\\$&");
}
