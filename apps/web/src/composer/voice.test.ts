import assert from "node:assert/strict";
import { test } from "node:test";
import { joinHeard, micError } from "./voice.ts";

const failure = (name: string, message = "") => Object.assign(new Error(message), { name });

test("each way the browser refuses the microphone says its own reason", () => {
	assert.match(micError(failure("NotFoundError", "Requested device not found")), /No microphone is connected/);
	assert.match(micError(failure("NotAllowedError", "Permission denied by system")), /Privacy & Security › Microphone/);
	assert.match(micError(failure("NotAllowedError", "Permission denied")), /site's microphone permission is off/);
	assert.match(micError(failure("NotReadableError", "Could not start audio source")), /another app may be holding it/);
	assert.match(micError(failure("SecurityError")), /HTTPS address or localhost/);
	assert.equal(micError(failure("TypeError")), "The microphone could not start (TypeError).");
	assert.equal(micError(undefined), "The microphone could not start.");
});

test("heard pieces join with a space between words, and none in Chinese", () => {
	assert.equal(joinHeard("hello there", "general"), "hello there general");
	assert.equal(joinHeard("hello there", " general"), "hello there general");
	assert.equal(joinHeard("你好", "世界"), "你好世界");
	assert.equal(joinHeard("打开 Decks", "画布"), "打开 Decks画布");
	assert.equal(joinHeard("", "general"), "general");
	assert.equal(joinHeard("hello", ""), "hello");
});
