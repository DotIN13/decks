import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canvasApiPresent, effectiveRenderer, isRenderer, loadRenderer, saveRenderer } from "./renderer.ts";

const memory = () => {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		map,
	};
};

describe("renderer preference", () => {
	it("defaults to the DOM renderer and round-trips a choice", () => {
		const storage = memory();
		assert.equal(loadRenderer(storage), "dom");
		saveRenderer("canvas-per-board", storage);
		assert.equal(loadRenderer(storage), "canvas-per-board");
		saveRenderer("one-canvas", storage);
		assert.equal(loadRenderer(storage), "one-canvas");
	});

	it("ignores a value it does not know, and a storage that throws", () => {
		const storage = memory();
		storage.map.set("decks.renderer", "webgl");
		assert.equal(loadRenderer(storage), "dom");
		assert.equal(
			loadRenderer({
				getItem: () => {
					throw new Error("refused");
				},
			}),
			"dom",
		);
		assert.equal(loadRenderer(undefined), "dom");
		assert.doesNotThrow(() =>
			saveRenderer("dom", {
				setItem: () => {
					throw new Error("full");
				},
			}),
		);
		assert.equal(isRenderer("dom"), true);
		assert.equal(isRenderer("boxes"), false);
	});

	it("falls back to the DOM renderer when the browser has no drawElementImage", () => {
		assert.equal(effectiveRenderer("one-canvas", false), "dom");
		assert.equal(effectiveRenderer("canvas-per-board", false), "dom");
		assert.equal(effectiveRenderer("canvas-per-board", true), "canvas-per-board");
		assert.equal(effectiveRenderer("dom", true), "dom");
	});

	it("feature-tests the method rather than the browser", () => {
		assert.equal(canvasApiPresent({}), false);
		assert.equal(canvasApiPresent({ CanvasRenderingContext2D: { prototype: {} } }), false);
		assert.equal(canvasApiPresent({ CanvasRenderingContext2D: { prototype: { drawElementImage() {} } } }), true);
	});
});
