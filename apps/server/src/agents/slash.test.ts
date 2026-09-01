import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSlash } from "./slash.ts";

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