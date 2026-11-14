import { defineCall } from "../call.ts";
import { arr, bool, int, nul, num, opt, str, union } from "../schema.ts";
import { Point, View } from "../shapes.ts";
import { ANYONE, PEOPLE, onCanvas } from "./parts.ts";

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
