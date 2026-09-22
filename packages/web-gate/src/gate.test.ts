import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, clickTarget, fieldProbe, judgeClick, type CdpMessage, type ClickTarget } from "./gate.ts";

const command = (method: string, params: Record<string, unknown> = {}): CdpMessage => ({ id: 1, method, params });

test("typing is held, whichever way the words arrive", () => {
	assert.deepEqual(classify(command("Input.insertText", { text: "hello" })), { kind: "text", text: "hello" });
	assert.deepEqual(classify(command("Input.dispatchKeyEvent", { type: "char", text: "h" })), { kind: "text", text: "h" });
	// A keyDown carrying text is the same decision as a char carrying it.
	assert.deepEqual(classify(command("Input.dispatchKeyEvent", { type: "keyDown", text: "a" })), { kind: "text", text: "a" });
});

test("a keystroke with no text in it is navigation, and the agent keeps it", () => {
	assert.deepEqual(classify(command("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowDown" })), { kind: "pass" });
	assert.deepEqual(classify(command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab" })), { kind: "pass" });
	assert.deepEqual(classify(command("Input.insertText", { text: "" })), { kind: "pass" });
	assert.deepEqual(classify(command("Page.navigate", { url: "https://example.com" })), { kind: "pass" });
});

test("Enter is a submit and is asked about, in both the forms it arrives in", () => {
	assert.deepEqual(classify(command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", text: "\r" })), { kind: "allow", action: "press Enter" });
	assert.deepEqual(classify(command("Input.dispatchKeyEvent", { type: "char", text: "\r" })), { kind: "allow", action: "press Enter" });
	assert.deepEqual(classify(command("Input.dispatchKeyEvent", { type: "keyDown", key: "NumpadEnter" })), { kind: "allow", action: "press Enter" });
});

test("a press is read at the point it lands, and a release is not read at all", () => {
	assert.deepEqual(classify(command("Input.dispatchMouseEvent", { type: "mousePressed", x: 12, y: 34, button: "left" })), { kind: "click", x: 12, y: 34 });
	// Holding the release instead would leave a button pressed down while the question is asked.
	assert.deepEqual(classify(command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 12, y: 34, button: "left" })), { kind: "pass" });
	assert.deepEqual(classify(command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 12, y: 34 })), { kind: "pass" });
	assert.deepEqual(classify(command("Input.dispatchMouseEvent", { type: "mousePressed", button: "middle" })), { kind: "pass" });
	// Coordinates that are not numbers are not a press anybody can be asked about.
	assert.deepEqual(classify(command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left" })), { kind: "pass" });
});

test("whether a click sends anything is a question for the page, not for its name", () => {
	const submit: ClickTarget = { tag: "BUTTON", name: "Continue", submits: true, inForm: true };
	assert.deepEqual(judgeClick(submit, { x: 1, y: 2 }), { kind: "allow", action: 'click "Continue" — it submits the form' });

	const named: ClickTarget = { tag: "DIV", name: "Send", submits: false, inForm: false };
	assert.deepEqual(judgeClick(named, { x: 1, y: 2 }), { kind: "allow", action: 'click "Send"' });

	// A button in no form, called nothing in particular, is the agent's to press.
	assert.deepEqual(judgeClick({ tag: "BUTTON", name: "Next page", submits: false, inForm: false }, { x: 1, y: 2 }), { kind: "pass" });
	// Following a link is most of what the agent does, and none of it is a consequence.
	assert.deepEqual(judgeClick({ tag: "A", name: "Docs", submits: false, inForm: false, href: "https://example.com" }, { x: 1, y: 2 }), { kind: "pass" });
	// A page the gate could not read is not a reason to stop the run.
	assert.deepEqual(judgeClick(undefined, { x: 1, y: 2 }), { kind: "pass" });
});

test("what comes back from a page is checked field by field", () => {
	assert.equal(clickTarget(null), undefined);
	assert.equal(clickTarget("BUTTON"), undefined);
	assert.equal(clickTarget({ name: "Send" }), undefined, "a target with no tag is not a target");
	assert.deepEqual(clickTarget({ tag: "button", name: "Send", submits: 1, inForm: true, href: 7 }), { tag: "BUTTON", name: "Send", submits: false, inForm: true });
});

test("the probes ask about one point and one field, and read them the way a person would", () => {
	assert.match(fieldProbe(), /document\.activeElement/);
	assert.match(fieldProbe(), /aria-label/);
	assert.match(fieldProbe(), /placeholder/);
});
