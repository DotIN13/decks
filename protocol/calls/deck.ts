import { defineCall } from "../call.ts";
import { bool, nul, opt, str, union } from "../schema.ts";
import { Deck, Deleted, Now, Pairing } from "../shapes.ts";
import { ANYONE, NOT_CARD, PERSON } from "./parts.ts";

// The deck as a whole: its settings, the clock, and pairing other front ends.

export const get = defineCall({
	name: "deck.get",
	summary: "The deck as its server sees it: versions, settings, and warnings from opening it.",
	who: NOT_CARD,
	args: {},
	answer: Deck,
	effect: "read",
});

export const update = defineCall({
	name: "deck.update",
	summary: "The deck's settings: the person's timezone (null for the machine's), and whether a front end needs a code.",
	who: PERSON,
	args: { timezone: opt(union(str(), nul)), requireCode: opt(bool()) },
	answer: Deck,
	effect: "change",
});

export const now = defineCall({
	name: "deck.now",
	summary: "The time where the person is.",
	who: ANYONE,
	args: {},
	answer: Now,
	effect: "read",
});

export const pair = defineCall({
	name: "deck.pair",
	summary: "A six-digit code another front end pairs with, for ten minutes, once. Only on the server's own machine.",
	who: PERSON,
	args: {},
	answer: Pairing,
	effect: "change",
});

export const revoke = defineCall({
	name: "deck.revoke",
	summary: "Take back a paired front end's token.",
	who: PERSON,
	args: { id: str() },
	answer: Deleted,
	effect: "change",
});
