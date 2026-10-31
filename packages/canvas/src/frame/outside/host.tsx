import type { Camera } from "@decks/protocol";
import { createEffect, createSignal, on, onCleanup, Show, untrack, type JSX } from "solid-js";
import { dismissMenus } from "@decks/ui";
import type { EditorState, StageComment } from "../../types.ts";
import type { PenTool } from "../../edit/pen-tools.ts";
import type { InkTool } from "../../edit/ink.ts";
import { insets } from "../../camera/insets.ts";
import { CallRefused, PROTOCOL, peer, type ComposerPart, type FrameCalls, type CardSlot, type PageEnd, type Rect, type Start } from "../protocol.ts";

/**
 * The frame's address, with the page's measuring parameters passed on: the frame probe (`?probe=<collector>`,
 * the app's `perf/probe.ts`) and its companions, and the device, engine, picture and card-picture overrides (`render/device.ts`,
 * `stage/items-layer.tsx`), run in the frame, where the stage is.
 */
const PASSED_ON = ["probe", "handlers", "autopilot", "pictures-per-frame", "picture-mb", "skip-levels", "device", "pictures", "card-pictures", "engine"];
const frameAddress = (): string => {
	const page = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
	const passed = new URLSearchParams();
	for (const name of PASSED_ON) if (page.has(name)) passed.set(name, page.get(name)!);
	const query = passed.toString();
	return query ? `/canvas-frame.html?${query}` : "/canvas-frame.html";
};

/** What the page answers for its frame beyond the editor's own options. */
export interface FrameHostOptions {
	/**
	 * A pass for one canvas (`server/src/auth/passes.ts`): the harness as the frame reaches it (`api`), the
	 * pass for its calls (`token`), the addresses its files and pictures are read at with the pass in them,
	 * and when it runs out. Asked for again at half its life, unseen: the frame reads, follows and edits
	 * its canvas on it.
	 */
	pass(canvas: string): Promise<CanvasPass>;
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
	/** The page's composer: the frame is told where it is, so a drag let go over it mentions what it carries. */
	composer?(): HTMLElement | undefined;
	/** How far up from the bottom the page's dock reaches, in pixels: a phone's tool row goes above it. */
	dock?(): number;
	/** Each agent's name and colour, for what is new on the canvas. */
	agents?(): Record<string, { name: string; color: string }>;
	/** The conversation on screen, whose `decks view …` the frame carries out on its canvas. */
	focused?(): string | undefined;
	/** A view for another conversation, from an agent's `decks view …` on this canvas: the page keeps it for when that chat opens, and the harness hears it, to answer that agent's `view.camera`. */
	viewFor?(agent: string, camera: Camera, selected?: string): void;
	/** A file dropped on the canvas, its bytes, for the page to upload and place. */
	upload?(drop: { files: File[]; at: { x: number; y: number }; card?: CardSlot }): void;
}

/** One canvas's pass, as the frame is given it. */
export interface CanvasPass {
	api: string;
	token: string;
	files: string;
	pictures: string;
	expires: number;
	kind?: "harness" | "studio";
}

/** How long after a failed renewal it is asked for again. */
const RETRY_MS = 30_000;

/** What a page gives `createFramedEditor`: how the canvas looks, the page's state kept in step with it, and what it hears from it. */
export interface FramedEditorOptions {
	/** The canvas on screen, by name: the frame is made again, on a pass for it, when it changes. */
	canvasName: () => string | undefined;
	/** Draw in the dark scheme. Default: light. */
	dark?: boolean;
	/** `edit` (the default) to change the drawing, `browse` to read it and draw ink over it. */
	mode?: "edit" | "browse";
	/** Nothing can be changed: no tools, no edits. */
	readOnly?: boolean;
	/** The frame draws the canvas's own column of tools (when it has no chrome of its own). Default: true. */
	toolbar?: boolean;
	/** Where the camera starts, unless `state.camera` says. */
	camera?: Camera;
	/** The page's own camera, selection, mode and ink (and its copy of the drawing), kept in step with the frame. */
	state?: EditorState;
	pages?: {
		/** A link on a card to another of the deck: open it, and say whether this page has it. */
		onOpenLink?(path: string, from: string): boolean;
	};
	/** The camera came to rest after the person moved it. */
	onCamera?: (camera: Camera) => void;
	/** The card selected, or none. */
	onSelect?: (path: string | undefined) => void;
	/** The drawn items selected changed (their ids). */
	onSelection?: (ids: readonly string[]) => void;
	/** How big the canvas is on screen, when it changes. */
	onViewport?: (viewport: { width: number; height: number }) => void;
	/** Cards or items dragged onto the page's composer, to talk about them. */
	onRefer?: (pills: Array<{ kind: "card" | "item"; id: string; label: string; name?: string }>) => void;
	/** A comment from a frame with no chrome of its own (its pill's Comment): the page opens its own box. */
	onComment?: (comment: StageComment) => void;
	/** Export drawn items as a picture. */
	onExport?: (ids: string[]) => void;
	frame: FrameHostOptions;
}

