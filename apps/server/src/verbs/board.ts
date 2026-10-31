import { canvasFolder, canvasOfPath, isCardPath } from "../deck/layout.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cardShell } from "../cards/cards.ts";
import { slug } from "../agents/slug.ts";
import { boardWidth } from "../cards/size.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/**
 * Boards and the deck's other files: board files listed, made, named and found on canvases; frames
 * and file addresses. A board file is the deck's, on any number of canvases or none: making one does
 * not place it, which is the canvas's job (`canvas.insert`).
 */
export function boardVerbs(ctx: VerbContext): Pick<Stage, "board" | "card" | "frame" | "file"> {
	const { service, agent, notes, needPens } = ctx;

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

	/** The canvas a new card is made in: the one named, or the caller's own. */
	const homeOf = (canvas: string | undefined, what: string): string => {
		let name: string | undefined;
		try {
			name = ctx.canvasOf(canvas);
		} catch (error) {
			throw new Error(`A ${what} is made in a canvas: name it with { canvas }, as in decks ${what} create '{"title":"…","canvas":"launch-plan"}'. ${(error as Error).message}`);
		}
		if (!name) throw new Error(`A ${what} is made in a canvas: name it with { canvas }. decks canvas list names them.`);
		needPens().mayWrite(name);
		return name;
	};

	const board = {
			list: async () => service.allBoards().map(asBoard),
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
	};

	const card = {
			/** Every card in the deck, placed or not. */
			list: async () => service.allBoards().filter((one) => isCardPath(one.path)).map(asBoard),
			/**
			 * A blank card, `cards/<title>/index.html` in a canvas's own folder: a piece of HTML the stage draws
			 * in its own page (`card.ts`), with a folder for what it keeps beside it. Placing it is the canvas's job.
			 */
			create: async (options: { title: string; w?: number; h?: number; canvas?: string }) => {
				const { path, title, width, canvas: stageName } = makeCard(ctx, options, homeOf(options?.canvas, "card"));
				notes.push(
					`card width ${width}. One screen: about ${Math.round(width * 0.7)} px tall, about 120 words, body text 17px or larger and nothing under 14px. Its folder is ${path.replace(/\/index\.html$/, "/")}: anything it keeps beside it (card.css, chart.js, data.json) goes there. Not placed yet: decks canvas insert --type card --card ${path} --canvas ${stageName} --beside <id> puts it there, then decks canvas fit ${path}.`,
				);
				return asBoard(service.fileBoard(path) ?? { path, title });
			},
			get: board.get,
			canvases: board.canvases,
			url: board.url,
	};

	return {
		// Boards are retired: an old name that makes one makes a card instead.
		board: { ...board, create: card.create },
		card,
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

/**
 * Write a blank card, `cards/<title>/index.html` in a canvas's own folder (`card.create`, and the old
 * `newBoard`): the shell from its title, at a width held inside the screen when none is asked for.
 * Placing it is the caller's job. The viewport goes in the call's notes.
 */
export function makeCard(ctx: VerbContext, options: { title: string; w?: number; h?: number }, stageName: string): { path: string; title: string; width: number; canvas: string } {
	const { service, agent, notes, viewport } = ctx;
	const title = options?.title?.trim();
	if (!title) throw new Error("A card needs a title: the finding it states, as a sentence.");
	const view = viewport();
	const width = boardWidth(options.w, view?.width);
	const base = slug(title, 48) || "card";
	let path = `${canvasFolder(stageName)}/cards/${base}/index.html`;
	for (let n = 2; service.fileBoard(path) || existsSync(join(service.deckPath(), path)); n++) path = `${canvasFolder(stageName)}/cards/${base}-${n}/index.html`;
	service.writeCard(path, cardShell(title, { w: width, ...(options.h ? { h: options.h } : {}) }));
	agent.worked?.(path);
	if (view) notes.push(`viewport ${view.width}×${view.height} px`);
	return { path, title, width, canvas: stageName };
}
