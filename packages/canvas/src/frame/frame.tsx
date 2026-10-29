import { createSignal, untrack } from "solid-js";
import { render } from "solid-js/web";
import type { Board } from "@decks/protocol";
import { createEditor, type Editor } from "../mount.tsx";
import { setCanvasHost } from "../host.ts";
import { setDrawing } from "../state/ink.ts";
import { syncTools } from "./ui-sync.ts";
import { PROTOCOL, peer, type FrameEnd, type Hello, type Page, type Rect, type Start, type StartMessage } from "./protocol.ts";

/**
 * The canvas, run inside its frame: says `hello` to its parent, takes `start` and the port, makes the
 * editor from what `start` says, and from then on turns every one of the editor's callbacks into a
 * message to the page and every message from the page into a call on the editor (`protocol.ts`).
 *
 * What a host answered with a function (a board's address, its picture, its storage) is worked out
 * here from `start`: the files' ticketed address, the pages' trust, the page's kept values.
 */
export function bootFrame(root: HTMLElement): void {
	const parent = window.parent;
	if (parent === window) throw new Error("The canvas frame runs inside the app's page.");
	const onStart = (event: MessageEvent<StartMessage>) => {
		// Only the parent's answer, with its port: nothing else is read, then or later.
		if (event.source !== parent || event.data?.t !== "start" || !event.ports[0]) return;
		removeEventListener("message", onStart);
		run(root, event.data.start, peer(event.ports[0]) as FrameEnd);
	};
	addEventListener("message", onStart);
	parent.postMessage({ t: "hello", protocol: PROTOCOL } satisfies Hello, "*");
}

/** A rectangle on this frame's screen, as the page places it (it adds where the frame sits). */
const rectOf = (box: DOMRect | undefined): Rect | undefined => (box ? { x: box.x, y: box.y, w: box.width, h: box.height } : undefined);

