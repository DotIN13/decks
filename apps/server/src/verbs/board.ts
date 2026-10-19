import { stageBoardsDir } from "../deck/stage-boards.ts";
import { asBoardFormat, BOARD_FORMATS, boardWidth } from "../boards/templates.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/**
 * Boards and the deck's other files: board files listed, made, named and found on canvases; frames
 * and file addresses. A board file is the deck's, on any number of canvases or none: making one does
 * not place it, which is the canvas's job (`canvas.insert`).
 */
export function boardVerbs(ctx: VerbContext): Pick<Stage, "board" | "frame" | "file"> {
	const { service, agent, notes, viewport, isolated, needPens, notWhileIsolated } = ctx;

	/** Who wrote a board, as a name: an agent's, or "person" for the person's own edit. */
	const writer = (who: string | undefined): string | undefined => {
		if (!who) return undefined;
		if (who === "you") return "person";
		return agent.agents().find((one) => one.id === who)?.name ?? who;
	};
	/** Isolated, only the boards on the agent's own stage exist. */
	const visible = (path: string): boolean => !isolated() || agent.inPlay().includes(path);
	const needBoard = (path: unknown) => {
		if (typeof path !== "string" || !path.trim()) throw new Error('A board is named by its path, as in "boards/plan.html": decks board list lists them.');
		const board = service.fileBoard(path);
		if (!board || !visible(path)) throw new Error(`There is no board ${path}. decks board list lists them.`);
		return board;
	};
	const asBoard = (board: { path: string; title: string; lastWrittenBy?: string }) => {
		const by = writer(board.lastWrittenBy);
		return { path: board.path, title: board.title, ...(by ? { lastWrittenBy: by } : {}) };
	};

	return {
		board: {
			list: async () => service.allBoards().filter((board) => visible(board.path)).map(asBoard),
			create: async (options: { title: string; format?: string; w?: number; h?: number }) => {
				const title = options?.title?.trim();
				if (!title) throw new Error("A board needs a title: the finding it states, as a sentence.");
				const format = asBoardFormat(options.format ?? "board");
				if (!format) throw new Error(`Unknown format ${options.format}; use one of ${BOARD_FORMATS.join(", ")}`);
				const view = viewport();
				const width = boardWidth(options.w, view?.width, format);
				// Isolated, a new board is the stage's own from the start (`deck/stage-boards.ts`).
				const stageName = isolated() ? agent.stageName?.() : undefined;
				const path = service.newBoard({ title, format, size: { w: width, ...(options.h ? { h: options.h } : {}) }, ...(stageName ? { folder: stageBoardsDir(stageName) } : {}) });
				agent.worked?.(path);
				if (view) notes.push(`viewport ${view.width}×${view.height} px`);
				notes.push(
					`board width ${width}. One screen: about ${Math.round(width * 0.7)} px tall, about 120 words, body text 17px or larger and nothing under 14px. It is on no canvas yet: decks canvas insert '{"type":"board","board":"${path}"}' --beside <id> puts it on yours, then decks canvas fit ${path}.`,
				);
				return asBoard(service.fileBoard(path) ?? { path, title });
			},
			get: async (path: string) => asBoard(needBoard(path)),
			canvases: async (path: string) => {
				needBoard(path);
				const pens = needPens();
				const out: Array<{ board: string; canvas: string; box: { x1: number; y1: number; x2: number; y2: number }; clipped?: boolean }> = [];
				const file = service.fileBoard(path);
				for (const name of pens.names()) {
					let held;
					try {
						held = pens.boards(name).find((one) => one.path === path);
					} catch {
						continue;
					}
					if (!held) continue;
					const content = file?.content;
					const clipped = content ? content.w > held.w || content.h > held.h : undefined;
					out.push({ board: path, canvas: name, box: { x1: held.x, y1: held.y, x2: held.x + held.w, y2: held.y + held.h }, ...(clipped ? { clipped } : {}) });
				}
				return out;
			},
			url: async (path: string) => {
				needBoard(path);
				return service.url(path, ctx.port);
			},
		},
		frame: {
			create: async (path: string, item?: Record<string, unknown>) => needPens().createFile(path, item as never),
		},
		file: {
			url: async (file: string) => {
				if (isolated()) {
					const path = agent.boardPathOf(file) ?? file;
					if (!agent.inPlay().includes(path)) notWhileIsolated(`the address of ${file}, which is not on this stage,`);
				}
				return service.resolve(file);
			},
		},
	};
}
