import assert from "node:assert/strict";
import { test } from "node:test";
import type { PageEnd } from "../protocol.ts";
import { chooseFrame, type Held } from "./held.ts";

let made = 0;
/** A frame on a canvas, started (its element and its line there) unless said otherwise. */
const on = (canvas: string | undefined, started = true): Held => ({ n: ++made, canvas, ...(started ? { frame: {} as HTMLIFrameElement, end: {} as PageEnd } : {}) });
const yours = () => true;
const make = (canvas: string): Held => ({ n: ++made, canvas });

test("with nothing kept, a move takes the one frame to the next canvas in place, as it always did", () => {
	const a = on("a");
	const choice = chooseFrame({ held: [a], front: a, spare: undefined, canvas: "b", kept: [], inPlace: yours, make });
	assert.equal(choice.how, "moved");
	assert.equal(choice.next, a);
	assert.deepEqual(choice.gone, []);
});

test("a canvas kept behind keeps its frame, and coming back to it is the frame it had", () => {
	const a = on("a");
	// From a to b, with a kept: nothing is free to move, so b gets a new frame and a stays.
	const away = chooseFrame({ held: [a], front: a, spare: undefined, canvas: "b", kept: ["a"], inPlace: yours, make });
	assert.equal(away.how, "new");
	assert.equal(away.next?.canvas, "b");
	assert.deepEqual(away.gone, []);
	const b = away.next!;
	Object.assign(b, { frame: {}, end: {} });
	const back = chooseFrame({ held: [a, b], front: b, spare: undefined, canvas: "a", kept: ["b"], inPlace: yours, make });
	assert.equal(back.how, "held");
	assert.equal(back.next, a);
	assert.deepEqual(back.gone, []);
});

test("the spare frame takes a canvas that has none: before a frame moves in place when it has loaded, after when it has not, and always before a new one is made", () => {
	const a = on("a");
	const loading: Held = { ...on(undefined, false), waiting: { said: () => false, stop: () => {} } };
	const loaded: Held = { ...on(undefined, false), waiting: { said: () => true, stop: () => {} } };
	// Nothing free to move: the spare, loaded or not.
	for (const spare of [loading, loaded]) {
		const choice = chooseFrame({ held: [a], front: a, spare, canvas: "b", kept: ["a"], inPlace: yours, make });
		assert.equal(choice.how, "spare");
		assert.equal(choice.next, spare);
	}
	// A frame nothing wants and a spare that has loaded: the spare, whose engine is started; the other goes.
	const warm = chooseFrame({ held: [a], front: a, spare: loaded, canvas: "b", kept: [], inPlace: yours, make });
	assert.equal(warm.how, "spare");
	assert.deepEqual(warm.gone, [a]);
	// A spare still loading: the frame on the page moves, as it would with no spare.
	const cold = chooseFrame({ held: [a], front: a, spare: loading, canvas: "b", kept: [], inPlace: yours, make });
	assert.equal(cold.how, "moved");
	assert.equal(cold.next, a);
});

test("beyond what is kept, the frame nothing wants moves, and the rest that nothing wants go", () => {
	const a = on("a");
	const b = on("b");
	const c = on("c");
	// On c, moving to d, keeping only c: a and b are unwanted; one moves, the other goes.
	const choice = chooseFrame({ held: [a, b, c], front: c, spare: undefined, canvas: "d", kept: ["c"], inPlace: yours, make });
	assert.equal(choice.how, "moved");
	assert.ok(choice.next === a || choice.next === b);
	assert.deepEqual(choice.gone, [choice.next === a ? b : a]);
	// The one that was in front moves first when it is among the unwanted.
	const front = chooseFrame({ held: [a, b, c], front: b, spare: undefined, canvas: "d", kept: ["c"], inPlace: yours, make });
	assert.equal(front.next, b);
});

test("a frame is never moved to or from a canvas that is not yours alone, nor before it has started", () => {
	const friend = on("shared/ada/plan");
	const notYet = on("a", false);
	const inPlace = (from: string, to: string) => ![from, to].some((name) => name.startsWith("shared/"));
	const fromFriend = chooseFrame({ held: [friend], front: friend, spare: undefined, canvas: "b", kept: [], inPlace, make });
	assert.equal(fromFriend.how, "new");
	assert.deepEqual(fromFriend.gone, [friend]);
	const early = chooseFrame({ held: [notYet], front: notYet, spare: undefined, canvas: "b", kept: [], inPlace, make });
	assert.equal(early.how, "new");
	assert.deepEqual(early.gone, [notYet]);
});

test("with no canvas on screen, nothing is in front, and only what is kept stays", () => {
	const a = on("a");
	const b = on("b");
	const choice = chooseFrame({ held: [a, b], front: a, spare: undefined, canvas: undefined, kept: ["b"], inPlace: yours, make });
	assert.equal(choice.how, "none");
	assert.equal(choice.next, undefined);
	assert.deepEqual(choice.gone, [a]);
});
