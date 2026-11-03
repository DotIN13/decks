import { walk } from "@decks/pen";
import { boardOf } from "../stage/pens.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";
import { canvasOfPath, moveHome } from "./move-home.ts";

/**
 * What the person is looking at, in every open Decks page, moved only on purpose. These write no
 * file; with no screen open they do nothing and say so. The browser keeps its rule for whose view
 * it is (`apps/web/src/canvas/stage-ops.ts`): a call from the conversation on screen moves it, one
 * from another conversation waits for when that one is opened, and a person mid-gesture is offered
 * a button rather than moved.
 */
export function viewVerbs(ctx: VerbContext): Pick<Stage, "view"> {
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
				if (!agent.setHome || agent.board) {
					throw new Error("Only an agent's conversation moves to a canvas: decks view focus shows a card on the canvas on screen.");
				}
				const was = agent.stageName?.();
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
				if (agent.setHome && !agent.board && agent.stageName?.() !== name) {
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
					const board = [...walk(doc.children)].find((node) => boardOf(node) === one);
					if (board) {
						paths.push(one);
						continue;
					}
					const box = placed.get(one)?.box;
					if (!box) throw new Error(`Nothing called ${one} is on the canvas "${pens.titleOf(name)}": decks canvas read lists what is.`);
					// A board named by its item id is the board.
					const path = boardOf(placed.get(one)!.node);
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
