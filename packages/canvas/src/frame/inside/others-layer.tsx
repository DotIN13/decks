import { For, Show, createMemo, type JSX } from "solid-js";
import { m } from "@decks/i18n";
import { AgentCursor } from "../../ui/AgentCursor.tsx";
import type { FrameContext } from "./boot.ts";

/** How far a ring round someone else's selection stands off its item, and how wide it is, on the screen: the person's own outline is the 1.5 px next to the item. */
const RING_GAP = 2;
const RING = 1.5;

/**
 * Everyone else on this canvas, drawn in the canvas's world, in two layers: over everything, the agent's
 * cursor, the others' pointers (`presence.ts`) and what agents just drew (`marks.ts`), as
 * `CanvasOptions.world`; and under what the canvas itself paints over the drawing, the others'
 * selections as rings (`CanvasOptions.worldUnder`).
 */
export function createOthersLayer(ctx: FrameContext): { cursors: () => JSX.Element; rings: () => JSX.Element } {
	const { camera, pages, cursor } = ctx;
	/*
	 * The agent's cursor, in the canvas's world (`CanvasOptions.world`): the card's place plus the point on
	 * it, drifting from one place to the next and one size on the screen at any zoom. In the world rather
	 * than over the canvas on a layer of its own, which placed it from the window's middle while the canvas
	 * places the drawing from the column beside the side panel: the cursor stood 180 px from what it pointed
	 * at, and jittered against the drawing at every step of a pan, a frame behind the scroll.
	 */
	const cursorAt = () => {
		const at = cursor();
		const card = at ? pages().find((page) => page.path === at.path) : undefined;
		return at && card ? { x: card.x + at.x, y: card.y + at.y, label: at.label, color: at.color } : null;
	};
	/** Everyone else's pointer on this canvas (`presence.ts`), beside the agent's cursor: one list of cursors, each by its key. */
	const others = () => [...(ctx.presence?.present() ?? new Map()).entries()];
	const labelOf = (by: { name?: string; kind: string; harness?: string }) => by.name ?? (by.kind === "agent" ? m.canvas_presence_agent() : by.harness ? m.canvas_presence_elsewhere() : m.canvas_presence_window());
	/** The keys of the cursors to draw, stable while a cursor moves: each `AgentCursor` keeps its element and drifts, rather than being made anew at every point. */
	const pointerKeys = createMemo(() => others().filter(([, one]) => one.pointer || one.leaving).map(([key]) => key), [] as string[], { equals: (was, next) => was.length === next.length && was.every((key, i) => key === next[i]) });
	/** One cursor's point now, or null while it leaves (the cursor fades where it was). */
	const pointerAt = (key: string) => {
		const one = ctx.presence?.present().get(key);
		return one?.pointer ? { x: one.pointer.x, y: one.pointer.y, label: labelOf(one.by), color: one.by.color } : null;
	};
	/**
	 * Everyone else's selection: the boxes of the top-level items they hold, ringed in their colour with
	 * their name. A ring stands clear of the item, outside the person's own outline (which hugs it), with
	 * the item's own corners: a card's are round.
	 */
	const outlines = () => {
		const list: Array<{ key: string; x: number; y: number; w: number; h: number; r: number; color: string; label: string }> = [];
		let items: Array<{ id?: string; type?: string; x?: number; y?: number; width?: number; height?: number }>;
		try {
			items = (ctx.handle().drawn().children ?? []) as unknown as typeof items;
		} catch {
			return list; // The editor is not made yet.
		}
		for (const [key, one] of others()) {
			for (const id of one.selection ?? []) {
				const item = items.find((candidate) => candidate.id === id);
				if (!item || typeof item.x !== "number" || typeof item.y !== "number") continue;
				list.push({ key: `${key}/${id}`, x: item.x, y: item.y, w: item.width ?? 0, h: item.height ?? 0, r: item.type === "browser" ? 12 : 4, color: one.by.color, label: one.by.name ?? (one.by.kind === "agent" ? m.canvas_presence_agent() : m.canvas_presence_window()) });
			}
		}
		return list;
	};
	/*
	 * Others' selections, under what the canvas paints over the drawing (`worldUnder`): the person's own
	 * outline, its handles and its guides are always the ones on top, where a ring drawn over them, in
	 * another colour, read as the selection being someone else's. Placed in canvas units; the world's own
	 * transform scrolls and scales it.
	 */
	const rings = () => (
		<Show when={outlines().length}>
			<div class="frame-presence" style={{ position: "absolute", left: "0", top: "0", "pointer-events": "none" }}>
				<For each={outlines()}>
					{(box) => {
						const out = () => (RING_GAP + RING) / camera().zoom;
						return (
							<div class="frame-presence-outline" style={{ position: "absolute", left: `${box.x - out()}px`, top: `${box.y - out()}px`, width: `${box.w + 2 * out()}px`, height: `${box.h + 2 * out()}px`, border: `${RING / camera().zoom}px solid ${box.color}`, "border-radius": `${box.r + out()}px`, "box-sizing": "border-box" }}>
								<span style={{ position: "absolute", left: "0", bottom: "100%", transform: `scale(${1 / camera().zoom})`, "transform-origin": "0 100%", "will-change": "transform", background: box.color, color: "#fff", font: "600 11px/1.4 system-ui, sans-serif", padding: "1px 6px", "border-radius": "4px 4px 4px 0", "white-space": "nowrap" }}>{box.label}</span>
							</div>
						);
					}}
				</For>
			</div>
		</Show>
	);
	/* Only while a cursor is out, or something an agent just drew: nothing to see, nothing in the world. Over everything else in it. */
	const cursors = () => (
		<Show when={cursorAt() || pointerKeys().length || ctx.marks.list().length}>
			<div class="frame-cursors" style={{ position: "absolute", left: "0", top: "0", "pointer-events": "none", "z-index": "5" }}>
					<Show when={cursorAt()}>
						<AgentCursor cursor={cursorAt()} zoom={camera().zoom} />
					</Show>
					<For each={pointerKeys()}>{(key) => <AgentCursor cursor={pointerAt(key)} zoom={camera().zoom} />}</For>
					{/* What agents just drew: a mark on each item, in its colour, for a moment (`marks.ts`, `styles/marks.css`). */}
					<For each={ctx.marks.list()}>
						{(mark) => <div class="edit-mark" data-kind={mark.kind} style={{ left: `${mark.x}px`, top: `${mark.y}px`, width: `${mark.w}px`, height: `${mark.h}px`, "--act": mark.color, "--zoom": camera().zoom }} />}
					</For>
			</div>
		</Show>
	);
	return { cursors, rings };
}
