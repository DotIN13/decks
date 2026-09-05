import type { Board, Camera, StageCall } from "@decks/protocol";
import { anchorPoint, cleanMarks, type Mark } from "./annotations.ts";
import { boxOf, fit } from "../lib/camera.ts";

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
	setCamera(camera: Camera): void;
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
	/** Replace one agent's annotations on one board. An empty list clears them. */
	annotate(agentId: string, path: string, marks: Mark[]): void;
	toast(text: string): void;
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
function defer(call: StageCall, host: StageOpsHost, camera: Camera, selected?: string): { deferred: string } | undefined {
	if (!call.agentId || call.agentId === host.focused()) return undefined;
	host.rememberView(call.agentId, camera, selected);
	return { deferred: "you are not the conversation on screen, so this view is waiting in your chat rather than moving the canvas" };
}

/**
 * A board's own document, or `undefined` if it is not mounted.
 *
 * The same reach `highlight` makes below, and it is the same-origin decision (DESIGN §4)
 * doing real work: a board is served from `/api/board/...` into a frame on this origin, so
 * its DOM is readable without a message protocol.
 */
function boardDoc(path: string): Document | undefined {
	const selector = `.board-node[data-path="${CSS.escape(path)}"] iframe`;
	const frame = document.querySelector(selector) as HTMLIFrameElement | null;
	return frame?.contentDocument ?? undefined;
}

export function runStageCall(call: StageCall, host: StageOpsHost): unknown {
	const args = (call.args ?? {}) as Record<string, unknown>;

	switch (call.op) {
		case "show": {
			const paths = (Array.isArray(args.paths) ? args.paths : []).filter((path): path is string => typeof path === "string");
			const boards = host.boards().filter((board) => paths.includes(board.path));
			if (boards.length === 0) return { error: "none of those boards are on the canvas" };

			const fitAll = args.fit === "all" || boards.length > 1;
			const wanted = fit(fitAll ? boards.map(boxOf) : [boxOf(boards[0]!)], host.viewport());
			const waiting = defer(call, host, wanted, boards[0]!.path);
			if (waiting) return { shown: boards.map((board) => board.path), ...waiting };

			host.setCamera(wanted);
			host.select(boards[0]!.path);

			if (typeof args.highlight === "string") highlight(boards[0]!.path, args.highlight);
			return { shown: boards.map((board) => board.path) };
		}

		case "camera": {
			const { x, y, zoom } = args as { x?: number; y?: number; zoom?: number };
			if (![x, y, zoom].every((value) => typeof value === "number" && Number.isFinite(value))) {
				return { error: "camera needs numeric x, y and zoom" };
			}
			const wanted = { x: x!, y: y!, zoom: zoom! };
			const waiting = defer(call, host, wanted);
			if (waiting) return { camera: wanted, ...waiting };

			host.setCamera(wanted);
			return { camera: { x, y, zoom } };
		}

		case "reload": {
			if (typeof args.path !== "string") return { error: "reload needs a path" };
			host.reload(args.path);
			return { reloaded: args.path };
		}

		case "annotate": {
			if (typeof args.path !== "string") return { error: "annotate needs a path" };
			if (typeof args.agentId !== "string") return { error: "annotate needs an agent" };
			if (!host.boards().some((board) => board.path === args.path)) return { error: `that board is not on the canvas: ${args.path}` };
			/*
			 * Cleaned here rather than on the server, unlike tags. The rules are about *drawing*
			 * — how many bubbles fit, how long a label can be before it stops being a label —
			 * and they belong beside the thing that draws them. The server's job is to know the
			 * board exists, which it does before sending this.
			 */
			const wanted = cleanMarks(args.agentId, args.path, args.marks ?? []);
			/*
			 * Dropped here if the anchor does not resolve, so the number reported back is the
			 * number *drawn*.
			 *
			 * It was the cleaned count, which made `{ annotated: 3, of: 3 }` the answer to three
			 * marks of which one pointed at a `data-id` the board does not have — true about the
			 * request and useless about the result. An agent that mistypes an id should be told,
			 * because the alternative is it believing it has pointed at something.
			 *
			 * The drawing keeps its own guard for the other case: a component that exists now
			 * and is deleted while the bubble is up.
			 */
			const doc = boardDoc(args.path);
			const marks = wanted.filter((mark) => anchorPoint(doc, mark.to) !== undefined);
			host.annotate(args.agentId, args.path, marks);
			const missed = wanted.filter((mark) => !marks.includes(mark)).map((mark) => mark.to);
			return {
				annotated: marks.length,
				of: Array.isArray(args.marks) ? args.marks.length : args.marks ? 1 : 0,
				...(missed.length > 0 ? { notFound: missed } : {}),
			};
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

		case "toast": {
			const text = typeof args.text === "string" ? args.text : "";
			if (text) host.toast(text);
			return { toasted: Boolean(text) };
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
