import { baseTheme, placements, serialize } from "@decks/pen";
import { createSignal, untrack } from "solid-js";
import { render } from "solid-js/web";
import type { Board } from "@decks/protocol";
import { createEditor, type Editor } from "../mount.tsx";
import { setCanvasHost } from "../host.ts";
import { drawing, setDrawing } from "../state/ink.ts";
import type { StageComment } from "../Stage.tsx";
import type { Camera } from "@decks/protocol";
import type { FrameChromeView } from "./chrome.ts";
import { syncTools } from "./ui-sync.ts";
import { canvasBox, useInsets } from "../camera/insets.ts";
import { fitInto } from "../camera/camera.ts";
import { cardCalls } from "./card-calls.ts";
import { runStageCall } from "../stage-ops.ts";
import type { ViewOffer } from "./chrome.ts";
import { createBackend, drawingFollower } from "./backend.ts";
import { PROTOCOL, peer, type FrameEnd, type Hello, type Page, type Rect, type Start, type StartMessage } from "./protocol.ts";

/**
 * The canvas, run inside its frame: says `hello` to its parent, takes `start` and the port, reads its
 * drawing from the harness on the canvas token (`backend.ts`), makes the editor, follows the canvas's
 * stream and sends your edits itself. With the page it trades only what is the page's: its chrome, the
 * composer, your storage (`protocol.ts`).
 *
 * What a host answered with a function (a board's address, its picture, its storage) is worked out
 * here from `start`: the files' ticketed address, the pages' trust, the page's kept values.
 */
export function bootFrame(root: HTMLElement, options: { chrome?: FrameChromeView } = {}): void {
	const parent = window.parent;
	if (parent === window) throw new Error("The canvas frame runs inside the app's page.");
	const onStart = (event: MessageEvent<StartMessage>) => {
		// Only the parent's answer, with its port: nothing else is read, then or later.
		if (event.source !== parent || event.data?.t !== "start" || !event.ports[0]) return;
		removeEventListener("message", onStart);
		void run(root, event.data.start, peer(event.ports[0]) as FrameEnd, options.chrome);
	};
	addEventListener("message", onStart);
	parent.postMessage({ t: "hello", protocol: PROTOCOL } satisfies Hello, "*");
}

/** A rectangle on this frame's screen, as the page places it (it adds where the frame sits). */
const rectOf = (box: DOMRect | undefined): Rect | undefined => (box ? { x: box.x, y: box.y, w: box.width, h: box.height } : undefined);

