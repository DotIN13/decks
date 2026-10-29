import { canvasFile } from "../stage/canvas-files.ts";
import { boxOf, placements, baseTheme, type Op } from "@decks/pen";
import { serverText } from "../stage/text.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** The drawing on your stage: notes, shapes, arrows and frames, in its pen.dev file. */
export function penVerbs(ctx: VerbContext): Pick<Stage, "pen"> {
	const { agent, needPens, needStage, here } = ctx;
	return {
		/**
		 * The stage's drawing: a native pen.dev document at `canvases/<name>/canvas.pen`.
		 *
		 * Notes, text, shapes, arrows and frames live here, all drawn over the boards by the canvas.
		 * `read` gives every item as saved plus its `box` on the stage; `edit` applies pen operations
		 * together or not at all and answers with each item's new box; `file` is the path, for an
		 * agent that would rather edit the JSON with its own tools. The wording of the format is
		 * pen.dev's, untranslated — the skill `canvas-authoring` teaches it.
		 */
		pen: {
			file: async () => canvasFile(needStage()),
			read: async (path?: string) => {
				// Any .pen file by its path (relative to frames/, or absolute in the deck); the stage's own without one.
				if (path !== undefined) return needPens().readFile(path);
				const { file: _file, ...view } = needPens().read(needStage());
				return { ...view, file: canvasFile(view.stage) };
			},
			edit: async (ops: readonly unknown[], options?: { path?: string }) => {
				const pens = needPens();
				if (options?.path !== undefined) return pens.editFile(options.path, ops as readonly Op[]);
				// Checked by `apply`, which answers a malformed edit with a sentence naming it.
				const boards = new Map(here().map((board) => [board.path, { x: board.x, y: board.y, w: board.w, h: board.h }]));
				// The person's own edits can be taken back with the stage's undo; an agent's are its work.
				const { entry, results } = pens.edit(needStage(), ops as readonly Op[], (path) => boards.get(path), agent.person ? { undoable: true } : undefined);
				const placed = placements(pens.withImported(needStage(), entry.doc), { theme: baseTheme(entry.doc, "light"), measure: serverText.measure });
				const answered = results.map((result) => {
					const box = result.op === "delete" ? undefined : boxOf(placed.get(result.id));
					return { ...result, ...(box ? { box } : {}) };
				});
				const touched = answered.filter((result) => result.box && !result.id.startsWith("board:"));
				if (touched.length > 0) agent.drew?.(needStage(), touched.map((result) => result.id), touched.map((result) => result.box!));
				return { rev: entry.rev, results: answered };
			},
			/** A new frame file in frames/, with `item` as its one reusable item, ready to be placed by the ref it answers. */
			create: async (path: string, item?: Record<string, unknown>) => needPens().createFile(path, item as never),
			/** Save an item as a frame file and, unless `replace` is false, put a ref to it in its place. */
			save: async (id: string, path: string, options?: { replace?: boolean }) => {
				if (typeof id !== "string" || !id) throw new Error("decks pen save <id> <path> needs the item's id, from decks pen read.");
				return needPens().saveFrame(needStage(), id, path, options?.replace !== false);
			},
		},
	};
}
