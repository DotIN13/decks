import { hearShared } from "@decks/frame";
import type { Accessor } from "solid-js";
import type { Camera } from "@decks/protocol";
import { dismissMenus } from "@decks/ui";
import type { EditorState } from "../../view/types.ts";
import { CallRefused, type PageEnd, type Rect } from "../protocol.ts";
import { type FramedEditorOptions } from "./host.tsx";
import { APP_STORE } from "./stores.ts";

/** What `createWire` reads of `createFramedEditor` (`host.tsx`), each read when it is used. */
export interface WireNeeds {
	readonly fromFrame: { camera?: Camera; selected?: string; mode?: "edit" | "browse"; };
	readonly state: EditorState | undefined;
	readonly options: FramedEditorOptions;
	readonly frameInUse: () => boolean;
	localCamera: Camera;
	readonly onPage: (at: Rect | undefined) => DOMRect | undefined;
	readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
	readonly storeKey: (canvas: string) => string;
	readonly frameAt: Accessor<HTMLIFrameElement | undefined>;
	/** Whether this is the line of the frame in front: one kept behind it (`surface.tsx`) is not heard on what belongs to the canvas on screen. */
	readonly inFront: (page: PageEnd) => boolean;
}

export function createWire(d: WireNeeds) {
	/**
	 * What the frame says, as the host's own callbacks and state. A frame kept behind the one in front
	 * goes on following its canvas, and may say things too (an agent moved its view, a card's script
	 * ran): what is the screen's own, the camera, the selection, drafts for the composer, a comment or
	 * a panel to open, is heard only from the frame in front (`mine`). What is not, is heard from any:
	 * a view kept for another chat, what a canvas stores, a card's agent call.
	 */
	const wire = (page: PageEnd, canvas: string) => {
		const mine = () => d.inFront(page);
		/*
		 * Drafts for the composer: shown there, never sent from here. Anything in the frame can say these,
		 * a card's script too, so what reaches an agent is only what you send yourself.
		 */
		page.on("composer", (data) => {
			if (!mine()) return;
			const selection = data.selection;
			if (selection) {
				if (selection.page !== undefined || selection.ids.length === 0) {
					d.fromFrame.selected = selection.page;
					d.state?.selected?.[1](selection.page);
					d.options.onSelect?.(selection.page);
				}
				if (selection.page === undefined) d.options.onSelection?.(selection.ids);
			}
			if (!data.pills && !data.comment && !data.ink) return;
			// Drafts only while you are using the canvas: it has focus, and you just pressed or typed.
			if (!d.frameInUse()) {
				console.warn("[decks] a draft from the canvas frame was dropped: the canvas was not in use (no focus, or no press or key just now)", Object.keys(data));
				return;
			}
			if (data.pills) d.options.onRefer?.(data.pills);
			if (data.comment) d.options.frame.comment?.(data.comment);
			if (data.ink) d.options.frame.ink?.(data.ink);
		});
		page.on("panel", (data) => mine() && d.options.frame.panel?.(data.name));
		page.on("sheet", (data) => mine() && d.options.frame.sheet?.(data.open));
		page.on("refer", (data) => {
			const composer = mine() ? d.options.frame.composer?.() : undefined;
			if (!composer) return;
			if (data.over) composer.dataset.refer = "true";
			else delete composer.dataset.refer;
		});
		page.on("open-app", (data) => d.options.frame.openApp?.(data.name));
		page.on("open-tab", (data) => d.options.frame.openTab?.(data));
		// The words every frame shares (`@decks/frame`): a press or Escape in the frame puts this page's menus away, a link opens in a tab, a shortcut the canvas did not take is played here, and a card's agent call is this page's to answer.
		hearShared(page as never, { dismiss: dismissMenus, agent: d.options.frame.agent, openAt: d.options.frame.openAt, refuse: (message) => new CallRefused(message, "refused") });
		page.on("goto", (data) => mine() && d.options.frame.moveTo?.(data.agent, data.canvas));
		page.on("hidden", (data) => mine() && d.options.frame.hidden?.(data.title, () => page.emit("step", { direction: "undo" })));
		page.on("camera", (data) => {
			/*
			 * A view that is an agent's chat's: kept for it. One the frame has carried out itself (`moved`,
			 * the chat on screen's agent showing something on this canvas) is on screen already when this
			 * frame is in front, and its camera at rest says so next; behind, the frame moved unseen, and
			 * the page keeps the view to land on when this canvas comes forward (`camera/landing.ts`).
			 */
			if (data.agent) return data.moved && mine() ? undefined : d.options.frame.viewFor?.(data.agent, data.camera, data.selected, canvas);
			// A frame behind moves for other reasons too (it was hidden, the window changed size): none is the screen's.
			if (!mine()) return;
			d.fromFrame.camera = data.camera;
			d.localCamera = data.camera;
			d.state?.camera?.[1](data.camera);
			d.options.onCamera?.(data.camera);
		});
		page.on("viewport", (data) => mine() && d.options.onViewport?.(data));
		page.on("comment", (data) => mine() && d.options.onComment?.({ path: data.path, title: data.title, quote: data.quote, ...(data.component ? { component: data.component } : {}), ...(data.items ? { items: data.items } : {}), ...(data.open ? { open: true } : {}), anchor: () => d.onPage(data.at) }));
		page.on("export", (data) => mine() && d.options.onExport?.(data.ids, data.format));
		page.on("app-store", (data) => {
			if (!d.storage || !data.app || data.app.includes(":")) return;
			const key = `${APP_STORE}${data.app}:${data.key}`;
			if (data.value === null) d.storage.removeItem(key);
			else d.storage.setItem(key, data.value);
		});
		page.on("store", (data) => {
			if (!d.storage) return;
			if (data.value === null) d.storage.removeItem(d.storeKey(canvas) + data.key);
			else d.storage.setItem(d.storeKey(canvas) + data.key, data.value);
		});
		page.answer("open", (data) => d.options.pages?.onOpenLink?.(data.path, data.from) ?? false);
		page.answer("upload", (data) => {
			if (!d.options.frame.upload) throw new CallRefused("Files cannot be dropped on this canvas here.", "refused");
			// The point on this page: where the frame sits, plus where in it they landed.
			const box = d.frameAt()?.getBoundingClientRect();
			const at = { x: (box?.x ?? 0) + data.at.x, y: (box?.y ?? 0) + data.at.y };
			d.options.frame.upload({ files: data.files.map((one) => new File([one.bytes], one.name, { type: one.type })), at, ...(data.card ? { card: data.card } : {}) });
			return true;
		});
	};

	return {
		wire,
	};
}
