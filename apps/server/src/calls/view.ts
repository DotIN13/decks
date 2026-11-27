import { walk } from "@decks/pen";
import { cardOf } from "../canvas/pens.ts";
import type { Verbs } from "@decks/sdk";
import type { VerbContext } from "./context.ts";
import { documentKeyOf } from "../docs/resolve.ts";
import { canvasOfPath, moveHome } from "./move-home.ts";

/**
 * What the person is looking at, in every open Decks page, moved only on purpose. These write no
 * file; with no screen open they do nothing and say so. The browser keeps its rule for whose view
 * it is (`apps/web/src/canvas/view-ops.ts`): a call from the conversation on screen moves it, one
 * from another conversation waits for when that one is opened, and a person mid-gesture is offered
 * a button rather than moved.
 */
export function viewVerbs(ctx: VerbContext): Pick<Verbs, "view"> {
	const { service, agent, notes, needPens, canvasOf } = ctx;
	const asCamera = (at: { x: number; y: number; zoom: number }) => ({ x: at.x, y: at.y, zoom: at.zoom });
	return {
		view: {
			/*
			 * Your conversation to a canvas, and the person's screen with it when it is on screen (`move-home.ts`):
			 * what their canvas switcher does. In the background it just moves; while they are using the canvas
			 * they are offered a button instead.
			 */
			goto: async (canvas: string) => {
				const name = canvasOf(canvas);
				if (!agent.setHome || agent.app) {
					throw new Error("Only an agent's conversation moves to a canvas: decks view focus shows a card on the canvas on screen.");
				}
				const was = agent.canvasName?.();
				const moved = await moveHome(ctx, name);
				if (moved.offered) notes.push(`The screen did not move: ${moved.offered}.`);
				else if (!moved.onScreen && was !== name) notes.push("Your conversation is on that canvas now; the person's screen shows it when they open your chat.");
				return { canvas: name, moved: moved.onScreen && !moved.offered };
			},
			focus: async (target: string | string[], options?: { canvas?: string; highlight?: string; animate?: boolean }) => {
				const wanted = Array.isArray(target) ? target : [target];
				if (wanted.length === 0) throw new Error("focus names a board's path or an item's id, or a list of them.");
				/*
				 * Which canvas: the one named, else the one a card's path names (`canvases/<name>/…`), else your own.
				 * One not your own is gone to first, by goto's rule, so one call shows the card.
				 */
				const fromPath = options?.canvas ? undefined : wanted.map((one) => canvasOfPath(one)).find((one) => one !== undefined);
				const name = canvasOf(options?.canvas ?? fromPath);
				let arrived = false;
				if (agent.setHome && !agent.app && agent.canvasName?.() !== name) {
					const moved = await moveHome(ctx, name);
					if (moved.offered) {
						notes.push(`The view did not move: ${moved.offered}.`);
						return { canvas: name, target, deferred: moved.offered };
					}
					arrived = moved.moved && moved.onScreen;
				}
				const pens = needPens();
				const placed = pens.placedOf(name);
				const doc = pens.get(name).doc;
				const paths: string[] = [];
				const items: Array<{ id: string; box: { x: number; y: number; w: number; h: number } }> = [];
				for (const one of wanted) {
					const card = [...walk(doc.children)].find((node) => cardOf(node) === one);
					if (card) {
						paths.push(one);
						continue;
					}
					const box = placed.get(one)?.box;
					if (!box) throw new Error(`Nothing called ${one} is on the canvas "${pens.titleOf(name)}": decks canvas read lists what is.`);
					// A card named by its item id is the card.
					const path = cardOf(placed.get(one)!.node);
					if (path) paths.push(path);
					else items.push({ id: one, box: { x: box.x, y: box.y, w: box.w, h: box.h } });
				}
				const show = (timeoutMs?: number) =>
					service.show(agent.id, paths, {
						...(timeoutMs ? { timeoutMs } : {}),
						...(options?.highlight ? { highlight: options.highlight } : {}),
						...(options?.animate ? { animate: true } : {}),
						...(items.length ? { items } : {}),
						stage: name,
					});
				// Just moved there: the screen's frame for that canvas takes a moment to come up, so the card is shown once it has, asked briefly a few times.
				const settling = (said?: string) => !!said && /did not answer|shows another canvas|none of those cards/.test(said);
				let shown = await show(arrived ? 800 : undefined);
				for (let tries = 0; arrived && settling(shown.deferred) && tries < 10; tries++) {
					await new Promise((resolve) => setTimeout(resolve, 300));
					shown = await show(800);
				}
				const deferred = shown.deferred ?? ((shown as { skipped?: string }).skipped as string | undefined);
				if (deferred) notes.push(`The view did not move: ${deferred}.`);
				return { canvas: name, target, ...(deferred ? { deferred } : {}) };
			},
			/*
			 * Something whole, as a tab in the person's window: no conversation moves. What it is comes from
			 * `kind`, or from what the name is: a card's path, a canvas, an app, a document's path.
			 */
			open: async (what: string, options?: { kind?: "canvas" | "card" | "document" | "app" }) => {
				const found = tabFor(ctx, what, options?.kind);
				// A canvas: the camera goes there, by goto's rule, and the row of tabs follows the camera.
				if (found.kind === "canvas" && agent.setHome && !agent.app) {
					const moved = await moveHome(ctx, found.target, true);
					const said = moved.offered ?? (moved.onScreen ? undefined : "your chat is not the one on screen: its camera is on that canvas, and the person sees it when they open your chat");
					if (said) notes.push(`The tab did not open by itself: ${said}.`);
					return { kind: found.kind, target: found.target, opened: moved.onScreen && !moved.offered, ...(said ? { note: said } : {}) };
				}
				// The page opens it, in front when this chat is the one on its screen, or offers a button when it is not.
				const answer = ((await service.ask(agent.id, { op: "open", args: found }, 1500)) ?? {}) as { opened?: unknown; offered?: unknown; skipped?: unknown };
				const opened = answer.opened === true;
				const note = opened ? undefined : typeof answer.offered === "string" ? answer.offered : typeof answer.skipped === "string" ? answer.skipped : "the person's window did not open it: it may be one that has no tabs";
				if (note) notes.push(`The tab did not open by itself: ${note}.`);
				return { kind: found.kind, target: found.target, opened, ...(note ? { note } : {}) };
			},
			camera: async () => asCamera(agent.camera()),
			move: async (camera: { x: number; y: number; zoom: number; animate?: boolean }) => {
				const { animate, ...at } = camera;
				const answer = (await service.setCamera(agent.id, at, animate ? { animate } : {})) as { deferred?: string; skipped?: string } | undefined;
				const why = answer?.deferred ?? answer?.skipped;
				if (why) notes.push(`The view did not move: ${why}.`);
				return asCamera(at);
			},
			viewport: async () => service.viewport(agent.id) ?? null,
			cursor: async (card: string, at: { x: number; y: number } | null) => service.cursor(agent.id, card, at, agent.identity().name, agent.identity().color),
			reload: async (options: { card?: string; canvas?: string }) => {
				const card = options?.card;
				if (typeof card !== "string" || !card) throw new Error('reload names the card: decks view reload --card canvases/plan/cards/q3/index.html.');
				const name = options.canvas === undefined || options.canvas === null ? undefined : canvasOf(options.canvas);
				return { reloaded: await service.reloadEverywhere(agent.id, card, name) };
			},
		},
	};
}

