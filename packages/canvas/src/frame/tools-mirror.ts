import { batch, createEffect, createRoot, createSignal, onCleanup, untrack } from "solid-js";
import {
	handTool,
	insertPanel,
	penArrowStyle,
	penBoxes,
	penIcon,
	penLive,
	penOutline,
	penSelection,
	penShape,
	penTool,
	penToolsAt,
	penTyping,
	propsOpen,
	setHandTool,
	setInsertPanel,
	setPenArrowStyle,
	setPenBoxes,
	setPenIcon,
	setPenLive,
	setPenOutline,
	setPenSelection,
	setPenShape,
	setPenTool,
	setPenToolsAt,
	setPenTyping,
	setPropsOpen,
} from "../edit/pen-tools.ts";
import { probes } from "../base/debug.ts";
import { drawing, inkColor, inkSelection, inkTool, inkWidth, penSeen, setDrawing, setInkColor, setInkSelection, setInkTool, setInkWidth, setPenSeen } from "../ink/ink.ts";

/**
 * The tools' state, the same on the page and in the frame, when the page draws the tools.
 *
 * The tool column, the pen tray, the properties panel and the zoom are the app's own chrome, and an
 * app may draw them on its page rather than in the canvas frame (`FramedEditorOptions.pageTools`), so
 * a float can be dragged anywhere on the window and is never cut at the frame's edge. They read and
 * write the same signals wherever they run (`edit/pen-tools.ts`, `ink/ink.ts`): the tool in hand, the
 * selection and where its items are, the pen's colour and width. Each end has its own copy of those
 * signals, and this keeps the two copies in step over the frame's line: a change at either end is
 * said to the other once, and what was heard is not said back.
 *
 * What crosses is only what the tools show and set. A card's script in the frame can say any of it,
 * as it could press the tools while they stood in the frame, so the page treats it as it treats the
 * frame's selection: something to show, never something to act on by itself.
 */

/** One value kept in step: read and written at each end, and whose copy the other end starts from. */
interface Mirrored {
	read: () => unknown;
	write: (value: never) => void;
	/** The end whose value both start with: the page keeps the tools from one canvas to the next, the frame knows the selection. */
	owner: "page" | "frame";
	/** As it crosses, where it is not plain data already (a map). */
	out?: (value: never) => unknown;
	back?: (value: never) => unknown;
}

type Box = { x: number; y: number; w: number; h: number };

/** The zoom as the frame's camera has it at each step, for the page's zoom reading: the page's own camera hears only where a move comes to rest. */
const [frameZoom, setFrameZoom] = createSignal<number | undefined>();
export { frameZoom };

const MIRRORED: Record<string, Mirrored> = {
	tool: { read: penTool, write: setPenTool, owner: "page" },
	hand: { read: handTool, write: setHandTool, owner: "page" },
	shape: { read: penShape, write: setPenShape, owner: "page" },
	icon: { read: penIcon, write: setPenIcon, owner: "page" },
	arrow: { read: penArrowStyle, write: setPenArrowStyle, owner: "page" },
	insert: { read: insertPanel, write: setInsertPanel, owner: "page" },
	props: { read: propsOpen, write: setPropsOpen, owner: "page" },
	ink: { read: drawing, write: setDrawing, owner: "page" },
	inkTool: { read: inkTool, write: setInkTool, owner: "page" },
	inkColor: { read: inkColor, write: setInkColor, owner: "page" },
	inkWidth: { read: inkWidth, write: setInkWidth, owner: "page" },
	live: { read: penLive, write: setPenLive, owner: "page" },
	toolsAt: { read: penToolsAt, write: setPenToolsAt, owner: "page" },
	selection: { read: penSelection, write: setPenSelection, owner: "frame" },
	boxes: { read: penBoxes, write: setPenBoxes, owner: "frame", out: (boxes: ReadonlyMap<string, Box>) => [...boxes], back: (entries: Array<[string, Box]>) => new Map(entries) },
	typing: { read: penTyping, write: setPenTyping, owner: "frame" },
	inkSelection: { read: inkSelection, write: setInkSelection, owner: "frame" },
	// The page remembers that a pencil has touched this device (the frame has no storage of its own), and the frame sees the next one.
	penSeen: { read: penSeen, write: setPenSeen, owner: "page" },
	outline: { read: penOutline, write: setPenOutline, owner: "frame" },
	zoom: { read: frameZoom, write: setFrameZoom, owner: "frame" },
};

