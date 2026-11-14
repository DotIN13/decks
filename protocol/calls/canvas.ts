import { defineCall } from "../call.ts";
import { arr, bool, lit, num, opt, str, union } from "../schema.ts";
import { BoxChange, Canvas, Deleted, File, Screenshot } from "../shapes.ts";
import { ANYONE, NOT_CARD, PEOPLE, PERSON, onCanvas, onItems } from "./parts.ts";

// Canvases as wholes: list, make, rename, delete, undo, picture, export.

export const list = defineCall({
	name: "canvas.list",
	summary: "Every canvas in the deck, and who has each open.",
	who: NOT_CARD,
	args: {},
	answer: arr(Canvas),
	effect: "read",
});

export const get = defineCall({
	name: "canvas.get",
	summary: "One canvas: its title, file, revision, variables and whether a step can be undone.",
	who: ANYONE,
	args: { ...onCanvas },
	answer: Canvas,
	effect: "read",
});

export const here = defineCall({
	name: "canvas.here",
	summary: "The canvas a call means when it names none: an agent's home, a card's own canvas, the canvas on the person's screen.",
	who: ANYONE,
	args: {},
	answer: Canvas,
	effect: "read",
});

export const create = defineCall({
	name: "canvas.create",
	summary: "A new, empty canvas named from a title. Nobody moves to it.",
	who: PEOPLE,
	args: { title: str() },
	answer: Canvas,
	effect: "change",
});

export const update = defineCall({
	name: "canvas.update",
	summary: "Change what the person calls a canvas. Its folder never changes.",
	who: PEOPLE,
	args: { title: str(), ...onCanvas },
	answer: Canvas,
	effect: "change",
});

export const remove = defineCall({
	name: "canvas.delete",
	summary: "Delete a canvas: its folder and everything in it.",
	who: PERSON,
	args: { canvas: str() },
	answer: Deleted,
	effect: "change",
});

export const copy = defineCall({
	name: "canvas.copy",
	summary: "Copy a canvas into a new one of yours, titled Copy of... or title. How a canvas shared to view is changed.",
	who: PEOPLE,
	args: { canvas: str(), title: opt(str()) },
	answer: Canvas,
	effect: "change",
});

export const undo = defineCall({
	name: "canvas.undo",
	summary: "Take back the person's last edit to the drawing, or put it back with redo. Refused when someone changed it since.",
	who: ["person", "card"],
	args: { redo: opt(bool()), ...onCanvas },
	answer: Canvas,
	effect: "change",
});

export const screenshot = defineCall({
	name: "canvas.screenshot",
	summary: "A picture of the canvas or part of it (of: ids, a card's path, or a box), drawing and cards together.",
	who: NOT_CARD,
	args: {
		of: opt(union(str(), arr(str()), BoxChange)),
		scale: opt(num()),
		format: opt(lit("png", "jpeg", "pdf")),
		to: opt(str("A path in the deck to keep the file at.")),
		scheme: opt(lit("light", "dark")),
		live: opt(bool()),
		...onCanvas,
	},
	answer: Screenshot,
	effect: "read",
});

export const exportPage = defineCall({
	name: "canvas.export",
	summary: "Items as one self-contained web page in the deck, inline styles or Tailwind classes.",
	who: NOT_CARD,
	args: { of: union(str(), arr(str())), format: opt(lit("html", "tailwind")), to: opt(str()), ...onItems },
	answer: File,
	effect: "change",
});
