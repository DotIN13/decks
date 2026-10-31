import { walk } from "@decks/pen";
import { boardOf } from "../stage/pens.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

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
			goto: async (canvas: string) => {
				const name = canvasOf(canvas);
				const answer = await service.goto(agent.id, name);
				if (answer.note) notes.push(answer.note);
				return { canvas: name, ...answer };
			},
			focus: async (target: string | string[], options?: { canvas?: string; highlight?: string; animate?: boolean }) => {
				const name = canvasOf(options?.canvas);
				const pens = needPens();
				const wanted = Array.isArray(target) ? target : [target];
				if (wanted.length === 0) throw new Error("focus names a board's path or an item's id, or a list of them.");
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
				const shown = await service.show(agent.id, paths, {
					...(options?.highlight ? { highlight: options.highlight } : {}),
					...(options?.animate ? { animate: true } : {}),
					...(items.length ? { items } : {}),
					stage: name,
				});
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
			reload: async (options: { card?: string; board?: string; canvas?: string }) => {
				// `board` is `card`'s old name, taken until 2026-11-30.
				const card = options?.card ?? options?.board;
				if (typeof card !== "string" || !card) throw new Error('reload names the card: decks view reload --card canvases/plan/cards/q3/index.html.');
				const name = options.canvas === undefined || options.canvas === null ? undefined : canvasOf(options.canvas);
				return { reloaded: await service.reloadEverywhere(agent.id, card, name) };
			},
		},
	};
}
