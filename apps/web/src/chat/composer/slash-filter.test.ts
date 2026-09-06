import assert from "node:assert/strict";
import { test } from "node:test";
import type { SlashCommand } from "@decks/protocol";
import { filterCommands } from "./SlashMenu.tsx";

const cmd = (name: string, aliases?: string[]): SlashCommand => ({ name, ...(aliases ? { aliases } : {}) });

test("what was typed in full is what Enter picks", () => {
	// Claude declares /usage-credits before /usage; a plain prefix filter selected the
	// longer one, which is a different command that does something else.
	const matches = filterCommands([cmd("usage-credits"), cmd("extra-usage"), cmd("usage")], "usage");
	assert.equal(matches[0]?.name, "usage");
});

test("prefixes come before substrings", () => {
	const matches = filterCommands([cmd("extra-usage"), cmd("usage-credits")], "usage");
	assert.deepEqual(
		matches.map((match) => match.name),
		["usage-credits", "extra-usage"],
	);
});

test("an alias finds the command it resolves to, under its own name", () => {
	const matches = filterCommands([cmd("doctor"), cmd("cost", ["stats"])], "stats");
	assert.deepEqual(
		matches.map((match) => match.name),
		["cost"],
	);
});

test("an empty query is the whole list, in the order given", () => {
	assert.deepEqual(
		filterCommands([cmd("b"), cmd("a")], "").map((match) => match.name),
		["b", "a"],
	);
});

test("the list is capped at fifty", () => {
	const many = Array.from({ length: 70 }, (_, index) => cmd(`c${index}`));
	assert.equal(filterCommands(many, "").length, 50);
	assert.equal(filterCommands(many, "c").length, 50);
});

test("nothing matching is nothing, which is what closes the menu", () => {
	assert.deepEqual(filterCommands([cmd("usage")], "zzz"), []);
});
