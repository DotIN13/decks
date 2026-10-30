import assert from "node:assert/strict";
import { test } from "node:test";
import { decideHover, decidePress, handPans, isBareSecondTap, isSecondTap, type HoverAction, type HoverFacts, type PressAction, type PressFacts } from "./dispatch.ts";

/** A mouse's main button on bare stage, the drawing editable, the select tool, nothing under it. */
const base: PressFacts = { pointer: "mouse", button: 0, target: "stage", editable: true, drawing: false, tool: "select", space: false, fingers: 0, onItem: () => false, picture: () => undefined };
const press = (over: Partial<PressFacts>) => decidePress({ ...base, ...over });
const ITEM = { onItem: () => true };
const PICTURE = { picture: () => "boards/one.html" };

/** Target × tool × mode × pointer, and what each press starts. */
const presses: Array<[string, Partial<PressFacts>, PressAction]> = [
	// A mouse or a pen.
	["bare stage, select tool: a marquee or a pick (the reducer decides)", {}, { do: "press" }],
	["an item on bare stage", ITEM, { do: "press" }],
	["a drawn item's click shape over a board", { target: "drawn" }, { do: "press" }],
	["a pen behaves as a mouse", { pointer: "pen", target: "drawn" }, { do: "press" }],
	["a tool armed, on bare stage: it makes its item", { tool: "rectangle" }, { do: "make" }],
	["a tool armed, over a board's picture: still makes", { tool: "note", ...PICTURE }, { do: "make" }],
	["a tool armed on a board: not the stage's", { tool: "note", target: "other" }, { do: "nothing" }],
	["a board's picture: carried with the selection", PICTURE, { do: "picture", path: "boards/one.html", carry: true }],
	["a board's picture, read-only stage: only selected", { ...PICTURE, editable: false }, { do: "picture", path: "boards/one.html", carry: false }],
	["a board's picture under a drawn item: the item", { ...PICTURE, ...ITEM }, { do: "press" }],
	["a board's picture with Space held: a pan", { ...PICTURE, space: true }, { do: "pan", deselect: true, middle: false }],
	["a board's picture with the pen out: a pan that lets the board go", { ...PICTURE, drawing: true }, { do: "pan", deselect: true, middle: false }],
	["read-only stage, bare: a pan that lets the board go", { editable: false }, { do: "pan", deselect: true, middle: false }],
	["read-only stage, on an item: a pan", { editable: false, ...ITEM }, { do: "pan", deselect: true, middle: false }],
	["the pen out, on bare stage: a pan", { drawing: true }, { do: "pan", deselect: true, middle: false }],
	["Space and a drag on bare stage: a pan", { space: true }, { do: "pan", deselect: true, middle: false }],
	["Space and a drag over a board: a pan, the board kept", { space: true, target: "other" }, { do: "pan", deselect: false, middle: false }],
	["the middle button on bare stage: a pan", { button: 1 }, { do: "pan", deselect: false, middle: true }],
	["the middle button over a board: a pan", { button: 1, target: "other" }, { do: "pan", deselect: false, middle: true }],
	["the right button on bare stage: nothing", { button: 2 }, { do: "nothing" }],
	["the main button on a board: the board's own", { target: "other" }, { do: "nothing" }],
	// A finger.
	["a finger on bare stage: pooled, and a tap lets go", { pointer: "touch" }, { do: "touch", then: "deselect" }],
	["a finger on an item: pooled, and it taps or carries", { pointer: "touch", ...ITEM }, { do: "touch", then: "drawing" }],
	["a finger on a drawn click shape", { pointer: "touch", target: "drawn" }, { do: "touch", then: "drawing" }],
	["a finger with a tool armed: it makes", { pointer: "touch", tool: "card" }, { do: "make" }],
	["a finger with a tool armed, as the second finger: a pinch, no item", { pointer: "touch", tool: "card", fingers: 1 }, { do: "touch" }],
	["a finger on a board's picture: the board selected, then pooled", { pointer: "touch", ...PICTURE }, { do: "touch", picture: "boards/one.html" }],
	["a finger on a picture under an item: the item", { pointer: "touch", ...PICTURE, ...ITEM }, { do: "touch", then: "drawing" }],
	["a second finger on a picture: a pinch only", { pointer: "touch", ...PICTURE, fingers: 1 }, { do: "touch" }],
	["a finger on a picture, read-only: the board", { pointer: "touch", ...PICTURE, editable: false }, { do: "touch", picture: "boards/one.html" }],
	["a finger on a picture under an item, read-only: the board", { pointer: "touch", ...PICTURE, ...ITEM, editable: false }, { do: "touch", picture: "boards/one.html" }],
	["a finger on an item, read-only: only pooled", { pointer: "touch", ...ITEM, editable: false }, { do: "touch" }],
	["a finger with the pen out: only pooled", { pointer: "touch", drawing: true }, { do: "touch" }],
	["a finger on a board: only pooled", { pointer: "touch", target: "other" }, { do: "touch" }],
];

