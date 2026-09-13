import assert from "node:assert/strict";
import { test } from "node:test";
import { closeHistory, edgeOwner, historyButton, resetEdge, setInspectable, toggleHistory } from "./edge.ts";

/*
 * The right edge has one occupant and two claimants. Every case here is one a naive
 * `if (selected) hideHistory()` gets wrong, which is why the rule is a bit of state rather
 * than a condition.
 */

test("nothing wanted, nothing selected", () => {
	resetEdge();
	assert.equal(edgeOwner(), "none");
	assert.equal(historyButton(), "off");
});

test("the button shows the history", () => {
	resetEdge();
	toggleHistory();
	assert.equal(edgeOwner(), "history");
	assert.equal(historyButton(), "on");
});

test("selecting makes the history yield, and deselecting gives it back", () => {
	resetEdge();
	toggleHistory();
	setInspectable(true);
	assert.equal(edgeOwner(), "inspector");
	assert.equal(historyButton(), "yield", "yielded must not look like off");
	setInspectable(false);
	assert.equal(edgeOwner(), "history", "it was never unwanted, so it comes back");
});

test("closing it while yielded turns it off for good", () => {
	resetEdge();
	toggleHistory();
	setInspectable(true);
	closeHistory();
	setInspectable(false);
	assert.equal(edgeOwner(), "none", "dismissing it must not be undone by an unrelated click");
	assert.equal(historyButton(), "off");
});

test("pressing the button while yielded takes the edge back, keeping the selection", () => {
	resetEdge();
	toggleHistory();
	setInspectable(true);
	assert.equal(edgeOwner(), "inspector");
	toggleHistory();
	assert.equal(edgeOwner(), "history", "the most recent explicit act wins");
	assert.equal(historyButton(), "on");
	// And the selection survives it: closing the history hands the edge straight back.
	closeHistory();
	assert.equal(edgeOwner(), "inspector");
});

test("selecting while nothing is wanted does not turn the history on", () => {
	resetEdge();
	setInspectable(true);
	assert.equal(edgeOwner(), "inspector");
	assert.equal(historyButton(), "off");
	setInspectable(false);
	assert.equal(edgeOwner(), "none");
});

test("a second selection does not steal the edge from a history that claimed it", () => {
	resetEdge();
	setInspectable(true);
	toggleHistory();
	assert.equal(edgeOwner(), "history");
	// Selecting something *else* while already selected is not a new act.
	setInspectable(true);
	assert.equal(edgeOwner(), "history");
});
