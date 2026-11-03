import { probes } from "../../debug.ts";
import { Show, For, createMemo, createRoot } from "solid-js";
import { render } from "solid-js/web";
import { createEditor } from "../../editor.tsx";
import type { Editor } from "../../types.ts";
import type { FrameChromeView } from "../chrome.ts";
import { AgentCursor } from "../../ui/AgentCursor.tsx";
import { openFrame } from "./boot.ts";
import { endLife } from "./life.ts";
import { editorOptions, installHost } from "./options.ts";
import { wireFrame } from "./events.ts";
import { PROTOCOL, peer, type FrameEnd, type Hello, type Start, type StartMessage } from "../protocol.ts";
import { forgetMissing } from "../../items/missing.ts";

/**
 * The canvas, run inside its frame: says `hello` to its parent, takes `start` and the port, reads its
 * drawing from the harness on the canvas token (`backend.ts`), makes the editor, follows the canvas's
 * stream and sends your edits itself. With the page it trades only what is the page's: its chrome, the
 * composer, your storage (`protocol.ts`).
 *
 * What a host answered with a function (a board's address, its picture, its storage) is worked out
 * here from `start`: the files' ticketed address, the pages' trust, the page's kept values.
 *
 * In parts: what the frame holds once started (`boot.ts`), what the host and the editor are told
 * (`options.ts`), and what the frame hears from the harness, the page and the window (`events.ts`).
 */
export function bootFrame(root: HTMLElement, options: { chrome?: FrameChromeView } = {}): void {
	const parent = window.parent;
	if (parent === window) throw new Error("The canvas frame runs inside the app's page.");
	// The canvas's own styles are scoped to it (`canvas.css`, `.decks-canvas`), as the editor's root is.
	root.classList.add("decks-canvas");
	/** The canvas running now, as the way to stop it once it has started. */
	let running: Promise<(() => void) | undefined> = Promise.resolve(undefined);
	const onStart = (event: MessageEvent<StartMessage>) => {
		// Only the parent's answer, with its port: nothing else is read, then or later.
		if (event.source !== parent || event.data?.t !== "start" || !event.ports[0]) return;
		removeEventListener("message", onStart);
		running = run(root, event.data.start, peer(event.ports[0]) as FrameEnd, options.chrome).catch((error: unknown) => {
			console.error(error);
			return undefined;
		});
	};
	/*
	 * The page moves this frame to another of your canvases in place (`reset`), rather than making a new
	 * frame: what this canvas started goes (its editor and engine, its cards, its line, its listeners,
	 * `life.ts`), and the frame says hello again for the next one, keeping what it loaded (its code, the
	 * engine's compiled module). Once the canvas running now has started, so nothing of it is left half
	 * made. Only from the parent; the page decides when, and makes a new frame for a friend's canvas.
	 */
	addEventListener("message", (event) => {
		if (event.source !== parent || (event.data as { t?: string } | null)?.t !== "reset") return;
		removeEventListener("message", onStart);
		running = running.then((stop) => {
			stop?.();
			endLife();
			forgetMissing();
			root.replaceChildren();
			addEventListener("message", onStart);
			parent.postMessage({ t: "hello", protocol: PROTOCOL } satisfies Hello, "*");
			return undefined;
		});
	});
	addEventListener("message", onStart);
	parent.postMessage({ t: "hello", protocol: PROTOCOL } satisfies Hello, "*");
}

