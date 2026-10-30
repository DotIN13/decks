import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceKind, gpuClass, PICTURES } from "./device.ts";

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
	assert.equal(gpuClass({ kind: "mobile", forced: "480" }), "big");
	assert.equal(gpuClass({ kind: "computer", forced: "192" }), "small");
	assert.equal(gpuClass({ kind: "mobile", forced: "1024" }), "big");
	assert.equal(gpuClass({ kind: "computer", forced: "512" }), "small");
	assert.deepEqual(PICTURES, { big: { width: 480, budgetMB: 256 }, small: { width: 192, budgetMB: 64 } });
});
