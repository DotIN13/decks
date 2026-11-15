import { defineCall } from "../call.ts";
import { any, arr, bool, int, lit, named, nul, num, obj, opt, str, union } from "../schema.ts";
import { Camera, Point, View } from "../shapes.ts";
import { ANYONE, NOT_CARD, PEOPLE, PERSON, onCanvas } from "./parts.ts";

// What a screen shows. Only these calls move the person's screen, and only
// while the caller's chat is on it; otherwise the person is offered a button.

export const get = defineCall({
	name: "view.get",
	summary: "Where the person's screen looks on the canvas, its zoom, and its size.",
	who: ANYONE,
	args: { ...onCanvas },
	answer: View,
	effect: "read",
});

export const move = defineCall({
	name: "view.move",
	summary: "Move the camera outright. From the person's own page, it records where their screen is.",
	who: ANYONE,
	args: { x: num(), y: num(), zoom: num(), animate: opt(bool()), device: opt(str()), agent: opt(str("The agent whose conversation this screen shows: the screen follows it.")), ...onCanvas },
	answer: View,
	effect: "change",
});

export const focus = defineCall({
	name: "view.focus",
	summary: "Fly to items or a card, outlining one data-id block inside a card when asked.",
	who: ANYONE,
	args: { target: union(str(), arr(str())), highlight: opt(str()), animate: opt(bool()), ...onCanvas },
	answer: View,
	effect: "change",
});

export const goto = defineCall({
	name: "view.goto",
	summary: "Move your conversation to a canvas, as the canvas switcher does: it becomes your home.",
	who: PEOPLE,
	args: { canvas: str() },
	answer: View,
	effect: "change",
});

export const cursor = defineCall({
	name: "view.cursor",
	summary: "A labelled dot on a card, at the card's coordinates; null removes it.",
	who: ANYONE,
	args: { card: str(), at: union(Point, nul) },
	answer: View,
	effect: "change",
});

export const reload = defineCall({
	name: "view.reload",
	summary: "Reload a card in every screen showing it, for a change the watcher cannot see. Answers how many reloaded.",
	who: ANYONE,
	args: { card: opt(str()), ...onCanvas },
	answer: int(),
	effect: "change",
});

const Shot = named("Shot", obj({ how: lit("canvas", "snapshot"), data: str("The picture, base64."), mime: str() }), "A card as a screen draws it now.");

export const screenshot = defineCall({
	name: "view.screenshot",
	summary: "A card as the person's screen draws it now. Unavailable when no screen shows its canvas or none answers in 20 s.",
	who: NOT_CARD,
	args: { card: str(), ...onCanvas },
	answer: Shot,
	effect: "read",
});

export const answer = defineCall({
	name: "view.answer",
	summary: "A screen answers a view.requested that carried an id: its value, or why it could not.",
	who: PERSON,
	args: { id: str(), value: opt(any()), error: opt(str()) },
	answer: obj({ ok: bool() }),
	effect: "change",
});

export const update = defineCall({
	name: "view.update",
	summary: "A screen says where it points, what it selected and where it looks; the others on the canvas hear view.changed.",
	who: PERSON,
	args: { pointer: opt(union(Point, nul)), selection: opt(arr(str())), camera: opt(Camera), gone: opt(bool()), ...onCanvas },
	answer: View,
	effect: "change",
});