/** Run one canvas in the frame, and answer how to stop it: its editor, its views and what they made. */
async function run(root: HTMLElement, start: Start, end: FrameEnd, chrome: FrameChromeView | undefined): Promise<() => void> {
	const ctx = await openFrame(root, start, end, chrome);
	return createRoot((disposeRoot) => {
	const { camera, pages, cursor } = ctx;
	installHost(ctx);

	/*
	 * The agent's cursor, in the stage's world (`CanvasOptions.world`): the card's place plus the point on
	 * it, drifting from one place to the next and one size on the screen at any zoom. In the world rather
	 * than over the canvas on a layer of its own, which placed it from the window's middle while the stage
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
	const labelOf = (by: { name?: string; kind: string; harness?: string }) => by.name ?? (by.kind === "agent" ? "An agent" : by.harness ? "Someone elsewhere" : "Another window");
	/** The keys of the cursors to draw, stable while a cursor moves: each `AgentCursor` keeps its element and drifts, rather than being made anew at every point. */
	const pointerKeys = createMemo(() => others().filter(([, one]) => one.pointer || one.leaving).map(([key]) => key), [] as string[], { equals: (was, next) => was.length === next.length && was.every((key, i) => key === next[i]) });
	/** One cursor's point now, or null while it leaves (the cursor fades where it was). */
	const pointerAt = (key: string) => {
		const one = ctx.presence?.present().get(key);
		return one?.pointer ? { x: one.pointer.x, y: one.pointer.y, label: labelOf(one.by), color: one.by.color } : null;
	};
	/** Everyone else's selection: the boxes of the top-level items they hold, outlined in their colour with their name. */
	const outlines = () => {
		const list: Array<{ key: string; x: number; y: number; w: number; h: number; color: string; label: string }> = [];
		let items: Array<{ id?: string; x?: number; y?: number; width?: number; height?: number }>;
		try {
			items = (ctx.handle().drawn().children ?? []) as unknown as typeof items;
		} catch {
			return list; // The editor is not made yet.
		}
		for (const [key, one] of others()) {
			for (const id of one.selection ?? []) {
				const item = items.find((candidate) => candidate.id === id);
				if (!item || typeof item.x !== "number" || typeof item.y !== "number") continue;
				list.push({ key: `${key}/${id}`, x: item.x, y: item.y, w: item.width ?? 0, h: item.height ?? 0, color: one.by.color, label: one.by.name ?? (one.by.kind === "agent" ? "An agent" : "Another window") });
			}
		}
		return list;
	};
	/**
	 * Where each other person is looking: their camera's viewport in canvas units, when their line said its
	 * size, as a faint dashed box with their name. People elsewhere only: an agent's camera is nobody's eyes,
	 * and your own other window (a person with no name from no other harness) is you, who know where it is.
	 * Cut to the window and half a window round it, so a box from someone zoomed far out is never a layer
	 * many screens wide, which the browser rasterizes coarsely: its cut edges stay off screen.
	 */
	const viewports = () => {
		const list: Array<{ key: string; x: number; y: number; w: number; h: number; color: string; label: string }> = [];
		const me = camera();
		const reach = { w: (innerWidth * 2) / me.zoom, h: (innerHeight * 2) / me.zoom };
		const shown = { x: me.x - reach.w / 2, y: me.y - reach.h / 2, r: me.x + reach.w / 2, b: me.y + reach.h / 2 };
		for (const [key, one] of others()) {
			const cam = one.camera;
			if (!cam || !cam.w || !cam.h || one.by.kind !== "person" || one.leaving) continue;
			if (!one.by.name && !one.by.harness) continue;
			const x = cam.x - cam.w / 2 / cam.zoom;
			const y = cam.y - cam.h / 2 / cam.zoom;
			const left = Math.max(x, shown.x);
			const top = Math.max(y, shown.y);
			const right = Math.min(x + cam.w / cam.zoom, shown.r);
			const bottom = Math.min(y + cam.h / cam.zoom, shown.b);
			if (right <= left || bottom <= top) continue;
			list.push({ key, x: left, y: top, w: right - left, h: bottom - top, color: one.by.color, label: labelOf(one.by) });
		}
		return list;
	};
	/* Only while a cursor, an outline or a viewport is out: nothing to see, nothing in the world. Placed in canvas units; the world's own transform scrolls and scales it. */
	const cursors = () => (
		<>
			{/* Other people's viewports on a layer of their own, under the cursors: a big box shares no layer with an agent's cursor, which stays sharp. */}
			<Show when={viewports().length}>
				<div class="frame-viewports" style={{ position: "absolute", left: "0", top: "0", "pointer-events": "none", "z-index": "4" }}>
					<For each={viewports()}>
						{(box) => (
							<div class="frame-presence-viewport" style={{ position: "absolute", left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, border: `${1 / camera().zoom}px dashed ${box.color}`, "border-radius": `${6 / camera().zoom}px`, "box-sizing": "border-box", opacity: "0.55" }}>
								<span style={{ position: "absolute", left: `${6 / camera().zoom}px`, top: `${6 / camera().zoom}px`, transform: `scale(${1 / camera().zoom})`, "transform-origin": "0 0", color: box.color, font: "600 11px/1.4 system-ui, sans-serif", "white-space": "nowrap", opacity: "0.9" }}>{box.label} is looking here</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		<Show when={cursorAt() || pointerKeys().length || outlines().length || ctx.marks.list().length}>
			<div class="frame-cursors" style={{ position: "absolute", left: "0", top: "0", "pointer-events": "none", "z-index": "5" }}>
					<For each={outlines()}>
						{(box) => (
							<div class="frame-presence-outline" style={{ position: "absolute", left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, border: `${1.5 / camera().zoom}px solid ${box.color}`, "border-radius": `${4 / camera().zoom}px`, "box-sizing": "border-box" }}>
								<span style={{ position: "absolute", left: "0", bottom: "100%", transform: `scale(${1 / camera().zoom})`, "transform-origin": "0 100%", "will-change": "transform", background: box.color, color: "#fff", font: "600 11px/1.4 system-ui, sans-serif", padding: "1px 6px", "border-radius": "4px 4px 4px 0", "white-space": "nowrap" }}>{box.label}</span>
							</div>
						)}
					</For>
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
		</>
	);
	let reread = () => {};
	const editor: Editor = createEditor(editorOptions(ctx, () => reread(), cursors));
	const { handle } = editor;
	ctx.setMade(editor);
	ctx.changed();
	// For the checks: the drawing as this frame has it (a card can read it anyway, with canvas.read).
	probes.frameDrawn = () => handle.drawn();
	probes.frameNews = () => ctx.news();
	probes.frameSelect = (ids) => handle.select(ids);
	probes.frameCamera = () => handle.camera();
	probes.frameState = () => ({ dock: ctx.dock(), agents: Object.keys(ctx.agents()).length, agent: ctx.agent(), cursor: cursor(), pages: pages().length, cardsReads: ctx.cardsReads(), cards: pages().map((page) => ({ path: page.path.split("/").at(-2) ?? page.path, rev: page.rev, sized: page.sized })) });

	reread = wireFrame(ctx).reread;


	if (chrome) {
		const { canWrite, setMode } = ctx;
		// The app's own chrome, here beside the canvas: its tools are this frame's, and nothing of them crosses.
		// Made inside the render's root, so its effects and its parts' onMount run (a float's grip, the pen's state).
		const view = () => chrome({
			handle,
			revision: ctx.revision,
			offer: ctx.offer,
			dismissOffer: () => ctx.setOffer(undefined),
			camera,
			mode: ctx.mode,
			setMode: (next) => {
				if (next === "edit" && !canWrite()) return;
				setMode(next);
			},
			canWrite,
			dark: ctx.dark,
			comment: ctx.comment,
			setComment: ctx.setComment,
			compose: (part) => end.emit("composer", part),
			exportPicture: (ids) => end.emit("export", { ids }),
			narrow: ctx.narrow,
			dock: ctx.dock,
			panel: (name) => end.emit("panel", { name }),
			storage: ctx.storage,
			canvas: start.canvas.name,
		});
		const unrender = render(() => (
			<>
				{editor.surface()}
				{view()}
			</>
		), root);
		return () => {
			unrender();
			editor.dispose();
			disposeRoot();
		};
	}

	/*
	 * No chrome of its own (Studio, until it brings one): the editor's own bars, or none. Nothing of the
	 * tools crosses the frame line: an app's chrome lives in the frame beside the canvas.
	 */
	const unrender = render(() => (
		<>
			{start.look.toolbar ? editor.root() : editor.surface()}
		</>
	), root);
	return () => {
		unrender();
		editor.dispose();
		disposeRoot();
	};
	});
}
