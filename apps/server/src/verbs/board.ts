import { canvasFolder, canvasOfPath } from "../deck/layout.ts";
import { stageBoardsDir } from "../deck/stage-boards.ts";
import { boardWidth } from "../boards/templates.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/**
 * Boards and the deck's other files: board files listed, made, named and found on canvases; frames
 * and file addresses. A board file is the deck's, on any number of canvases or none: making one does
 * not place it, which is the canvas's job (`canvas.insert`).
 */
export function boardVerbs(ctx: VerbContext): Pick<Stage, "board" | "frame" | "file"> {
	const { service, agent, notes, viewport, needPens } = ctx;

	/** Who wrote a board, as a name: an agent's, or "person" for the person's own edit. */
	const writer = (who: string | undefined): string | undefined => {
		if (!who) return undefined;
		if (who === "you") return "person";
		return agent.agents().find((one) => one.id === who)?.name ?? who;
	};
	const needBoard = (path: unknown) => {
		if (typeof path !== "string" || !path.trim()) throw new Error('A board is named by its path, as in "boards/plan.html": decks board list lists them.');
		const board = service.fileBoard(path);
		if (!board) throw new Error(`There is no board ${path}. decks board list lists them.`);
		return board;
	};
	const asBoard = (board: { path: string; title: string; lastWrittenBy?: string }) => {
		const by = writer(board.lastWrittenBy);
		return { path: board.path, title: board.title, ...(by ? { lastWrittenBy: by } : {}) };
	};

	return {
		board: {
			list: async () => service.allBoards().map(asBoard),
			create: async (options: { title: string; w?: number; h?: number; canvas?: string }) => {
				const title = options?.title?.trim();
				if (!title) throw new Error("A board needs a title: the finding it states, as a sentence.");
				const view = viewport();
				const width = boardWidth(options.w, view?.width);
				/*
				 * A board is made in a canvas's own boards/, the one named or the caller's own, so the canvas
				 * stands alone (`deck/layout.ts`).
				 */
				let stageName: string | undefined;
				try {
					stageName = ctx.canvasOf(options?.canvas);
				} catch (error) {
					throw new Error(`A board is made in a canvas: name it with { canvas }, as in decks board create '{"title":"…","canvas":"launch-plan"}'. ${(error as Error).message}`);
				}
				if (!stageName) throw new Error('A board is made in a canvas: name it with { canvas }. decks canvas list names them.');
				needPens().mayWrite(stageName);
				const path = service.newBoard({ title, size: { w: width, ...(options.h ? { h: options.h } : {}) }, folder: stageBoardsDir(stageName) });
				agent.worked?.(path);
				if (view) notes.push(`viewport ${view.width}×${view.height} px`);
				notes.push(
					`board width ${width}. One screen: about ${Math.round(width * 0.7)} px tall, about 120 words, body text 17px or larger and nothing under 14px. It is kept in the canvas ${stageName}'s own folder and not placed yet: decks canvas insert '{"type":"board","board":"${path}"}' --canvas ${stageName} --beside <id> puts it there, then decks canvas fit ${path}.`,
				);
				return asBoard(service.fileBoard(path) ?? { path, title });
			},
			get: async (path: string) => asBoard(needBoard(path)),
			canvases: async (path: string) => {
				needBoard(path);
				const pens = needPens();
				const out: Array<{ board: string; canvas: string; box: { x1: number; y1: number; x2: number; y2: number }; clipped?: boolean }> = [];
				const file = service.fileBoard(path);
				/*
				 * A board in a canvas's folder is on that canvas and no other (`deck/layout.ts`), so this answers
				 * one canvas at most. A board in the library is on none; the canvases that copied it are said,
				 * each with its copy's path.
				 */
				const home = canvasOfPath(path);
				for (const name of home ? [home.name] : pens.names()) {
					const own = home ? path : pens.copyOf(name, path);
					if (!home && own === path) continue;
					let held;
					try {
						held = pens.boards(name).find((one) => one.path === own);
					} catch {
						continue;
					}
					if (!held) continue;
					const content = (home ? file : service.fileBoard(own))?.content;
					const clipped = content ? content.w > held.w || content.h > held.h : undefined;
					out.push({ board: own, canvas: name, box: { x1: held.x, y1: held.y, x2: held.x + held.w, y2: held.y + held.h }, ...(clipped ? { clipped } : {}) });
				}
				return out;
			},
			url: async (path: string) => {
				needBoard(path);
				return service.url(path, ctx.port);
			},
		},
		frame: {
			// A frame is made in the caller's canvas's own frames/, so the canvas stands alone (`deck/layout.ts`).
			create: async (path: string, item?: Record<string, unknown>) => {
				let home: string | undefined;
				try {
					home = ctx.canvasOf(undefined);
				} catch {
					/* no canvas: the deck's own frames/, a library to place from */
				}
				const asked = typeof path === "string" ? path.trim().replace(/^\.?\/+/, "") : path;
				return needPens().createFile(home && typeof asked === "string" && /^frames\//.test(asked) ? `${canvasFolder(home)}/${asked}` : path, item as never);
			},
		},
		file: {
			url: async (file: string) => service.resolve(file),
		},
	};
}
