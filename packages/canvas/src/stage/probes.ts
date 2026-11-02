/**
 * What the browser checks ask the stage, and nothing in the app reads: where every board and drawn
 * item is on screen, the frame under a point, and the camera as a transform (`debug.ts`, `probes`).
 * The stage installs them once it has its element; the two that need the editor (`pictureAt`,
 * `cardAt`) stay in the stage.
 */
import type { Board, Camera } from "@decks/protocol";
import type { Frame, Placed } from "@decks/pen";
import { toScreen, type Viewport } from "../camera/camera.ts";
import { probes } from "../debug.ts";

interface ProbeHost {
	element: () => HTMLElement | undefined;
	camera: () => Camera;
	view: () => Viewport;
	placed: () => ReadonlyMap<string, Placed>;
	bounds: () => ReadonlyMap<string, Frame>;
	boards: () => readonly Board[];
	/** The boards drawn as a node (a page), rather than as their picture. */
	rendered: () => ReadonlySet<string>;
	worldAt: (event: { clientX: number; clientY: number }) => { x: number; y: number };
	frameUnder: (world: { x: number; y: number }) => string | null;
}

export function installProbes(host: ProbeHost): void {
	/*
	 * The camera as the world's transform said it before the stage scrolled (`translate(half the
	 * window) scale(zoom) translate(−camera)`), which the checks read and parse; the world's own
	 * transform now holds only the origin and the zoom (`camera/scroll-area.ts`).
	 */
	probes.cameraTransform = () => {
		const c = host.camera();
		const v = host.view();
		return `translate(${v.width / 2}px, ${v.height / 2}px) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;
	};
	/** Where a drawn item is on screen, since most have no click shape to measure. */
	probes.penBox = (id) => {
		const element = host.element();
		const placed = host.placed().get(id);
		if (!placed || !element) return undefined;
		const box = host.bounds().get(id) ?? placed.box;
		const a = toScreen(host.camera(), host.view(), { x: box.x, y: box.y });
		const b = toScreen(host.camera(), host.view(), { x: box.x + box.w, y: box.y + box.h });
		const r = element.getBoundingClientRect();
		return new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y);
	};
	/** The frame a drop at a point on the screen would go into, and its box. */
	probes.frameUnder = (clientX, clientY) => {
		const world = host.worldAt({ clientX, clientY });
		return { frame: host.frameUnder(world), world };
	};
	/** Every board on the canvas and where it is on screen, node or picture. */
	probes.boards = () => {
		const element = host.element();
		if (!element) return [];
		const r = element.getBoundingClientRect();
		const nodes = host.rendered();
		return host.boards().map((board) => {
			const a = toScreen(host.camera(), host.view(), { x: board.x, y: board.y });
			const b = toScreen(host.camera(), host.view(), { x: board.x + board.w, y: board.y + board.h });
			return { path: board.path, node: nodes.has(board.path), rect: new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y) };
		});
	};
}
