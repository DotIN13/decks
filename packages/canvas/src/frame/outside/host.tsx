import { serialize, type PenDocument } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { createEffect, createSignal, on, onCleanup, Show, untrack, type JSX } from "solid-js";
import type { CanvasHandle, CanvasOptions, Editor, EditorState } from "../../types.ts";
import type { PenTool } from "../../edit/pen-tools.ts";
import { insets } from "../../camera/insets.ts";
import { CallRefused, PROTOCOL, peer, type ComposerPart, type FrameCalls, type PageEnd, type Rect, type Start } from "../protocol.ts";

/** What the page answers for its frame beyond the editor's own options. */
export interface FrameHostOptions {
	/** A ticket for one canvas's folder: the address its files are read at, and its pictures'. */
	ticket(canvas: string): Promise<{ files: string; pictures: string; expires: number }>;
	/**
	 * The harness as the frame reaches it, and a token for this one canvas (`kind: "canvas"`), asked for
	 * again before it lapses: the frame reads, follows and edits its canvas on it.
	 */
	backend(canvas: string): Promise<{ api: string; token: string; idle: number }>;
	/** Your role on the canvas on screen. */
	role?(canvas: string): "owner" | "edit" | "view";
	/** A card's agent call, or showing another canvas (`frame/card-calls.ts`): the page answers it with your token, asking first before a message goes to an agent. */
	agent?(call: FrameCalls["agent"]["data"]): Promise<unknown>;
	/** Where what the frame keeps between visits is kept: this page's own storage. */
	storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
	/** A comment written in the frame's popover: put in the composer as a draft, kept or to send, never sent from here. */
	comment?(comment: NonNullable<ComposerPart["comment"]>): void;
	/** A sketch to turn into something: a draft for the composer, never sent from here. */
	ink?(ink: NonNullable<ComposerPart["ink"]>): void;
	/** Open one of the app's panels: the apps list, or the file picker (`files`), whose file is put in the middle of the frame's view. */
	panel?(name: "apps" | "files"): void;
	/** Open an app in a tab of its own (`decks.app`), outside the canvas's sandbox. */
	openApp?(name: string): void;
	/** How far up from the bottom the page's dock reaches, in pixels: a phone's tool row goes above it. */
	dock?(): number;
	/** Each agent's name and colour, for what is new on the canvas. */
	agents?(): Record<string, { name: string; color: string }>;
	/** The conversation on screen, whose `decks view …` the frame carries out on its canvas. */
	focused?(): string | undefined;
	/** A view the frame kept for another conversation: the harness hears it, to answer that agent's `view.camera`. */
	viewFor?(agent: string, camera: Camera): void;
	/** A file dropped on the canvas, its bytes, for the page to upload and place. */
	upload?(drop: { files: File[]; at: { x: number; y: number } }): void;
}

type Options = CanvasOptions & { state?: EditorState; frame: FrameHostOptions };

/**
 * The editor in a sandboxed frame (`protocol.ts`), made as `createEditor` makes it, so a host can take
 * one for the other: the same options and state, the same handle, its stage in a frame. The canvas runs
 * in the frame; this end keeps it in step with the host's state, turns its messages into the host's
 * callbacks, and answers what it asks.
 *
 * One frame for one canvas: when the host moves to another canvas the frame is made again, on a ticket
 * for that canvas.
 */
