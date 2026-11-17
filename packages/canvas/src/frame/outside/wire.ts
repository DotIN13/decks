import type { Accessor } from "solid-js";
import type { Camera } from "@decks/protocol";
import { dismissMenus } from "@decks/ui";
import type { EditorState } from "../../view/types.ts";
import { CallRefused, type PageEnd, type Rect } from "../protocol.ts";
import { type FramedEditorOptions } from "./host.tsx";
import { APP_STORE } from "./stores.ts";
import { mirrorTools } from "../tools-mirror.ts";

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
}

export function createWire(d: WireNeeds) {
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
		// The tools the page draws: their state, the same at both ends for as long as this line is open.
		if (d.options.pageTools) {
			const stop = mirrorTools("page", page, { frameAt: () => d.frameAt()?.getBoundingClientRect() });
			const close = page.close;
			page.close = () => {
				stop();
				close();
			};
		}
		page.on("panel", (data) => d.options.frame.panel?.(data.name));
		page.on("sheet", (data) => d.options.frame.sheet?.(data.open));
		page.on("refer", (data) => {
			const composer = d.options.frame.composer?.();
			if (!composer) return;
			if (data.over) composer.dataset.refer = "true";
			else delete composer.dataset.refer;
		});
		page.on("open-app", (data) => d.options.frame.openApp?.(data.name));
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
		page.on("goto", (data) => d.options.frame.moveTo?.(data.agent, data.canvas));
		page.on("camera", (data) => {
			if (data.agent) return d.options.frame.viewFor?.(data.agent, data.camera, data.selected);
			d.fromFrame.camera = data.camera;
			d.localCamera = data.camera;
			d.state?.camera?.[1](data.camera);
			d.options.onCamera?.(data.camera);
		});
		page.on("viewport", (data) => d.options.onViewport?.(data));
		page.on("comment", (data) => d.options.onComment?.({ path: data.path, title: data.title, quote: data.quote, ...(data.component ? { component: data.component } : {}), ...(data.items ? { items: data.items } : {}), ...(data.open ? { open: true } : {}), anchor: () => d.onPage(data.at) }));
		page.on("export", (data) => d.options.onExport?.(data.ids, data.format));
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
		// A shortcut the canvas did not take, played on this page as if typed here.
		page.on("keys", (data) => dispatchEvent(new KeyboardEvent("keydown", { key: data.key, code: data.code, metaKey: data.meta, ctrlKey: data.ctrl, altKey: data.alt, shiftKey: data.shift, bubbles: true, cancelable: true })));
		page.answer("open", (data) => d.options.pages?.onOpenLink?.(data.path, data.from) ?? false);
		page.answer("agent", (data) => {
			if (!d.options.frame.agent) throw new CallRefused("This page answers no card's agent calls.", "refused");
			return d.options.frame.agent(data);
		});
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
