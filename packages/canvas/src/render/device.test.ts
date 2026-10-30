import assert from "node:assert/strict";
import { test } from "node:test";
import { browserEngine, deviceKind, gpuClass, LAYERS, PICTURES } from "./device.ts";

const safariMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15";

test("an iPad calls itself a Mac, and its touch screen gives it away", () => {
	assert.equal(deviceKind({ platform: "MacIntel", userAgent: safariMac, maxTouchPoints: 5 }), "mobile");
	assert.equal(deviceKind({ platform: "MacIntel", userAgent: safariMac, maxTouchPoints: 0 }), "computer");
});

test("an iPhone and an Android phone or tablet are mobile", () => {
	assert.equal(deviceKind({ platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)", maxTouchPoints: 5 }), "mobile");
	assert.equal(deviceKind({ platform: "Linux armv81", userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel Tablet)", maxTouchPoints: 10 }), "mobile");
});

test("a touch laptop is a computer", () => {
	assert.equal(deviceKind({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", maxTouchPoints: 10 }), "computer");
	assert.equal(deviceKind({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16000.0.0)", maxTouchPoints: 10 }), "computer");
});

test("the address can force either, for testing", () => {
	assert.equal(deviceKind({ platform: "MacIntel", userAgent: safariMac, maxTouchPoints: 0, forced: "mobile" }), "mobile");
	assert.equal(deviceKind({ platform: "iPhone", userAgent: "", maxTouchPoints: 5, forced: "computer" }), "computer");
});

test("a phone or tablet has a small GPU, and so has a computer with little memory or small WebGPU buffers", () => {
	assert.equal(gpuClass({ kind: "mobile" }), "small");
	assert.equal(gpuClass({ kind: "computer" }), "big");
	assert.equal(gpuClass({ kind: "computer", deviceMemory: 4 }), "small");
	assert.equal(gpuClass({ kind: "computer", deviceMemory: 8, maxBufferSize: 2 ** 32 }), "big");
	assert.equal(gpuClass({ kind: "computer", maxBufferSize: 256 * 2 ** 20 }), "small");
	assert.equal(gpuClass({ kind: "mobile", forced: "big" }), "big");
	assert.equal(gpuClass({ kind: "computer", forced: "small" }), "small");
	assert.equal(gpuClass({ kind: "computer", forced: "512" }), "big", "the old widths say nothing");
	assert.deepEqual(PICTURES, { big: { ladder: [192, 480, 800], budgetMB: 256 }, small: { ladder: [192, 480], budgetMB: 64 } });
});

test("Safari, an iPad that says it is a Mac, and Chrome on iOS are WebKit", () => {
	assert.equal(browserEngine({ userAgent: safariMac }), "webkit");
	assert.equal(browserEngine({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1" }), "webkit");
});

test("Chrome, Edge and headless Chrome are Chromium, though they say AppleWebKit too; Firefox is another", () => {
	assert.equal(browserEngine({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" }), "chromium");
	assert.equal(browserEngine({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0" }), "chromium");
	assert.equal(browserEngine({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36" }), "chromium");
	assert.equal(browserEngine({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:140.0) Gecko/20100101 Firefox/140.0" }), "other");
});

test("the address can force an engine, for testing", () => {
	assert.equal(browserEngine({ userAgent: safariMac, forced: "chromium" }), "chromium");
	assert.equal(browserEngine({ userAgent: "", forced: "webkit" }), "webkit");
	assert.equal(browserEngine({ userAgent: safariMac, forced: "nonsense" }), "webkit");
});

test("WebKit puts nothing on layers while the camera moves; Chromium and the rest keep both", () => {
	assert.deepEqual(LAYERS.webkit, { scaling: false, sliding: false });
	assert.deepEqual(LAYERS.chromium, { scaling: true, sliding: true });
	assert.deepEqual(LAYERS.other, { scaling: true, sliding: true });
});