/** One end of the frame's line, as far as the mirror uses it. */
interface MirrorEnd {
	emit(name: "tools", data: Record<string, unknown>): void;
	on(name: "tools", handler: (data: Record<string, unknown>) => void): void;
}

/** What only the frame can say: its camera's zoom at each step, and where the selection's outline is on its screen. */
export interface FrameSide {
	zoom: () => number;
}

/**
 * Keep this end's tools in step with the other's, until the function given back is called. The frame
 * also says what only it knows (`FrameSide`); the page moves what the frame says of its own screen to
 * where the frame is on the page (`frameAt`).
 */
export function mirrorTools(side: "page" | "frame", end: MirrorEnd, own: { frame?: FrameSide; frameAt?: () => { x: number; y: number } | undefined } = {}): () => void {
	return createRoot((dispose) => {
		/** The last of each said or heard, as JSON: what is the same again is not said. */
		const last = new Map<string, string>();
		const wire = (one: Mirrored, value: unknown) => (one.out && value !== undefined ? one.out(value as never) : value);
		/*
		 * What changed in one go is said in one message, and taken in one go at the other end: a shape
		 * picked and the shape tool armed by the same press arrive together, so a press on the canvas
		 * straight after never finds the tool armed with the shape before.
		 */
		let saying: Record<string, unknown> | undefined;
		const say = (key: string, value: unknown) => {
			if (!saying) {
				saying = {};
				queueMicrotask(() => {
					const all = saying!;
					saying = undefined;
					end.emit("tools", all);
				});
			}
			saying[key] = value;
		};
		for (const [key, one] of Object.entries(MIRRORED)) {
			let first = true;
			createEffect(() => {
				const value = wire(one, one.read());
				const json = JSON.stringify(value ?? null);
				const opening = first;
				first = false;
				if (last.get(key) === json) return;
				last.set(key, json);
				// At the start each end says what is its own to know; the rest it takes from the other.
				if (opening && one.owner !== side) return;
				say(key, value ?? null);
			});
		}
		end.on("tools", (data) => batch(() => {
			for (const [key, sent] of Object.entries(data)) {
				const one = MIRRORED[key];
				if (!one) continue;
				let value: unknown = sent ?? undefined;
				// The outline is on the frame's screen: on the page it is where the frame is, plus that.
				if (key === "outline" && value && side === "page") {
					const at = own.frameAt?.();
					const box = value as { left: number; top: number; right: number; bottom: number };
					if (at) value = { left: box.left + at.x, right: box.right + at.x, top: box.top + at.y, bottom: box.bottom + at.y };
				}
				last.set(key, JSON.stringify(sent ?? null));
				const here = JSON.stringify(wire(one, untrack(one.read)) ?? null);
				if (here === JSON.stringify(sent ?? null) && key !== "outline") continue;
				(one.write as (value: unknown) => void)(one.back && value !== undefined ? one.back(value as never) : value);
			}
		}));
		if (side === "frame" && own.frame) sayFrameSide(own.frame);
		// For the checks: what this end has, by the names it crosses under.
		if (side === "frame") probes.frameTools = () => Object.fromEntries(Object.entries(MIRRORED).map(([key, one]) => [key, wire(one, untrack(one.read)) ?? null]));
		return dispose;
	});
}

/**
 * What the frame says of its own screen: the zoom, rounded to a percent so a pinch says it a few
 * dozen times and not at every frame; and the selection's outline, measured when the selection or
 * its boxes change and when a press or a touch ends, which is when the page's properties popover
 * places itself beside it (`ui/properties/placement.ts`).
 */
function sayFrameSide(frame: FrameSide): void {
	createEffect(() => setFrameZoom(Math.round(frame.zoom() * 100) / 100));
	const measure = () => {
		const outline = document.querySelector(".world > .pen-selection, .world > .pen-selection-box")?.getBoundingClientRect();
		setPenOutline(outline && outline.width > 0 ? { left: outline.left, top: outline.top, right: outline.right, bottom: outline.bottom } : undefined);
	};
	createEffect(() => {
		penSelection();
		penBoxes();
		queueMicrotask(measure);
	});
	const settle = () => setTimeout(measure, 0);
	addEventListener("resize", measure);
	addEventListener("pointerup", settle, true);
	addEventListener("touchend", settle, true);
	onCleanup(() => {
		removeEventListener("resize", measure);
		removeEventListener("pointerup", settle, true);
		removeEventListener("touchend", settle, true);
	});
}
