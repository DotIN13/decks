import assert from "node:assert/strict";
import { test } from "node:test";
import { boardEvalOf } from "./board-eval.ts";

/**
 * A board asking to run a component's code.
 *
 * The guard is the whole of the browser's job here: the message has to come from *this*
 * frame, and it has to name something. What it deliberately does **not** carry is the code —
 * that is read out of the board's file by the server, so a board cannot hand over a program
 * this way even if it wanted to.
 */

const frame = () => ({ contentWindow: {} }) as unknown as HTMLIFrameElement;
const ask = (data: unknown, source?: unknown) => ({ source, data });

test("an ask from its own frame carries the id and the value", () => {
	const one = frame();
	const asked = boardEvalOf(ask({ decks: "board.eval", id: "pick", value: "round-20" }, one.contentWindow), one);
	assert.deepEqual(asked, { decks: "board.eval", id: "pick", value: "round-20" });
});

test("no value is not a value of undefined", () => {
	const one = frame();
	const asked = boardEvalOf(ask({ decks: "board.eval", id: "go" }, one.contentWindow), one);
	assert.deepEqual(asked, { decks: "board.eval", id: "go" });
	assert.equal(Object.hasOwn(asked ?? {}, "value"), false);
});

test("a message from another window is not this board's", () => {
	assert.equal(boardEvalOf(ask({ decks: "board.eval", id: "go" }, {}), frame()), undefined);
	assert.equal(boardEvalOf(ask({ decks: "board.eval", id: "go" }), frame()), undefined);
});

test("a message that is not an ask is ignored", () => {
	const one = frame();
	assert.equal(boardEvalOf(ask({ decks: "board.open", path: "boards/a.html" }, one.contentWindow), one), undefined);
	assert.equal(boardEvalOf(ask(null, one.contentWindow), one), undefined);
	assert.equal(boardEvalOf(ask("board.eval", one.contentWindow), one), undefined);
});

test("an id that is not a name is refused", () => {
	const one = frame();
	assert.equal(boardEvalOf(ask({ decks: "board.eval", id: 7 }, one.contentWindow), one), undefined);
	assert.equal(boardEvalOf(ask({ decks: "board.eval", id: "   " }, one.contentWindow), one), undefined);
});
