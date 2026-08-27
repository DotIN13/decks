import type { Board, Camera, StageCall } from "@decks/protocol";
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
	setCamera(camera: Camera): void;
	select(path: string | undefined): void;
	reload(path: string): void;
	cursor(cursor: { path: string; x: number; y: number; label: string; color: string } | null): void;
	toast(text: string): void;
}

export function runStageCall(call: StageCall, host: StageOpsHost): unknown {
	const args = (call.args ?? {}) as Record<string, unknown>;

	switch (call.op) {
		case "show": {
			const paths = (Array.isArray(args.paths) ? args.paths : []).filter((path): path is string => typeof path === "string");
			const boards = host.boards().filter((board) => paths.includes(board.path));
			if (boards.length === 0) return { error: "none of those boards are on the canvas" };

			const fitAll = args.fit === "all" || boards.length > 1;
			host.setCamera(fit(fitAll ? boards.map(boxOf) : [boxOf(boards[0]!)], host.viewport()));
			host.select(boards[0]!.path);

			if (typeof args.highlight === "string") highlight(boards[0]!.path, args.highlight);
			return { shown: boards.map((board) => board.path) };
		}

		case "camera": {
			const { x, y, zoom } = args as { x?: number; y?: number; zoom?: number };
			if (![x, y, zoom].every((value) => typeof value === "number" && Number.isFinite(value))) {
				return { error: "camera needs numeric x, y and zoom" };
			}
			host.setCamera({ x: x!, y: y!, zoom: zoom! });
			return { camera: { x, y, zoom } };
		}

		case "reload": {
			if (typeof args.path !== "string") return { error: "reload needs a path" };
			host.reload(args.path);
			return { reloaded: args.path };
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
