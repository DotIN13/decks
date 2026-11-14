import { defineCall } from "../call.ts";
import { any, arr, bool, int, lit, nul, num, obj, opt, rec, str, union } from "../schema.ts";
import { Canvas, Clip, Deleted, Item, ItemOp, Point, SizeChange } from "../shapes.ts";
import { ANYONE, onCanvas, onItems } from "./parts.ts";

// Everything on one canvas, cards included. The verbs are pen.dev's ops.

const Parent = union(str(), nul);
const Place = { at: opt(Point), beside: opt(str("An item's id or a card's path: 160 px to its right.")), below: opt(str("160 px under it.")), parent: opt(Parent), index: opt(int()) };
const Resolve = obj({ variables: opt(bool()), instances: opt(bool()), geometry: opt(bool()) });

export const list = defineCall({
	name: "item.list",
	summary: "Everything on the canvas, each with its box. depth keeps that many levels of children; resolve works values out.",
	who: ANYONE,
	args: { ...onItems, depth: opt(int()), resolve: opt(Resolve), theme: opt(rec(str())) },
	answer: arr(Item),
	effect: "read",
});

export const get = defineCall({
	name: "item.get",
	summary: "One item and what is in it, by id, a card's path, or an id inside an instance (card-1/label).",
	who: ANYONE,
	args: { id: str(), ...onItems, depth: opt(int()), resolve: opt(Resolve) },
	answer: Item,
	effect: "read",
});

export const insert = defineCall({
	name: "item.insert",
	summary: "Add an item: a card ({ type: card, card } or { type: card, html }), an app, a document, or any pen.dev item. Say where with at, beside, below or parent.",
	who: ANYONE,
	args: { item: Item, ...Place, ...onItems },
	answer: Item,
	effect: "change",
});

export const update = defineCall({
	name: "item.update",
	summary: "Change an item's fields (set), its corner (at) or its size. A card's size is its size on this canvas.",
	who: ANYONE,
	args: { id: str(), set: opt(rec(any())), at: opt(Point), size: opt(SizeChange), ...onItems },
	answer: Item,
	effect: "change",
});

export const replace = defineCall({
	name: "item.replace",
	summary: "Swap a whole item for another, keeping its id and place unless the new one says otherwise.",
	who: ANYONE,
	args: { id: str(), item: Item, ...onItems },
	answer: Item,
	effect: "change",
});

export const remove = defineCall({
	name: "item.delete",
	summary: "Take an item off the canvas. A card's folder stays in the deck.",
	who: ANYONE,
	args: { id: str(), ...onItems },
	answer: Deleted,
	effect: "change",
});

export const move = defineCall({
	name: "item.move",
	summary: "Move an item to a corner, 160 px clear of another, or into a frame (parent null for the canvas).",
	who: ANYONE,
	args: { id: str(), ...Place, ...onItems },
	answer: Item,
	effect: "change",
});

export const copy = defineCall({
	name: "item.copy",
	summary: "Duplicate an item, with a new id or the one in as, at a corner or in a frame.",
	who: ANYONE,
	args: { id: str(), as: opt(str()), at: opt(Point), parent: opt(Parent), ...onItems },
	answer: Item,
	effect: "change",
});

export const batch = defineCall({
	name: "item.batch",
	summary: "Several item changes applied together or not at all. A later op may be beside an item an earlier one made.",
	who: ANYONE,
	args: { ops: arr(ItemOp), ...onItems, for: opt(str("The agent a person's edit is for, so it lands in that agent's news.")) },
	answer: arr(Item),
	effect: "change",
});

export const clip = defineCall({
	name: "item.clip",
	summary: "Hold a copy of items for a paste on another canvas of this server, under id, for a day. Nothing changes.",
	who: ANYONE,
	args: { ids: arr(str()), id: str("A fresh random id you choose."), ...onCanvas },
	answer: Clip,
	effect: "read",
});

export const paste = defineCall({
	name: "item.paste",
	summary: "Put in what item.clip holds, as one undoable edit: new ids, joined arrows, and the cards and files they need.",
	who: ANYONE,
	args: { clip: obj({ id: str(), canvas: str() }, true), at: opt(Point), ...onCanvas },
	answer: arr(Item),
	effect: "change",
});

export const space = defineCall({
	name: "item.space",
	summary: "Where a box of size fits, nearest the middle or on one side of near, touching nothing. Nothing is placed.",
	who: ANYONE,
	args: { size: obj({ w: num(), h: num() }), near: opt(str()), side: opt(lit("right", "below", "left", "above")), margin: opt(num()), ...onItems },
	answer: Point,
	effect: "read",
});

export const variables = defineCall({
	name: "item.variables",
	summary: "Set the canvas's colour tokens and other variables, used as $name in any field. { light, dark } follows the theme; null removes one.",
	who: ANYONE,
	args: { set: rec(any()), themes: opt(union(rec(arr(str())), nul)), ...onItems },
	answer: Canvas,
	effect: "change",
});