function run(root: HTMLElement, start: Start, end: FrameEnd): void {
	const [pages, setPages] = createSignal<Page[]>(start.pages);
	const [news, setNews] = createSignal<Record<string, string>>({});
	const [marks, setMarks] = createSignal<Record<string, Array<{ id: string; quote: string; component?: string }>>>({});
	const [busy, setBusy] = createSignal<{ switching?: boolean; mayStart?: boolean; writer?: { name?: string; color: string } }>({ mayStart: true, ...(start.writer ? { writer: start.writer } : {}) });
	const trust = (path: string) => untrack(pages).find((page) => page.path === path)?.trust ?? (path.startsWith("shared/") ? "friend" : "own");
	const kept = new Map(Object.entries(start.stored));
	/** The page keeps what this frame cannot: it has no storage of its own. */
	const storage = {
		getItem: (key: string) => kept.get(key) ?? null,
		setItem: (key: string, value: string) => {
			kept.set(key, value);
			end.emit("store", { key, value });
		},
	};
	/** A deck path's address, read on the canvas's ticket. */
	const address = (path: string) => `${start.files.base}${path.split("/").map(encodeURIComponent).join("/")}`;
	let restUntil: ReturnType<typeof setTimeout> | undefined;
	/*
	 * What a host answers for the canvas (`host.ts`), from the ticket: a deck file in the drawing is read in
	 * the canvas's own folder, where the deck's `assets/` and `docs/` are served beside it too
	 * (`deck/layout.ts`); a link from a board to another is its deck path, when it is one on this canvas.
	 */
	const folder = `canvases/${start.canvas.name}/`;
	const inFolder = (path: string) => (path.startsWith(folder) || path.startsWith("shared/") ? path : `${folder}${path}`);
	setCanvasHost({
		fileUrl: (path, rev) => `${address(inFolder(path))}${rev === undefined ? "" : `?rev=${rev}`}`,
		canWrite: () => start.canvas.role !== "view" && !start.look.readOnly,
		boardLink: (href, base) => {
			try {
				const url = new URL(href, base);
				return url.href.startsWith(start.files.base) ? decodeURIComponent(url.href.slice(start.files.base.length).split(/[?#]/)[0]!) : undefined;
			} catch {
				return undefined;
			}
		},
	});

	const editor: Editor = createEditor({
		text: start.drawing.text,
		base: start.drawing.base,
		dark: start.look.dark,
		mode: start.look.mode,
		readOnly: start.look.readOnly,
		toolbar: start.look.toolbar,
		...(start.camera ? { camera: start.camera } : {}),
		views: { scope: () => start.canvas.name, storage, key: "frame" },
		canvasName: () => start.canvas.name,
		document: {
			send: (ops, edit) => end.call("send", { ops, ...(edit ? { edit } : {}) }),
			step: (direction, edit) => end.emit("step", { direction, ...(edit ? { edit } : {}) }),
		},
		boards: {
			list: () => pages() as Board[],
			page: (path) => {
				const page = pages().find((one) => one.path === path);
				return page ? `${address(path)}?rev=${page.rev}` : undefined;
			},
			picture: (path, scheme) => {
				const page = untrack(pages).find((one) => one.path === path);
				return `${start.pictures}${path.split("/").map(encodeURIComponent).join("/")}?scheme=${scheme}${page ? `&v=${page.rev}` : ""}`;
			},
			mintBoardToken: async (path) => end.call("token", { path }),
			sandboxed: (path) => trust(path) === "friend",
			cardScripts: (path) => trust(path) !== "friend",
			storageKey: (path) => `${start.canvas.name}\u0000${path}`,
			onExtent: (path, extent) => end.emit("extent", { path, ...extent }),
			onOpenLink: (path, from) => {
				void end.call("open", { path, from });
				return true;
			},
			news: () => news(),
			onRead: (path) => end.emit("seen", { path }),
			mayStart: () => busy().mayStart !== false,
			switching: () => busy().switching === true,
			onStarted: () => end.emit("started", {}),
			onHide: (path) => end.emit("hide", { path }),
			marks: (path) => marks()[path] ?? [],
		},
		// Said once the camera rests, not for every step of a pan: the page keeps it, and the view is drawn here.
		onCamera: (camera) => {
			clearTimeout(restUntil);
			restUntil = setTimeout(() => end.emit("camera", { camera }), 250);
		},
		onSelection: (ids) => end.emit("selection", { ids: [...ids] }),
		onSelect: (path) => end.emit("selection", { ids: [], ...(path ? { page: path } : {}) }),
		onTool: (tool) => end.emit("tool", { tool }),
		onSelectTool: () => end.emit("tool", { tool: "select" }),
		onViewport: (viewport) => end.emit("viewport", viewport),
		onRefer: (pills) => end.emit("refer", { pills }),
		onComment: (comment) => {
			const at = rectOf(comment.anchor());
			end.emit("comment", { path: comment.path, title: comment.title, quote: comment.quote, ...(comment.component ? { component: comment.component } : {}), ...(comment.items ? { items: comment.items } : {}), ...(at ? { at } : {}) });
		},
		onExport: (ids) => end.emit("export", { ids }),
		onPillMore: (on, anchor) => end.emit("menu", { ...on, at: rectOf(anchor)! }),
		onInk: (request) => end.emit("ink", { action: request.action, ids: request.ids, canvas: request.canvas, box: request.box }),
		inkAgent: () => busy().writer?.name,
		onProperties: () => end.emit("properties", {}),
		onDeleteBoard: (path) => end.call("remove", { path }),
	});
	const { handle } = editor;

	end.on("drawing", (data) => handle.setDocument(data.text, data.base, data.made));
	end.on("edits", (data) => void handle.applyEdits(data.edits, data.base, data.made));
	end.on("refused", (data) => handle.refused(data.edit));
	end.on("pages", (data) => setPages(data.pages));
	end.on("reload", (data) => handle.reloadBoard(data.path));
	end.on("look", (data) => {
		if (data.dark !== undefined) handle.setDark(data.dark);
		if (data.mode !== undefined) handle.setMode(data.mode);
	});
	end.on("tool", (data) => {
		if (data.tool) handle.setTool(data.tool);
		if (data.ink) setDrawing(data.ink.on);
	});
	end.on("camera", (data) => (data.glide ? handle.glide(data.camera, data.glide) : handle.setCamera(data.camera)));
	end.on("fit", () => handle.fit());
	end.on("select", (data) => handle.select(data.ids));
	end.on("step", (data) => (data.direction === "undo" ? handle.undo() : handle.redo()));
	end.on("news", (data) => setNews(data.glow));
	end.on("marks", (data) => setMarks({ ...untrack(marks), [data.path]: data.marks }));
	end.on("busy", (data) => setBusy({ ...untrack(busy), ...data }));
	end.answer("edit", (data) => {
		handle.edit(data.ops);
		return true as const;
	});
	end.answer("read", () => handle.drawn());

	/*
	 * A shortcut the canvas did not take goes to the page, so the app's own keys work wherever the focus
	 * is: only one with a modifier, since a bare letter typed here is the canvas's or a card's.
	 */
	addEventListener("keydown", (event) => {
		if (event.defaultPrevented || !(event.metaKey || event.ctrlKey || event.altKey)) return;
		end.emit("keys", { key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
	});

	// The tools as the app's chrome has them, then kept in step both ways.
	let applyTools: ((patch: Record<string, unknown>) => void) | undefined;
	syncTools((patch) => end.emit("ui", patch), (apply) => {
		applyTools = apply;
		end.on("ui", apply);
	});
	if (start.tools) applyTools?.(start.tools);

	render(() => (start.look.toolbar ? editor.root() : editor.surface()), root);
}