export type TabKindName = "canvas" | "card" | "document" | "app";

/**
 * What `view.open` is asked to open: the kind named, checked, or the one kind the name fits. A card is
 * its path in the deck (its folder is enough), a canvas its name or title, an app its name, a document
 * its path in the deck or a root it declares.
 */
export function tabFor(ctx: VerbContext, what: string, kind?: TabKindName): { kind: TabKindName; target: string; title: string } {
	const { service } = ctx;
	const asked = String(what ?? "").trim();
	if (!asked) throw new Error("open names what to open: a canvas, a card's path, a document's path or an app.");
	const fits: Record<TabKindName, () => { target: string; title: string } | undefined> = {
		card: () => {
			const path = /\.html?$/.test(asked) ? asked : `${asked.replace(/\/+$/, "")}/index.html`;
			const card = service.fileCard(path);
			return card ? { target: card.path, title: card.title || card.path } : undefined;
		},
		canvas: () => {
			try {
				const name = ctx.canvasOf(asked);
				return { target: name, title: ctx.needPens().titleOf(name) };
			} catch {
				return undefined;
			}
		},
		app: () => (service.apps?.exists(asked) ? { target: asked, title: asked } : undefined),
		document: () => {
			const key = documentKeyOf(service.roots(), asked);
			return key ? { target: key, title: key.split("/").pop() ?? key } : undefined;
		},
	};
	if (kind) {
		const found = fits[kind]?.();
		if (!found) throw new Error(`There is no ${kind} called ${asked}.`);
		return { kind, ...found };
	}
	// A card's page is also a file a document could be: its path means the card.
	const found = (["card", "canvas", "app", "document"] as const).flatMap((one) => {
		const fit = fits[one]();
		return fit ? [{ kind: one, ...fit }] : [];
	});
	const first = found[0];
	if (!first) throw new Error(`Nothing to open is called ${asked}: name a canvas (decks canvas list), a card's path (decks card list), an app (decks apps list) or a document's path in the deck.`);
	const others = found.filter((one) => one.kind !== "document" || first.kind !== "card");
	if (others.length > 1) throw new Error(`${asked} is both ${others.map((one) => (one.kind === "app" ? "an app" : `a ${one.kind}`)).join(" and ")}: say which with --kind.`);
	return first;
}
