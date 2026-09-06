import assert from "node:assert/strict";
import { test } from "node:test";
import { helpText, mergeCommands, parseSlash, sameCommands } from "./slash.ts";

test("a slash prompt is a command with its argument", () => {
	assert.deepEqual(parseSlash("/login"), { name: "login", args: "" });
	assert.deepEqual(parseSlash("/compact keep the plan"), { name: "compact", args: "keep the plan" });
	assert.deepEqual(parseSlash("/name Ada   "), { name: "name", args: "Ada" });
	assert.deepEqual(parseSlash("/session   "), { name: "session", args: "" });
});

test("commands are case-insensitive; the argument is not touched", () => {
	assert.deepEqual(parseSlash("/Cost 12.30"), { name: "cost", args: "12.30" });
});

test("only a bare slash is not a command", () => {
	assert.equal(parseSlash("/"), undefined);
	assert.equal(parseSlash("/ "), undefined);
});

test("plain prose is not a command, even with a slash inside it", () => {
	assert.equal(parseSlash("say /login to authenticate"), undefined);
	assert.equal(parseSlash("what is /dev/null?"), undefined);
	assert.equal(parseSlash(""), undefined);
});
const deck = (name: string, aliases?: string[]) => ({ name, source: "deck" as const, ...(aliases ? { aliases } : {}) });
const runtime = (name: string, aliases?: string[]) => ({ name, source: "runtime" as const, ...(aliases ? { aliases } : {}) });

test("the runtime's commands come after the deck's, and its duplicates are dropped", () => {
	const merged = mergeCommands([deck("login"), deck("help")], [runtime("help"), runtime("doctor"), runtime("compact")]);
	assert.deepEqual(
		merged.map((command) => command.name),
		["login", "help", "doctor", "compact"],
	);
	// The surviving `help` is the deck's, not the runtime's.
	assert.equal(merged.find((command) => command.name === "help")?.source, "deck");
});

test("an alias the deck claims takes the runtime's namesake with it", () => {
	// Claude resolves /cost to /usage; listing both is two rows for one reading.
	const merged = mergeCommands([deck("cost", ["usage", "stats"])], [runtime("usage"), runtime("doctor")]);
	assert.deepEqual(
		merged.map((command) => command.name),
		["cost", "doctor"],
	);
});

test("a runtime that declares a name twice is listed once", () => {
	const merged = mergeCommands([], [runtime("review"), runtime("review"), runtime("plan")]);
	assert.deepEqual(
		merged.map((command) => command.name),
		["review", "plan"],
	);
});

test("a menu is unchanged when the names, hints and arguments are", () => {
	assert.equal(sameCommands([{ name: "a", hint: "one" }], [{ name: "a", hint: "one" }]), true);
	assert.equal(sameCommands([{ name: "a", hint: "one" }], [{ name: "a", hint: "two" }]), false);
	assert.equal(sameCommands([{ name: "a" }], [{ name: "a" }, { name: "b" }]), false);
});

test("help describes the deck's own and only names the runtime's", () => {
	const text = helpText([
		{ name: "login", hint: "Sign in", source: "deck" },
		{ name: "doctor", hint: "Check the install", source: "runtime" },
		{ name: "review", hint: "Review the branch", source: "runtime" },
	]);
	assert.match(text, /\/login — Sign in/);
	assert.match(text, /And 2 from the runtime/);
	assert.match(text, /\/doctor \/review/);
	// The runtime's hints are not repeated: that is what the menu is for.
	assert.doesNotMatch(text, /Check the install/);
});

test("help on an empty menu says so", () => {
	assert.equal(helpText([]), "No commands.");
});
