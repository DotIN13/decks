import type { Camera } from "@decks/protocol";
import { boxOf, zoomAbout, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/**
 * `v`, select: the one palette key left. The tools that add things are the stage's own now, armed
 * by `PEN_TOOL_KEYS` (`state/pen-tools.ts`); the ones that inserted components into a board are gone.
 */
const TOOL_KEYS: Record<string, "select"> = { v: "select" };

/** What `createShortcut` reads of `createViewInput` (`input.ts`), each read when it is used. */
export interface ShortcutNeeds {
	readonly props: CanvasViewProps;
	readonly pushCamera: (cam: Camera) => void;
	readonly frame: (boxes: Array<{ x: number; y: number; w: number; h: number; }>) => Camera;
	readonly ctl: CameraController;
	readonly view: () => Viewport;
	readonly centre: () => { x: number; y: number; };
}

export function createShortcut(d: ShortcutNeeds) {
	/**
	 * The camera shortcuts, and the palette's one key, in one place. Returns whether the key meant
	 * anything, so the caller knows to swallow it.
	 */
	const shortcut = (key: string): boolean => {
		const tool = TOOL_KEYS[key];
		if (tool && d.props.onTool) {
			d.props.onTool(tool);
			return true;
		}
		switch (key) {
			case "0":
				d.pushCamera(d.frame(d.props.boards.map(boxOf)));
				return true;
			case "1": {
				const board = d.props.boards.find((candidate) => candidate.path === d.props.selected) ?? d.props.boards[0];
				if (board) d.pushCamera(d.frame([boxOf(board)]));
				return true;
			}
			case "+":
			case "=":
				d.pushCamera(zoomAbout(d.ctl.now(), d.view(), d.centre(), 1.2));
				return true;
			case "-":
				d.pushCamera(zoomAbout(d.ctl.now(), d.view(), d.centre(), 1 / 1.2));
				return true;
			default:
				return false;
		}
	};

	return {
		shortcut,
	};
}