async function run(root: HTMLElement, start: Start, end: FrameEnd, chrome: FrameChromeView | undefined): Promise<void> {
	const backend = createBackend(start.backend.api, start.canvas.name, start.backend.token);
	end.on("token", (data) => backend.setToken(data.token));
	const first = await backend.drawing();
	const [pages, setPages] = createSignal<Page[]>(start.pages);
	const [camera, setCamera] = createSignal<Camera>(start.camera ?? { x: 0, y: 0, zoom: 1 });
	const [mode, setMode] = createSignal<"edit" | "browse">(start.look.mode);
	const [dark, setDark] = createSignal(start.look.dark);
	const [comment, setComment] = createSignal<StageComment>();
	const [revision, setRevision] = createSignal(0);
	const [agent, setAgent] = createSignal<string | undefined>(start.look.agent);
	const [offer, setOffer] = createSignal<ViewOffer>();
	/** When the person last pressed, scrolled or typed here: an agent's view waits while they are at it. */
	let touched = 0;
	for (const type of ["pointerdown", "wheel", "keydown"]) addEventListener(type, () => (touched = performance.now()), { capture: true, passive: true });
	const changed = () => setRevision((n) => n + 1);
	const canWrite = () => start.canvas.role !== "view" && !start.look.readOnly;
	if (start.look.insets) useInsets(start.look.insets);
	document.documentElement.dataset.colorScheme = start.look.dark ? "dark" : "light";
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
	const kept_ = (key: string) => kept.get(key) || undefined;
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
		text: serialize(first.doc),
		base: first.base,
		dark: start.look.dark,
		mode: start.look.mode,
		// With chrome of its own, the frame's mode and pen are the editor's state, set by its toolbars.
		...(chrome ? { state: { mode: [mode, setMode], inking: () => drawing() && mode() === "browse" } } : {}),
		readOnly: start.look.readOnly,
		toolbar: start.look.toolbar,
		...(start.camera ? { camera: start.camera } : {}),
		views: { scope: () => start.canvas.name, storage, key: "frame" },
		canvasName: () => start.canvas.name,
		document: {
			// Your edits, straight to the harness; one it refuses is dropped, and the drawing read again.
			send: async (ops, edit) => {
				changed();
				const answer = await backend.call("canvas.batch", [ops], edit);
				if (!answer.ok) reread();
				return answer.ok;
			},
			step: (direction, edit) => {
				void backend.call("canvas.step", [direction], edit).then((answer) => {
					if (answer.ok) return;
					if (edit) handle.refused(edit);
					console.info(answer.error);
				});
			},
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
			// An old board's own token, for its buttons, from the harness on this canvas's token.
			mintBoardToken: async (path) => {
				const answer = await backend.post("board-token", { path });
				return typeof answer.token === "string" ? answer.token : undefined;
			},
			sandboxed: (path) => trust(path) === "friend",
			cardScripts: (path) => trust(path) !== "friend",
			storageKey: (path) => `${start.canvas.name}\u0000${path}`,
			// How a card measured, kept by the harness for `decks canvas fit` to report.
			onExtent: (path, extent) => void backend.post("board-extent", { path, ...extent }),
			onOpenLink: (path, from) => {
				void end.call("open", { path, from });
				return true;
			},
			news: () => news(),
			onRead: (path) => void backend.post("board-seen", { path }),
			mayStart: () => busy().mayStart !== false,
			switching: () => busy().switching === true,
			onStarted: () => end.emit("started", {}),
			// Hidden is the card taken off the drawing, as canvas.delete does.
			onHide: (path) => void backend.call("canvas.delete", [path]),
			marks: (path) => marks()[path] ?? [],
		},
		// Said once the camera rests, not for every step of a pan: the page keeps it, and the view is drawn here.
		onCamera: (moved) => {
			setCamera(moved);
			clearTimeout(restUntil);
			restUntil = setTimeout(() => end.emit("camera", { camera: moved }), 250);
		},
		// What you point at, a comment, a sketch: drafts for the composer, which the page sends only on your Send.
		onSelection: (ids) => end.emit("composer", { selection: { ids: [...ids] } }),
		onSelect: (path) => end.emit("composer", { selection: { ids: [], ...(path ? { page: path } : {}) } }),
		onViewport: (viewport) => end.emit("viewport", viewport),
		onRefer: (pills) => end.emit("composer", { pills }),
		onComment: (target) => {
			if (chrome) return void setComment(target);
			const at = rectOf(target.anchor());
			end.emit("comment", { path: target.path, title: target.title, quote: target.quote, ...(target.component ? { component: target.component } : {}), ...(target.items ? { items: target.items } : {}), ...(at ? { at } : {}) });
		},
		onExport: (ids) => end.emit("export", { ids }),
		onInk: (request) => end.emit("composer", { ink: { action: request.action, ids: request.ids, canvas: request.canvas, box: request.box } }),
		inkAgent: () => busy().writer?.name,
		// Taking a card off the canvas is an edit like any other, undone the same way: no question first.
		onDeleteBoard: async (path) => {
			const answer = await backend.call("canvas.delete", [path]);
			return answer.ok;
		},
	});
	const { handle } = editor;

	/** Frame these items, by id or by a card's path, as `view.focus` does. */
	const focus = (targets: string[]) => {
		const doc = handle.drawn();
		const placed = placements(doc, { theme: baseTheme(doc, "light") });
		const byPath = new Map<string, string>();
		for (const child of (doc.children ?? []) as unknown as Array<{ id?: string; metadata?: { path?: string } }>) if (child.id && child.metadata?.path) byPath.set(child.metadata.path, child.id);
		const boxes = targets
			.map((target) => placed.get(target)?.box ?? placed.get(byPath.get(target) ?? [...byPath].find(([path]) => target.endsWith(path) || path.endsWith(target))?.[1] ?? "")?.box)
			.filter((box): box is NonNullable<typeof box> => !!box)
			.map((box) => ({ x: box.x, y: box.y, w: box.w, h: box.h }));
		if (!boxes.length) throw new Error(`Nothing on this canvas is ${targets.join(", ")}.`);
		const view = { width: innerWidth, height: innerHeight };
		handle.glide(fitInto(boxes, view, canvasBox(view)), 400);
	};
	// A card's `card.decks` calls: here, on this canvas by the harness, or the page's (`card-calls.ts`).
	setCanvasHost({
		cardCall: cardCalls({
			canvas: start.canvas.name,
			camera: () => untrack(camera),
			move: (next, glide) => (glide ? handle.glide(next, glide) : handle.setCamera(next)),
			focus,
			viewport: () => ({ width: innerWidth, height: innerHeight }),
			reload: (path) => handle.reloadBoard(path),
			harness: (verb, args) => backend.call(verb, args),
			page: (verb, args, card) => end.call("agent", { verb, args, card }),
		}),
	});

	/*
	 * The drawing as the harness changes it, from its stream: each change is said once per agent on the
	 * canvas, so one already held is passed over, and a gap reads the drawing whole again.
	 */
	let reading = false;
	const follower = drawingFollower({
		whole: (doc, base, made) => {
			handle.setDocument(serialize(doc), base, made);
			changed();
		},
		edits: (edits, base, made) => {
			const applied = handle.applyEdits(edits, base, made) !== false;
			changed();
			return applied;
		},
		reread: () => reread(),
	});
	function reread(): void {
		if (reading) return;
		reading = true;
		void backend
			.drawing()
			.then((now) => {
				follower.at(now.rev);
				handle.setDocument(serialize(now.doc), now.base);
				changed();
			})
			.catch((error: unknown) => console.warn(error))
			.finally(() => (reading = false));
	}
	follower.at(first.rev);

	/** A view kept for a conversation not on screen, in what the page keeps for this frame: it arrives when that chat opens. */
	const viewKey = (id: string) => `view:${id}`;
	const selectCard = (path: string | undefined) => {
		if (!path) return;
		const child = ((handle.drawn().children ?? []) as unknown as Array<{ id?: string; metadata?: { path?: string } }>).find((one) => one.metadata?.path === path || path.endsWith(one.metadata?.path ?? "\u0000"));
		if (child?.id) handle.select([child.id]);
	};
	const moveTo = (to: Camera, animate?: boolean) => (animate ? handle.glide(to, 400) : handle.setCamera(to));
	/*
	 * An agent's `decks view …` on this canvas, from the stream: carried out as the page carries it out
	 * for a canvas it holds (`stage-ops.ts`), and answered to the harness.
	 */
	const stageCall = (call: import("@decks/protocol").StageCall) => {
		let value: unknown;
		try {
			value = runStageCall(call, {
				boards: () => untrack(pages) as Board[],
				viewport: () => ({ width: innerWidth, height: innerHeight }),
				focused: () => untrack(agent),
				stageOnScreen: () => start.canvas.name,
				setCamera: (to, options) => moveTo(to, options?.animate),
				handsOn: () => performance.now() - touched < 3000,
				offerView: (from, to, selected, what) => setOffer({ agent: from, what, go: () => {
					moveTo(to, true);
					selectCard(selected);
					setOffer(undefined);
				} }),
				rememberView: (id, to, selected) => {
					storage.setItem(viewKey(id), JSON.stringify({ camera: to, ...(selected ? { selected } : {}) }));
					end.emit("camera", { camera: to, agent: id });
				},
				select: selectCard,
				reload: (path) => handle.reloadBoard(path),
				// An agent's labelled dot on a card is the page's to draw, and the frame has none yet.
				cursor: () => {},
			});
		} catch (error) {
			value = { error: error instanceof Error ? error.message : String(error) };
		}
		backend.answer(call.id, value);
	};
	backend.follow((message) => (message.type === "stage.call" ? stageCall(message.call) : follower.hear(message)));
	// A conversation opened that an agent kept a view for while it was not on screen: it arrives framed as meant.
	const arrive = (id: string | undefined) => {
		if (!id) return;
		const kept = kept_(viewKey(id));
		if (!kept) return;
		storage.setItem(viewKey(id), "");
		try {
			const view = JSON.parse(kept) as { camera: Camera; selected?: string };
			moveTo(view.camera, true);
			selectCard(view.selected);
		} catch {
			/* a view that does not read is no view */
		}
	};
	end.on("pages", (data) => setPages(data.pages));
	end.on("reload", (data) => handle.reloadBoard(data.path));
	end.on("look", (data) => {
		if (data.agent !== undefined && data.agent !== untrack(agent)) {
			setAgent(data.agent);
			arrive(data.agent);
		}
		if (data.insets) useInsets(data.insets);
		if (data.dark !== undefined) {
			document.documentElement.dataset.colorScheme = data.dark ? "dark" : "light";
			setDark(data.dark);
			handle.setDark(data.dark);
		}
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

	if (chrome) {
		// The app's own chrome, here beside the canvas: its tools are this frame's, and nothing of them crosses.
		const view = chrome({
			handle,
			revision,
			offer,
			dismissOffer: () => setOffer(undefined),
			camera,
			mode,
			setMode: (next) => {
				if (next === "edit" && !canWrite()) return;
				setMode(next);
			},
			canWrite,
			dark,
			comment,
			setComment,
			compose: (part) => end.emit("composer", part),
			exportPicture: (ids) => end.emit("export", { ids }),
			panel: (name) => end.emit("panel", { name }),
			canvas: start.canvas.name,
		});
		render(() => (
			<>
				{editor.surface()}
				{view}
			</>
		), root);
		return;
	}

	// No chrome of its own: the tools as the app's page has them, kept in step both ways.
	let applyTools: ((patch: Record<string, unknown>) => void) | undefined;
	syncTools((patch) => end.emit("ui", patch), (apply) => {
		applyTools = apply;
		end.on("ui", apply);
	});
	if (start.tools) applyTools?.(start.tools);

	render(() => (start.look.toolbar ? editor.root() : editor.surface()), root);
}
