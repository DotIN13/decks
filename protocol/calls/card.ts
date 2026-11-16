import { defineCall } from "../call.ts";
import { arr, num, opt, str, union } from "../schema.ts";
import { Card, Placement } from "../shapes.ts";
import { AGENT, ANYONE, NOT_CARD, PERSON, onCanvas } from "./parts.ts";

// Cards: folders of HTML in a canvas's cards/. Their files are file.* calls.

export const list = defineCall({
	name: "card.list",
	summary: "Every card in the deck, placed or not.",
	who: NOT_CARD,
	args: {},
	answer: arr(Card),
	effect: "read",
});

export const get = defineCall({
	name: "card.get",
	summary: "A card's title, who last wrote it, and where it sits on its canvas.",
	who: ANYONE,
	args: { card: str("The card's folder or its index.html.") },
	answer: Card,
	effect: "read",
});

export const create = defineCall({
	name: "card.create",
	summary: "Write a blank card in a canvas's cards/: a folder named from the title. Placing it is item.insert.",
	who: ANYONE,
	args: { title: str("The finding, as a sentence."), w: opt(num()), h: opt(num()), ...onCanvas },
	answer: Card,
	effect: "change",
});

export const fit = defineCall({
	name: "card.fit",
	summary: "Set a card's height from its content, measured at its width on this canvas. The notes say what the browser found.",
	who: ANYONE,
	args: { card: str(), margin: opt(num()), ...onCanvas },
	answer: Placement,
	effect: "change",
});

export const claim = defineCall({
	name: "card.claim",
	summary: "Say these cards carry your work, without showing them: you become their writer.",
	who: AGENT,
	args: { cards: union(str(), arr(str())) },
	answer: arr(Card),
	effect: "change",
});

export const url = defineCall({
	name: "card.url",
	summary: "The card's address as a page of its own, for a browser such as Playwright.",
	who: ANYONE,
	args: { card: str() },
	answer: str(),
	effect: "read",
});

export const seen = defineCall({
	name: "card.seen",
	summary: "The person read the card now; it is no longer news to them. Answers the card with seen set.",
	who: PERSON,
	args: { card: str() },
	answer: Card,
	effect: "change",
});