/** What the page can do to its framed canvas: what the Decks app and Decks Studio call. */
export interface FramedHandle {
	/** Apply pen operations as the person's edit. */
	edit(ops: unknown[]): void;
	/** Select these drawn items, or none. */
	select(ids: readonly string[]): void;
	setDark(dark: boolean): void;
	setMode(mode: "edit" | "browse"): void;
	/** Ink on or off. */
	setDrawing(on: boolean, tool?: InkTool): void;
	/** Take a tool in hand: `select` puts it down. */
	setTool(tool: PenTool): void;
	/** Paste what this page's clipboard had: a copy of items (`@decks/pen`'s clip, as JSON) or words. */
	paste(data: { clip?: string; text?: string }): void;
	/** Move the camera there, gliding unless `ms` is 0. */
	glide(camera: Camera, ms?: number): void;
	/** The camera as the frame last said it, and moving it. */
	camera(): Camera;
	setCamera(camera: Camera): void;
	/** A card's file changed: it loads again. */
	reloadCard(path: string): void;
	/** Always false: the page keeps the views, not the frame. */
	readonly restored: boolean;
	dispose(): void;
}

/** The framed editor: its handle, and the frame to put where the canvas goes. */
export interface FramedEditor {
	handle: FramedHandle;
	surface: () => JSX.Element;
	dispose(): void;
}

type Options = FramedEditorOptions;

/**
 * The editor in a sandboxed frame (`protocol.ts`): the canvas runs in the frame (`bootFrame`); this end
 * keeps it in step with the host's state, turns its messages into the host's callbacks, and answers
 * what it asks.
 *
 * One frame for one canvas: when the host moves to another canvas the frame is made again, on a ticket
 * for that canvas.
 */
