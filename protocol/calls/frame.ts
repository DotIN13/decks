import { defineCall } from "../call.ts";
import { arr, bool, opt, str } from "../schema.ts";
import { Frame, Item } from "../shapes.ts";
import { ANYONE, NOT_CARD, onCanvas } from "./parts.ts";

// Reusable frames: .pen files in a canvas's frames/, placed as refs.
// Their items are read and changed with item.* given { frame }.

export const list = defineCall({
	name: "frame.list",
	summary: "The frame files of a canvas.",
	who: NOT_CARD,
	args: { ...onCanvas },
	answer: arr(Frame),
	effect: "read",
});

export const get = defineCall({
	name: "frame.get",
	summary: "One frame file and its reusable item.",
	who: NOT_CARD,
	args: { path: str("frames/<name>"), ...onCanvas },
	answer: Frame,
	effect: "read",
});

export const create = defineCall({
	name: "frame.create",
	summary: "A new frame file at path, with item as its one reusable item.",
	who: ANYONE,
	args: { path: str(), item: opt(Item), ...onCanvas },
	answer: Frame,
	effect: "change",
});

export const save = defineCall({
	name: "frame.save",
	summary: "Save an item as a frame file, and put a ref to it in its place (replace: false leaves the canvas alone).",
	who: ANYONE,
	args: { id: str(), path: str(), replace: opt(bool()), ...onCanvas },
	answer: Frame,
	effect: "change",
});
