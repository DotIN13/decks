import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPanelWidth, loadPanelWidth, PANEL_MAX, PANEL_MIN, PANEL_WIDTH, PANEL_WIDTH_KEY, savePanelWidth } from "./panel-width.ts";

function fakeStorage(initial: Record<string, string> = {}): Storage {
	const data: Record<string, string> = { ...initial };
	return {
		get length() {
			return Object.keys(data).length;
		},
		clear: () => {},
		getItem: (k) => (k in data ? (data[k] as string) : null),
		key: () => null,
		removeItem: (k) => {
			delete data[k];
		},
		setItem: (k, v) => {
			data[k] = String(v);
		},
	};
}

test("the sidebar's width stays between its limits, and under half the window", () => {
	assert.equal(clampPanelWidth(50, 1600), PANEL_MIN);
	assert.equal(clampPanelWidth(5000, 1600), PANEL_MAX);
	assert.equal(clampPanelWidth(333.4, 1600), 333);
	assert.equal(clampPanelWidth(500, 900), 450);
	// A window so narrow that half of it is under the minimum: the minimum wins.
	assert.equal(clampPanelWidth(500, 300), PANEL_MIN);
});

test("a chosen width is remembered, the default is stored as nothing, garbage is the default", () => {
	const storage = fakeStorage();
	assert.equal(loadPanelWidth(storage), PANEL_WIDTH);
	savePanelWidth(340, storage);
	assert.equal(loadPanelWidth(storage), 340);
	savePanelWidth(PANEL_WIDTH, storage);
	assert.equal(storage.getItem(PANEL_WIDTH_KEY), null);
	assert.equal(loadPanelWidth(fakeStorage({ [PANEL_WIDTH_KEY]: "wide" })), PANEL_WIDTH);
	assert.equal(loadPanelWidth(fakeStorage({ [PANEL_WIDTH_KEY]: "9000" })), PANEL_MAX);
});