export function createFramedEditor(options: Options): FramedEditor {
	const state = options.state;
	const [end, setEnd] = createSignal<PageEnd>();
	const [frameAt, setFrameAt] = createSignal<HTMLIFrameElement>();
	/** The last of each the frame said, so this end does not say it back. */
	let fromFrame: { camera?: Camera; selected?: string; mode?: "edit" | "browse" } = {};
	let localCamera: Camera = untrack(() => state?.camera?.[0]()) ?? options.camera ?? { x: 0, y: 0, zoom: 1 };
	let darkNow = options.dark === true;
	let modeNow: "edit" | "browse" = options.mode ?? "edit";
	const storage = options.frame.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
	const storeKey = (canvas: string) => `decks.frame:${canvas}:`;
	/**
	 * Where an app inside a canvas keeps its browser storage on this page: by the app, not the canvas, so
	 * the same app on another canvas reads the same values; the same keys its own tab uses on this origin
	 * (`decks-storage.js`, `server/src/apps/storage-script.ts`).
	 */
	const APP_STORE = "decks.app:";
	/** What the frame's own views were kept under in that store (`createAgentViews`'s key "frame"). */
	const FRAME_VIEWS = "decks.views:frame";

	/** Every app's saved browser values on this page, by app name and key. */
	const appStoredNow = (): Record<string, Record<string, string>> => {
		const out: Record<string, Record<string, string>> = {};
		if (!storage) return out;
		for (let i = 0; i < (storage as Storage).length; i++) {
			const key = (storage as Storage).key(i);
			if (!key?.startsWith(APP_STORE)) continue;
			const rest = key.slice(APP_STORE.length);
			const at = rest.indexOf(":");
			if (at <= 0) continue;
			(out[rest.slice(0, at)] ??= {})[rest.slice(at + 1)] = storage.getItem(key) ?? "";
		}
		return out;
	};

	/** A rectangle on the frame's screen, on this page's. */
	const onPage = (at: Rect | undefined): DOMRect | undefined => {
		const frame = frameAt();
		if (!at || !frame) return undefined;
		const box = frame.getBoundingClientRect();
		return new DOMRect(box.x + at.x, box.y + at.y, at.w, at.h);
	};

	/*
	 * Whether you are using the canvas: the frame has focus, or had it a moment ago (the popover's Enter
	 * moves focus out to the composer as the comment is handed over). Drafts for the composer are taken
	 * only then: a card's script runs as the frame's own code, and could otherwise slip one in at any time.
	 */
	let frameLeftAt = 0;
	let frameHadFocus = false;
	const FOCUS_GRACE = 2000;
	const frameFocused = () => {
		const frame = frameAt();
		return !!frame && document.activeElement === frame && document.hasFocus();
	};
	/*
	 * And only just after a press or a key of yours: a script in the frame can focus it without one
	 * (Chrome lets a sandboxed frame take focus from a timer), but cannot make one, and a press or a key
	 * in the frame counts on this page too (`navigator.userActivation`, a few seconds long).
	 */
	const pressed = () => (typeof navigator === "undefined" || !navigator.userActivation ? true : navigator.userActivation.isActive);
	const frameInUse = () => (frameFocused() || (frameLeftAt > 0 && Date.now() - frameLeftAt < FOCUS_GRACE)) && pressed();
	if (typeof window !== "undefined") {
		const noteFocus = () => {
			const now = frameFocused();
			if (frameHadFocus && !now) frameLeftAt = Date.now();
			frameHadFocus = now;
		};
		// Focus going into the frame blurs this window; focus coming out lands on something here.
		const onBlur = () => setTimeout(noteFocus, 0);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focus", noteFocus);
		document.addEventListener("focusin", noteFocus, true);
		onCleanup(() => {
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focus", noteFocus);
			document.removeEventListener("focusin", noteFocus, true);
		});
	}

	/** Start the frame on the canvas on screen: the pass first, then everything it begins with. */
	const startFrame = async (frame: HTMLIFrameElement, canvas: string, cancelled: () => boolean) => {
		const pass = await options.frame.pass(canvas);
		if (cancelled()) return;
		const backend = { api: pass.api, token: pass.token, expires: pass.expires, ...(pass.kind ? { kind: pass.kind } : {}) };
		const pen = untrack(() => state?.pen?.());
		const stored: Record<string, string> = {};
		if (storage) {
			const prefix = storeKey(canvas);
			for (let i = 0; i < (storage as Storage).length; i++) {
				const key = (storage as Storage).key(i);
				if (key?.startsWith(prefix)) stored[key.slice(prefix.length)] = storage.getItem(key) ?? "";
			}
			// A harness's frame keeps no view of its own any more (the page keeps one per agent and canvas): what one kept is dropped.
			if (backend.kind !== "studio" && FRAME_VIEWS in stored) {
				delete stored[FRAME_VIEWS];
				storage.removeItem(prefix + FRAME_VIEWS);
			}
		}
		const start: Start = {
			protocol: PROTOCOL,
			canvas: { name: canvas, role: options.frame.role?.(canvas) ?? "owner" },
			backend,
			files: { base: pass.files, expires: pass.expires },
			pictures: pass.pictures,
			look: { dark: darkNow, mode: modeNow, readOnly: options.readOnly === true, toolbar: options.toolbar !== false, insets: untrack(insets), ...(untrack(() => options.frame.agents?.()) ? { agents: untrack(() => options.frame.agents!())! } : {}), ...(untrack(() => options.frame.focused?.()) ? { agent: untrack(() => options.frame.focused!())! } : {}) },
			camera: localCamera,
			...(pen?.writer ? { writer: pen.writer } : {}),
			stored,
			appStored: appStoredNow(),
		};
		const onHello = (event: MessageEvent) => {
			if (event.source !== frame.contentWindow || event.data?.t !== "hello") return;
			removeEventListener("message", onHello);
			const channel = new MessageChannel();
			const page = peer(channel.port1) as PageEnd;
			// A new frame has said nothing yet, and starts with the page's selection (`start.selected`), so it is not sent again.
			const selected = untrack(() => state?.selected?.[0]());
			fromFrame = selected ? { selected } : {};
			wire(page, canvas);
			setEnd(page);
			renew(page, canvas, pass.expires, cancelled);
			// To this frame's window alone: a sandboxed page has no origin to name, so "*", and the port beside it.
			// A plain copy: the pages come from the host's store, whose proxies the structured clone refuses.
			// The camera as it is now: the page may have landed while the frame was loading.
			frame.contentWindow?.postMessage({ t: "start", start: JSON.parse(JSON.stringify({ ...start, camera: localCamera, ...(selected ? { selected } : {}) })) as Start }, "*", [channel.port2]);
		};
		addEventListener("message", onHello);
		onCleanup(() => removeEventListener("message", onHello));
	};

	/**
	 * The canvas pass, asked for again unseen at half its life, for as long as the frame is there; and
	 * at once when the tab is shown again past that, since a hidden tab's timers are held back. One
	 * that fails is asked for again in thirty seconds. The frame takes the new pass for its calls and
	 * the new addresses for its files and pictures (`token`); what it already loaded stays loaded.
	 */
	const renew = (page: PageEnd, canvas: string, firstExpires: number, cancelled: () => boolean) => {
		let expires = firstExpires;
		let since = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let asking = false;
		const due = () => since + (expires - since) / 2;
		const schedule = (ms: number) => {
			clearTimeout(timer);
			timer = setTimeout(ask, Math.max(1000, ms));
		};
		const stop = () => {
			clearTimeout(timer);
			if (typeof document !== "undefined") document.removeEventListener("visibilitychange", shown);
		};
		const ask = () => {
			if (cancelled()) return stop();
			if (asking) return;
			asking = true;
			options.frame
				.pass(canvas)
				.then((next) => {
					if (cancelled()) return stop();
					since = Date.now();
					expires = next.expires;
					page.emit("token", { token: next.token, files: { base: next.files, expires: next.expires }, pictures: next.pictures });
					schedule(due() - Date.now());
				})
				.catch(() => schedule(RETRY_MS))
				.finally(() => (asking = false));
		};
		schedule(due() - Date.now());
		function shown() {
			if (cancelled()) return stop();
			if (typeof document !== "undefined" && document.visibilityState === "visible" && Date.now() >= due()) ask();
		}
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", shown);
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
			if (!data.pills && !data.comment && !data.ink) return;
			// Drafts only while you are using the canvas: it has focus, and you just pressed or typed.
			if (!frameInUse()) {
				console.warn("[decks] a draft from the canvas frame was dropped: the canvas was not in use (no focus, or no press or key just now)", Object.keys(data));
				return;
			}
			if (data.pills) options.onRefer?.(data.pills);
			if (data.comment) options.frame.comment?.(data.comment);
			if (data.ink) options.frame.ink?.(data.ink);
		});
		page.on("panel", (data) => options.frame.panel?.(data.name));
		page.on("refer", (data) => {
			const composer = options.frame.composer?.();
			if (!composer) return;
			if (data.over) composer.dataset.refer = "true";
			else delete composer.dataset.refer;
		});
		page.on("open-app", (data) => options.frame.openApp?.(data.name));
		// A press or Escape in the frame: this page's menus go, as on a press here (`@decks/ui` dismiss).
		page.on("away", () => dismissMenus());
		// A link the frame may not open: an http(s) address alone, in a tab that cannot reach back to this page.
		page.on("open-link", (data) => {
			try {
				const url = new URL(data.href);
				if (url.protocol === "http:" || url.protocol === "https:") window.open(url.href, "_blank", "noopener");
			} catch {
				/* not an address */
			}
		});
		page.on("camera", (data) => {
			if (data.agent) return options.frame.viewFor?.(data.agent, data.camera, data.selected);
			fromFrame.camera = data.camera;
			localCamera = data.camera;
			state?.camera?.[1](data.camera);
			options.onCamera?.(data.camera);
		});
		page.on("viewport", (data) => options.onViewport?.(data));
		page.on("comment", (data) => options.onComment?.({ path: data.path, title: data.title, quote: data.quote, ...(data.component ? { component: data.component } : {}), ...(data.items ? { items: data.items } : {}), anchor: () => onPage(data.at) }));
		page.on("export", (data) => options.onExport?.(data.ids));
		page.on("app-store", (data) => {
			if (!storage || !data.app || data.app.includes(":")) return;
			const key = `${APP_STORE}${data.app}:${data.key}`;
			if (data.value === null) storage.removeItem(key);
			else storage.setItem(key, data.value);
		});
		page.on("store", (data) => {
			if (!storage) return;
			if (data.value === null) storage.removeItem(storeKey(canvas) + data.key);
			else storage.setItem(storeKey(canvas) + data.key, data.value);
		});
		// A shortcut the canvas did not take, played on this page as if typed here.
		page.on("keys", (data) => dispatchEvent(new KeyboardEvent("keydown", { key: data.key, code: data.code, metaKey: data.meta, ctrlKey: data.ctrl, altKey: data.alt, shiftKey: data.shift, bubbles: true, cancelable: true })));
		page.answer("open", (data) => options.pages?.onOpenLink?.(data.path, data.from) ?? false);
		page.answer("agent", (data) => {
			if (!options.frame.agent) throw new CallRefused("This page answers no card's agent calls.", "refused");
			return options.frame.agent(data);
		});
		page.answer("upload", (data) => {
			if (!options.frame.upload) throw new CallRefused("Files cannot be dropped on this canvas here.", "refused");
			// The point on this page: where the frame sits, plus where in it they landed.
			const box = frameAt()?.getBoundingClientRect();
			const at = { x: (box?.x ?? 0) + data.at.x, y: (box?.y ?? 0) + data.at.y };
			options.frame.upload({ files: data.files.map((one) => new File([one.bytes], one.name, { type: one.type })), at, ...(data.card ? { card: data.card } : {}) });
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
		/*
		 * A press or Escape on this page, which the frame does not hear: its open menus go. A press in the
		 * frame lands in the frame's document, so every press heard here is outside it.
		 */
		createEffect(() => {
			const page = end();
			if (!page) return;
			const press = () => page.emit("away", {});
			const key = (event: KeyboardEvent) => event.key === "Escape" && page.emit("away", {});
			window.addEventListener("pointerdown", press, true);
			window.addEventListener("keydown", key, true);
			onCleanup(() => {
				window.removeEventListener("pointerdown", press, true);
				window.removeEventListener("keydown", key, true);
			});
		});
		/*
		 * Where the composer is, on the frame's screen: said as the frame starts, as the composer or the
		 * frame changes size, and each time the pointer comes into the frame, since the composer is moved
		 * only from the page, by a hand that has to come back to the canvas to drag anything onto it.
		 */
		createEffect(() => {
			const page = end();
			const frame = frameAt();
			const composer = page && frame ? options.frame.composer?.() : undefined;
			if (!page || !frame || !composer) return;
			const say = () => {
				const at = frame.getBoundingClientRect();
				const box = composer.getBoundingClientRect();
				page.emit("look", { composer: box.width && box.height ? { x: box.x - at.x, y: box.y - at.y, w: box.width, h: box.height } : null });
			};
			const sized = new ResizeObserver(say);
			sized.observe(composer);
			sized.observe(frame);
			frame.addEventListener("pointerenter", say);
			onCleanup(() => {
				sized.disconnect();
				frame.removeEventListener("pointerenter", say);
			});
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
							/* allow-forms and allow-modals for the apps inside it (`AppSurface`), which can have no more than this frame has. */
							sandbox="allow-scripts allow-downloads allow-forms allow-modals"
							allow="clipboard-read; clipboard-write; fullscreen"
							src={frameAddress()}
							style={{ position: "absolute", inset: "0", width: "100%", height: "100%", border: "0", display: "block" }}
						/>
					);
				}}
			</Show>
		);
	};

	// The frame follows the drawing itself, from the harness or Studio: nothing of it is passed on from here.
	const handle: FramedHandle = {
		glide: (camera, ms) => end()?.emit("camera", { camera, glide: ms ?? 400 }),
		setDark: (dark) => {
			darkNow = dark;
			end()?.emit("look", { dark });
		},
		setMode: (mode) => {
			modeNow = mode;
			end()?.emit("look", { mode });
		},
		setDrawing: (onOff) => end()?.emit("tool", { ink: { on: onOff } }),
		setTool: (next) => end()?.emit("tool", { tool: next }),
		select: (ids) => end()?.emit("select", { ids: [...ids] }),
		edit: (ops) => void end()?.call("edit", { ops }),
		camera: () => localCamera,
		setCamera: (camera) => {
			localCamera = camera;
			end()?.emit("camera", { camera });
		},
		reloadCard: (path) => end()?.emit("reload", { path }),
		paste: (data) => end()?.emit("paste", data),
		restored: false,
		dispose: () => {
			end()?.close();
			setEnd(undefined);
		},
	};
	return { handle, surface, dispose: () => handle.dispose() };
}
