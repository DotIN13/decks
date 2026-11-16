import { canvasFolder, canvasOfPath } from "@decks/hub/layout";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cardShell, slug } from "@decks/deck-kit";
import { boardWidth } from "../cards/size.ts";
import type { Verbs as Stage } from "@decks/sdk";
import type { VerbContext } from "./context.ts";

/**
 * Cards and saved frames: cards listed, made, named and found on their canvas, and frames made
 * (file addresses and the file calls are `calls/files.ts`). A card is a folder of its canvas's
 * `cards/`: making one does not place it, which is the canvas's job (`canvas.insert`).
 */
export function boardVerbs(ctx: VerbContext): Pick<Stage, "card" | "frame"> {
	const { service, agent, notes, needPens } = ctx;

	/** Who wrote a board, as a name: an agent's, or "person" for the person's own edit. */
	const writer = (who: string | undefined): string | undefined => {
		if (!who) return undefined;
		if (who === "you") return "person";
		return agent.agents().find((one) => one.id === who)?.name ?? who;
	};
	const needBoard = (path: unknown) => {
		if (typeof path !== "string" || !path.trim()) throw new Error('A card is named by its path, as in "canvases/plan/cards/q3/index.html": decks card list lists them.');
		const board = service.fileBoard(path);
		if (!board) throw new Error(`There is no card ${path}. decks card list lists them.`);
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
		needPens().rights.mayWrite(name);
		return name;
	};

	const card = {
			/** Every card in the deck, placed or not. */
			list: async () => service.allBoards().map(asBoard),
			get: async (path: string) => asBoard(needBoard(path)),
			canvases: async (path: string) => {
				const file = needBoard(path);
				const pens = needPens();
				// A card is in a canvas's folder, and on that canvas or on none (`deck/layout.ts`).
				const home = canvasOfPath(path);
				if (!home) return [];
				let held;
				try {
					held = pens.cards.boards(home.name).find((one) => one.path === path);
				} catch {
					return [];
				}
				if (!held) return [];
				const clipped = file.content ? file.content.w > held.w || file.content.h > held.h : undefined;
				return [{ card: path, canvas: home.name, box: { x1: held.x, y1: held.y, x2: held.x + held.w, y2: held.y + held.h }, ...(clipped ? { clipped } : {}) }];
			},
			url: async (path: string) => {
				needBoard(path);
				return service.url(path, ctx.port);
			},
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
	};

	return {
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
				return needPens().files.createFile(home && typeof asked === "string" && /^frames\//.test(asked) ? `${canvasFolder(home)}/${asked}` : path, item as never);
			},
		},
	};
}

/**
 * Write a blank card, `cards/<title>/index.html` in a canvas's own folder (`card.create`): the shell from its title, at a width held inside the screen when none is asked for.
 * Placing it is the caller's job. The viewport goes in the call's notes.
 */
function makeCard(ctx: VerbContext, options: { title: string; w?: number; h?: number }, stageName: string): { path: string; title: string; width: number; canvas: string } {
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
