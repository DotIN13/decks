import { serialize, type PenEdit } from "@decks/pen";
import { untrack } from "solid-js";
import type { Board } from "@decks/protocol";
import type { createEditor } from "../../editor.tsx";
import { passless, passOf, setCanvasHost, withPass } from "../../host.ts";
import { drawing } from "../../edit/ink.ts";
import { canvasBox } from "../../camera/insets.ts";
import { fitInto } from "../../camera/camera.ts";
import { placedItems } from "../../model/boxes.ts";
import { cardCalls } from "./card-calls.ts";
import type { FrameContext } from "./boot.ts";
import type { Rect } from "../protocol.ts";

/** Text as base64url, UTF-8 first, for an address. */
const base64url = (text: string) => {
	let binary = "";
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A rectangle on this frame's screen, as the page places it (it adds where the frame sits). */
const rectOf = (box: DOMRect | undefined): Rect | undefined => (box ? { x: box.x, y: box.y, w: box.width, h: box.height } : undefined);

/** Frame these items, by id or by a card's path, as `view.focus` does. */
const focusOn = (ctx: FrameContext, targets: string[]) => {
	const handle = ctx.handle();
	const doc = handle.drawn();
	const items = placedItems(doc);
	const boxes = targets
		.map((target) => (items.find((item) => item.id === target) ?? items.find((item) => item.path && (item.path === target || target.endsWith(item.path) || item.path.endsWith(target))))?.box)
		.filter((box): box is NonNullable<typeof box> => !!box);
	if (!boxes.length) throw new Error(`Nothing on this canvas is ${targets.join(", ")}.`);
	const view = { width: innerWidth, height: innerHeight };
	handle.glide(fitInto(boxes, view, canvasBox(view)), 400);
};

/**
 * What a host answers for the canvas (`host.ts`), worked out here from `start` and the ticket: the
 * files' ticketed address, the pages' trust, the documents' line, the apps, the composer and the
 * cards' `card.decks` calls.
 */
export function installHost(ctx: FrameContext): void {
	const { start, end, studio, backend, address, inFolder, folder, docListeners } = ctx;
	setCanvasHost({
		fileUrl: (path, rev) => `${address(inFolder(path))}${rev === undefined ? "" : `?rev=${rev}`}`,
		/*
		 * A picture the drawing names (`./files/a.jpg`) is read against the drawing's own address, which
		 * the server gives as the file on disk (`/api/f/…/canvases/<name>/`): a read the frame has no
		 * credential for. One inside this canvas's folder is read on the canvas pass instead.
		 */
		...(studio
			? {}
			: {
					pictureUrl: (url: string, base: string) => {
						const found = new URL(url, new URL(base || "/", location.href));
						const path = decodeURIComponent(found.pathname);
						const at = path.lastIndexOf(`/${folder}`);
						return at < 0 ? found.href : `${address(path.slice(at + 1))}${found.search}`;
					},
				}),
		canWrite: () => start.canvas.role !== "view" && !start.look.readOnly,
		// A card loaded on an older pass reads its files on the current one.
		freshAddress: (url) => {
			const pass = passOf(ctx.filesBase());
			return pass ? withPass(url, pass) : url;
		},
		boardLink: (href, base) => {
			try {
				const url = new URL(href, base);
				// Against any pass the canvas has had: a card loaded before a renewal links on the pass it was loaded with.
				const at = passless(url.href);
				const folder = passless(ctx.filesBase());
				return at.startsWith(folder) ? decodeURIComponent(at.slice(folder.length).split(/[?#]/)[0]!) : undefined;
			} catch {
				return undefined;
			}
		},
		...(studio
			? {}
			: {
					documents: {
						send: (message: unknown) => void backend.post("doc", { frame: backend.frame, message }).then((answer) => answer.ok === false && console.warn(answer.error)),
						listen: (listener: (message: unknown) => void) => {
							docListeners.add(listener);
							return () => docListeners.delete(listener);
						},
						// The canvas's own `lib/`, beside its cards, as a card reads it.
						lib: address(inFolder("lib/")),
					},
				}),
		// An app opens in a tab, which the page opens, outside this sandbox; the frame only asks what it is.
		apps: {
			status: async (name: string) => {
				if (studio) return undefined;
				try {
					const response = await fetch(`${start.backend.api.replace(/\/+$/, "")}/apps/${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${ctx.backendToken()}` } });
					return response.ok ? ((await response.json()) as { title?: string; status?: string }) : undefined;
				} catch {
					return undefined;
				}
			},
			open: (name: string) => end.emit("open-app", { name }),
			/*
			 * Inside the canvas, on a canvas that is yours alone: asked of the harness with this frame's canvas
			 * pass, which answers the app's address with an app pass in its path (`server/src/routes/apps.ts`).
			 * What the app saved in this browser goes after `#`, which never reaches the server.
			 */
			...(studio
				? {}
				: {
						inCanvas: async (name: string): Promise<{ url: string } | { tab: string }> => {
							try {
								const api = start.backend.api.replace(/\/+$/, "");
								const response = await fetch(`${api}/apps/${encodeURIComponent(name)}/open`, { method: "POST", headers: { authorization: `Bearer ${ctx.backendToken()}` } });
								const answer = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
								if (!response.ok || !answer.url) return { tab: answer.error ?? `The app did not open here (${response.status}).` };
								const saved = ctx.appStored.get(name) ?? {};
								const hash = Object.keys(saved).length ? `#decks-storage=${base64url(JSON.stringify(saved))}` : "";
								return { url: `${new URL(answer.url, api).href}${hash}` };
							} catch (error) {
								return { tab: (error as Error).message };
							}
						},
						store: (name: string, key: string, value: string | null) => {
							const saved = ctx.appStored.get(name) ?? {};
							if (value === null) delete saved[key];
							else saved[key] = value;
							ctx.appStored.set(name, saved);
							end.emit("app-store", { app: name, key, value });
						},
					}),
		},
		// So is any other tab a link opens: this sandbox may not open one.
		openLink: (href) => end.emit("open-link", { href }),
		// The composer is the page's, where the page said it is: a drag let go over it is a mention, sent as a draft.
		composer: {
			at: (x, y) => {
				const box = ctx.composerBox();
				return !!box && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
			},
			mark: (on) => end.emit("refer", { over: on }),
		},
		// A card's `card.decks` calls: here, on this canvas by the harness, or the page's (`card-calls.ts`).
		cardCall: cardCalls({
			canvas: start.canvas.name,
			camera: () => untrack(ctx.camera),
			move: (next, glide) => (glide ? ctx.handle().glide(next, glide) : ctx.handle().setCamera(next)),
			focus: (targets) => focusOn(ctx, targets),
			viewport: () => ({ width: innerWidth, height: innerHeight }),
			reload: (path) => ctx.handle().reloadBoard(path),
			harness: (verb, args) => (studio ? Promise.resolve({ ok: false, error: `${verb}: a canvas kept by Studio takes its changes from its page here, not from a card.` }) : backend.call(verb, args)),
			page: (verb, args, card) => end.call("agent", { verb, args, card }),
		}),
	});
}

/**
 * The editor's options: the drawing first read, who keeps it and its undo (Studio, or the harness),
 * the cards' pages and pictures on the ticket, and what the editor says, sent to the page.
 * `reread` reads the drawing whole again (`events.ts`), once it is wired.
 */
export function editorOptions(ctx: FrameContext, reread: () => void): Parameters<typeof createEditor>[0] {
	const { start, end, chrome, studio, backend, first, mode, setMode, pages, address, trust, cardItem, takeOff, changed } = ctx;
	let restUntil: ReturnType<typeof setTimeout> | undefined;
	return {
		text: serialize(first.doc),
		base: first.base,
		dark: start.look.dark,
		mode: start.look.mode,
		// With chrome of its own, the frame's mode and pen are the editor's state, set by its toolbars.
		...(chrome ? { state: { mode: [mode, setMode], inking: () => drawing() && mode() === "browse" } } : {}),
		readOnly: start.look.readOnly,
		toolbar: start.look.toolbar,
		...(start.camera ? { camera: start.camera } : {}),
		/*
		 * Studio's view is the canvas's, kept here on this device. A harness's page keeps one per agent and
		 * canvas itself (`camera/landing.ts`) and hands it in as `start.camera`: a view kept here per canvas
		 * alone would open every agent on the last one's.
		 */
		...(studio ? { views: { scope: () => start.canvas.name, storage: ctx.storage, key: "frame" } } : {}),
		canvasName: () => start.canvas.name,
		/*
		 * On Studio the editor keeps the drawing and its undo, as Studio's own page does, and each edit is
		 * sent as it is made (`studio-line.ts`). On a harness the harness keeps both (`document`).
		 */
		...(studio ? { onEdits: (edits: PenEdit[]) => {
			changed();
			studio.save(edits);
		} } : {}),
		...(studio ? {} : { document: {
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
					if (edit) ctx.handle().refused(edit);
					console.info(answer.error);
				});
			},
		} }),
		boards: {
			list: () => ctx.places() as Board[],
			page: (path) => {
				// A document or an app item has no page to load: it is drawn in place, and only needs saying it may be.
				if (path.startsWith("item:")) return path;
				const page = pages().find((one) => one.path === path);
				return page ? `${address(path)}?rev=${page.rev}` : undefined;
			},
			picture: (path, scheme) => {
				const page = untrack(pages).find((one) => one.path === path);
				const at = path.split("/").map(encodeURIComponent).join("/");
				const picturesAt = ctx.picturesAt();
				if (picturesAt.includes("{path}")) return picturesAt.replace("{path}", at).replace("{scheme}", scheme);
				// The whole page's picture (`whole=1`), which the server sends at the GPU's widths and compressed; without it, a gallery card's.
				return `${picturesAt}${at}?scheme=${scheme}${page ? `&v=${page.rev}` : ""}&whole=1`;
			},
			// A friend's card, on their canvas or pasted from it with its scripts off until you turn them on (`canvas.paste`).
			cardScripts: (path) => trust(path) !== "friend" && cardItem(path)?.metadata?.scripts !== false,
			onScriptsOn: (path) => {
				const item = cardItem(path);
				if (!item?.metadata) return;
				const { scripts: _scripts, from: _from, ...rest } = item.metadata;
				ctx.handle().edit([{ op: "update", id: item.id, set: { metadata: rest } }]);
				setTimeout(() => ctx.handle().reloadBoard(path), 300);
			},
			// How a card measured, kept by the harness for `decks canvas fit` to report.
			onExtent: (path, extent) => void (studio ? undefined : backend.post("board-extent", { path, ...extent })),
			onOpenLink: (path, from) => {
				void end.call("open", { path, from });
				return true;
			},
			news: () => ctx.news(),
			onRead: (path) => void (studio ? undefined : backend.post("board-seen", { path })),
			// Hidden is the card taken off the drawing, as canvas.delete does, but as an edit of yours: gone at once, not when the harness answers.
			onHide: (path) => {
				if (!takeOff(path) && !studio) void backend.call("canvas.delete", [path]);
			},
		},
		// Said once the camera rests, not for every step of a pan: the page keeps it, and the view is drawn here.
		onCamera: (moved) => {
			ctx.setCamera(moved);
			clearTimeout(restUntil);
			restUntil = setTimeout(() => end.emit("camera", { camera: moved }), 250);
		},
		// What you point at, a comment, a sketch: drafts for the composer, which the page sends only on your Send.
		onSelection: (ids) => end.emit("composer", { selection: { ids: [...ids] } }),
		onSelect: (path) => end.emit("composer", { selection: { ids: [], ...(path ? { page: path } : {}) } }),
		onViewport: (viewport) => end.emit("viewport", viewport),
		onRefer: (pills) => end.emit("composer", { pills }),
		onComment: (target) => {
			if (chrome) return void ctx.setComment(target);
			const at = rectOf(target.anchor());
			end.emit("comment", { path: target.path, title: target.title, quote: target.quote, ...(target.component ? { component: target.component } : {}), ...(target.items ? { items: target.items } : {}), ...(at ? { at } : {}) });
		},
		onExport: (ids) => end.emit("export", { ids }),
		onInk: (request) => end.emit("composer", { ink: { action: request.action, ids: request.ids, canvas: request.canvas, box: request.box } }),
		inkAgent: () => ctx.busy().writer?.name,
		// Taking a card off the canvas is an edit like any other, undone the same way: no question first.
		onDeleteBoard: async (path) => {
			if (studio) return takeOff(path);
			const answer = await backend.call("canvas.delete", [path]);
			return answer.ok;
		},
	};
}