export function createFramedEditor(options: Options): Editor {
	const state = options.state;
	const [end, setEnd] = createSignal<PageEnd>();
	const [frameAt, setFrameAt] = createSignal<HTMLIFrameElement>();
	/** The last of each the frame said, so this end does not say it back. */
	let fromFrame: { camera?: Camera; selected?: string; mode?: "edit" | "browse" } = {};
	let drawn: PenDocument | undefined;
	let tool: PenTool = "select";
	let localCamera: Camera = untrack(() => state?.camera?.[0]()) ?? options.camera ?? { x: 0, y: 0, zoom: 1 };
	let darkNow = options.dark === true;
	let modeNow: "edit" | "browse" = options.mode ?? "edit";
	const storage = options.frame.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
	const storeKey = (canvas: string) => `decks.frame:${canvas}:`;

	/** A rectangle on the frame's screen, on this page's. */
	const onPage = (at: Rect | undefined): DOMRect | undefined => {
		const frame = frameAt();
		if (!at || !frame) return undefined;
		const box = frame.getBoundingClientRect();
		return new DOMRect(box.x + at.x, box.y + at.y, at.w, at.h);
	};

	/** Start the frame on the canvas on screen: the ticket first, then everything it begins with. */
	const startFrame = async (frame: HTMLIFrameElement, canvas: string, cancelled: () => boolean) => {
		const [ticket, backend] = await Promise.all([options.frame.ticket(canvas), options.frame.backend(canvas)]);
		if (cancelled()) return;
		const pen = untrack(() => state?.pen?.());
		const doc = pen?.doc;
		drawn = doc;
		const stored: Record<string, string> = {};
		if (storage) {
			const prefix = storeKey(canvas);
			for (let i = 0; i < (storage as Storage).length; i++) {
				const key = (storage as Storage).key(i);
				if (key?.startsWith(prefix)) stored[key.slice(prefix.length)] = storage.getItem(key) ?? "";
			}
		}
		const start: Start = {
			protocol: PROTOCOL,
			canvas: { name: canvas, role: options.frame.role?.(canvas) ?? "owner" },
			backend,
			files: { base: ticket.files, expires: ticket.expires },
			pictures: ticket.pictures,
			look: { dark: darkNow, mode: modeNow, readOnly: options.readOnly === true, toolbar: options.toolbar !== false, insets: untrack(insets), ...(untrack(() => options.frame.agents?.()) ? { agents: untrack(() => options.frame.agents!())! } : {}), ...(untrack(() => options.frame.focused?.()) ? { agent: untrack(() => options.frame.focused!())! } : {}) },
			camera: localCamera,
			...(pen?.writer ? { writer: pen.writer } : {}),
			stored,
		};
		const onHello = (event: MessageEvent) => {
			if (event.source !== frame.contentWindow || event.data?.t !== "hello") return;
			removeEventListener("message", onHello);
			const channel = new MessageChannel();
			const page = peer(channel.port1) as PageEnd;
			// A new frame has said nothing yet: what the last one said is no reason to keep the page's selection from it.
			fromFrame = {};
			wire(page, canvas);
			setEnd(page);
			renew(page, canvas, backend.idle, cancelled);
			// To this frame's window alone: a sandboxed page has no origin to name, so "*", and the port beside it.
			// A plain copy: the pages come from the host's store, whose proxies the structured clone refuses.
			// The camera as it is now: the page may have landed while the frame was loading.
			frame.contentWindow?.postMessage({ t: "start", start: JSON.parse(JSON.stringify({ ...start, camera: localCamera })) as Start }, "*", [channel.port2]);
		};
		addEventListener("message", onHello);
		onCleanup(() => removeEventListener("message", onHello));
	};

	/** The canvas token, asked for again at a third of its life, for as long as the frame is there. */
	const renew = (page: PageEnd, canvas: string, idle: number, cancelled: () => boolean) => {
		const every = Math.max(30_000, Math.floor(idle / 3));
		const timer = setInterval(() => {
			if (cancelled()) return clearInterval(timer);
			options.frame
				.backend(canvas)
				.then((next) => {
					if (!cancelled()) page.emit("token", { token: next.token });
				})
				.catch(() => {
					/* tried again next time; the old one lasts its idle time */
				});
		}, every);
		onCleanup(() => clearInterval(timer));
	};

	/** What the frame says, as the host's own callbacks and state. */
	const wire = (page: PageEnd, canvas: string) => {
		/*
		 * Drafts for the composer: shown there, never sent from here. Anything in the frame can say these,
		 * a card's script too, so what reaches an agent is only what you send yourself.
		 */
		page.on("composer", (data) => {
			const selection = data.selection;
			if (selection) {
				if (selection.page !== undefined || selection.ids.length === 0) {
					fromFrame.selected = selection.page;
					state?.selected?.[1](selection.page);
					options.onSelect?.(selection.page);
				}
				if (selection.page === undefined) options.onSelection?.(selection.ids);
			}
			if (data.pills) options.onRefer?.(data.pills);
			if (data.comment) options.frame.comment?.(data.comment);
			if (data.ink) options.frame.ink?.(data.ink);
		});
		page.on("panel", (data) => options.frame.panel?.(data.name));
		page.on("open-app", (data) => options.frame.openApp?.(data.name));
		page.on("camera", (data) => {
			if (data.agent) return options.frame.viewFor?.(data.agent, data.camera);
			fromFrame.camera = data.camera;
			localCamera = data.camera;
			state?.camera?.[1](data.camera);
			options.onCamera?.(data.camera);
		});
		page.on("viewport", (data) => options.onViewport?.(data));
		page.on("comment", (data) => options.onComment?.({ path: data.path, title: data.title, quote: data.quote, ...(data.component ? { component: data.component } : {}), ...(data.items ? { items: data.items } : {}), anchor: () => onPage(data.at) }));
		page.on("export", (data) => options.onExport?.(data.ids));
		page.on("store", (data) => {
			if (!storage) return;
			if (data.value === null) storage.removeItem(storeKey(canvas) + data.key);
			else storage.setItem(storeKey(canvas) + data.key, data.value);
		});
		// A shortcut the canvas did not take, played on this page as if typed here.
		page.on("keys", (data) => dispatchEvent(new KeyboardEvent("keydown", { key: data.key, code: data.code, metaKey: data.meta, ctrlKey: data.ctrl, altKey: data.alt, shiftKey: data.shift, bubbles: true, cancelable: true })));
		page.answer("open", (data) => options.boards?.onOpenLink?.(data.path, data.from) ?? false);
		page.answer("agent", (data) => {
			if (!options.frame.agent) throw new CallRefused("This page answers no card's agent calls.", "refused");
			return options.frame.agent(data);
		});
		page.answer("upload", (data) => {
			if (!options.frame.upload) throw new CallRefused("Files cannot be dropped on this canvas here.", "refused");
			// The point on this page: where the frame sits, plus where in it they landed.
			const box = frameAt()?.getBoundingClientRect();
			const at = { x: (box?.x ?? 0) + data.at.x, y: (box?.y ?? 0) + data.at.y };
			options.frame.upload({ files: data.files.map((one) => new File([one.bytes], one.name, { type: one.type })), at });
			return true;
		});
	};

	/*
	 * The host's state, kept in step: the cards and boards, the camera an agent or the app moved, the
	 * selected board, the mode, the scheme, ink, and what is going on around the canvas.
	 */
	const keepInStep = () => {
		createEffect(
			on(
				() => state?.pen?.(),
				(pen) => {
					// The drawing is the frame's own to read (`backend.ts`); this page's copy is only for its panels.
					if (!pen) return;
					drawn = pen.doc;
					const page = end();
					if (page && pen.writer) page.emit("busy", { writer: pen.writer });
				},
				{ defer: true },
			),
		);
		// The conversation on screen: an agent's view calls move this canvas only for it.
		createEffect(() => {
			const page = end();
			const agent = options.frame.focused?.();
			if (page && agent) page.emit("look", { agent });
		});
		// What of the frame the page's own chrome covers, so the frame's tools sit clear of it and a fit frames into the rest.
		createEffect(() => {
			const page = end();
			const covered = insets();
			if (page) page.emit("look", { insets: covered });
		});
		createEffect(
			on(
				() => [state?.camera?.[0](), state?.glide?.()] as const,
				([camera, glide]) => {
					if (!camera) return;
					// Kept with no frame yet too: a frame starting for another canvas opens on the camera it landed on.
					localCamera = camera;
					const page = end();
					if (!page || camera === fromFrame.camera) return;
					page.emit("camera", { camera, ...(glide ? { glide: glide.ms } : {}) });
				},
			),
		);
		createEffect(() => {
			const page = end();
			const selected = state?.selected?.[0]();
			if (!page || selected === fromFrame.selected) return;
			page.emit("select", { ids: [], ...(selected ? { page: selected } : {}) });
		});
		createEffect(() => {
			const page = end();
			const mode = state?.mode?.[0]();
			if (!page || !mode || mode === modeNow) return;
			modeNow = mode;
			page.emit("look", { mode });
		});
		createEffect(() => {
			const page = end();
			const inking = state?.inking?.();
			if (page && inking !== undefined) page.emit("tool", { ink: { on: inking } });
		});
		createEffect(() => {
			const page = end();
			const dock = options.frame.dock?.();
			if (page && dock !== undefined) page.emit("look", { dock });
		});
		// Each agent's name and colour, when they change: the frame works out what is new itself.
		createEffect(() => {
			const page = end();
			const agents = options.frame.agents?.();
			if (page && agents) page.emit("look", { agents });
		});
	};

	/** The frame for the canvas on screen, made again when the host moves to another canvas. */
	const surface = (): JSX.Element => {
		keepInStep();
		return (
			<Show when={options.canvasName?.()} keyed>
				{(canvas) => {
					let cancelled = false;
					onCleanup(() => {
						cancelled = true;
						end()?.close();
						setEnd(undefined);
						setFrameAt(undefined);
					});
					return (
						<iframe
							ref={(frame) => {
								setFrameAt(frame);
								void startFrame(frame, canvas, () => cancelled);
							}}
							class="canvas-frame"
							title="Canvas"
							sandbox="allow-scripts allow-downloads"
							allow="clipboard-read; clipboard-write; fullscreen"
							src="/canvas-frame.html"
							style={{ position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", display: "block" }}
						/>
					);
				}}
			</Show>
		);
	};

	const handle: CanvasHandle = {
		// The frame follows the drawing itself, from the harness: nothing of it is passed on from here.
		setDocument: () => {},
		applyEdits: () => true,
		refused: () => {},
		drawn: () => drawn ?? { version: "2.14", children: [] } as unknown as PenDocument,
		glide: (camera, ms) => end()?.emit("camera", { camera, glide: ms ?? 400 }),
		document: () => drawn ?? ({ version: "2.14", children: [] } as unknown as PenDocument),
		text: () => (drawn ? serialize(drawn) : ""),
		setDark: (dark) => {
			darkNow = dark;
			end()?.emit("look", { dark });
		},
		setMode: (mode) => {
			modeNow = mode;
			end()?.emit("look", { mode });
		},
		setDrawing: (onOff) => end()?.emit("tool", { ink: { on: onOff } }),
		setTool: (next) => {
			tool = next;
			end()?.emit("tool", { tool: next });
		},
		tool: () => tool,
		fit: () => end()?.emit("fit", {}),
		select: (ids) => end()?.emit("select", { ids }),
		edit: (ops) => void end()?.call("edit", { ops }),
		undo: () => end()?.emit("step", { direction: "undo" }),
		redo: () => end()?.emit("step", { direction: "redo" }),
		camera: () => localCamera,
		setCamera: (camera) => {
			localCamera = camera;
			end()?.emit("camera", { camera });
		},
		reloadBoard: (path) => end()?.emit("reload", { path }),
		restored: false,
		dispose: () => {
			end()?.close();
			setEnd(undefined);
		},
	};
	return { handle, surface, root: surface, dispose: () => handle.dispose() };
}