for (const [name, over, want] of presses) test(`press: ${name}`, () => assert.deepEqual(press(over), want));

test("press: what is under it is asked only when it decides", () => {
	let asked = 0;
	const counted = { onItem: () => (asked++, false), picture: () => (asked++, undefined) };
	press({ ...counted, tool: "rectangle", target: "other" });
	assert.equal(asked, 0, "a tool on a board asks nothing");
	press({ ...counted, pointer: "touch", tool: "rectangle" });
	assert.equal(asked, 0, "a finger with a tool asks nothing");
	press({ ...counted, button: 1 });
	assert.equal(asked, 0, "the middle button asks nothing");
	press({ ...counted, space: true });
	assert.equal(asked, 0, "Space asks nothing");
});

const hoverBase: HoverFacts = { pointer: "mouse", editable: true, editing: true, drawing: false, onGrip: false, buttons: 0, tool: "select", target: "stage" };
const hovers: Array<[string, Partial<HoverFacts>, HoverAction]> = [
	["a mouse over the stage: followed", {}, { do: "track", outlines: true }],
	["a pen over a drawn click shape: followed", { pointer: "pen", target: "drawn" }, { do: "track", outlines: true }],
	["browsing: followed for a link's hand only, nothing lit", { editing: false }, { do: "track", outlines: false }],
	["browsing over a drawn click shape: the same", { editing: false, target: "drawn" }, { do: "track", outlines: false }],
	["a finger: nothing", { pointer: "touch" }, { do: "none" }],
	["a read-only stage: nothing", { editable: false }, { do: "none" }],
	["the pen out: nothing", { drawing: true }, { do: "none" }],
	["on a grip: kept", { onGrip: true, buttons: 1 }, { do: "none" }],
	["a button held: cleared, the grip kept", { buttons: 1 }, { do: "clear", block: false }],
	["a tool armed: cleared, the grip too", { tool: "rectangle" }, { do: "clear", block: true }],
	["over a board: cleared, the grip too", { target: "other" }, { do: "clear", block: true }],
	["the hand: cleared, the grip too, browsing or editing", { hand: true }, { do: "clear", block: true }],
	["the hand browsing over a drawn card: the same", { hand: true, editing: false, target: "drawn" }, { do: "clear", block: true }],
];
for (const [name, over, want] of hovers) test(`hover: ${name}`, () => assert.deepEqual(decideHover({ ...hoverBase, ...over }), want));

test("taps: a second tap on the same item within 400 ms", () => {
	assert.equal(isSecondTap(undefined, "a", 1000), false);
	assert.equal(isSecondTap({ id: "a", at: 1000 }, "a", 1399), true);
	assert.equal(isSecondTap({ id: "a", at: 1000 }, "a", 1400), false);
	assert.equal(isSecondTap({ id: "a", at: 1000 }, "b", 1100), false);
});

test("taps: two on bare canvas within 350 ms and 30 px", () => {
	const first = { x: 100, y: 100, at: 1000 };
	assert.equal(isBareSecondTap(undefined, { x: 100, y: 100 }, 1000), false);
	assert.equal(isBareSecondTap(first, { x: 120, y: 120 }, 1349), true);
	assert.equal(isBareSecondTap(first, { x: 100, y: 100 }, 1350), false);
	assert.equal(isBareSecondTap(first, { x: 130, y: 100 }, 1100), false);
	assert.equal(isBareSecondTap(first, { x: 129, y: 100 }, 1100), true);
});

test("the hand: a press anywhere pans, whatever it lands on, but a control keeps its press and a finger pans its own way", () => {
	assert.equal(handPans({ hand: true, pointer: "mouse", button: 0, control: false }), true);
	assert.equal(handPans({ hand: true, pointer: "pen", button: 0, control: false }), true);
	assert.equal(handPans({ hand: true, pointer: "mouse", button: 0, control: true }), false);
	assert.equal(handPans({ hand: true, pointer: "touch", button: 0, control: false }), false);
	assert.equal(handPans({ hand: true, pointer: "mouse", button: 2, control: false }), false);
	assert.equal(handPans({ hand: false, pointer: "mouse", button: 0, control: false }), false);
	// And on the stage's own path, a press on a drawn item with the hand pans rather than picking it up.
	const facts: PressFacts = { pointer: "mouse", button: 0, target: "drawn", editable: true, drawing: false, tool: "select", space: true, fingers: 0, onItem: () => true, picture: () => undefined };
	assert.deepEqual(decidePress(facts), { do: "pan", deselect: true, middle: false });
	assert.deepEqual(decidePress({ ...facts, target: "other" }), { do: "pan", deselect: false, middle: false });
});
