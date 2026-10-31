import type { InkRequest } from "@decks/canvas";

/** What a sketch handed to the agent asks it, in words: a draft for the composer. */
export const inkAsked = (request: InkRequest): string | undefined => {
	if (request.ids.length === 0) return undefined;
	const n = request.ids.length;
	const b = request.box;
	const where = `[${n} ink ${n === 1 ? "stroke" : "strokes"} on the canvas ${request.canvas}, at x ${Math.round(b.x)} y ${Math.round(b.y)}, ${Math.round(b.w)} × ${Math.round(b.h)}: ${request.ids.join(", ")}]`;
	const keep = "Then hide the strokes, setting enabled to false on each, so they are kept in the file but not shown.";
	const asked =
		request.action === "drawing"
			? `Make this a drawing I can edit: a shape for each outline, the handwritten words as text, and arrows joined to the shapes they connect, in the same place and at the same size. ${keep}`
			: request.action === "board"
				? `Make this a board, placed where the strokes are and about their size. ${keep}`
				: "Read what is written or drawn there and act on it. If it is an instruction, carry it out; if it is a question, answer it; if it is a sketch or notes, say in a line what you read and what you would make of it.";
	return `${where}\n${asked}`;
};
