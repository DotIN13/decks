import assert from "node:assert/strict";
import { test } from "node:test";
import { hexToHsv, hsvToHex } from "./color-math.ts";

test("a hex colour goes to hue, saturation and value and comes back the same", () => {
	for (const hex of ["#ffffff", "#000000", "#ff0000", "#00ff00", "#0000ff", "#2563eb", "#d97706", "#9ca3af"]) assert.equal(hsvToHex(hexToHsv(hex)), hex);
});

test("red, green and blue sit a third of the wheel apart, and grey has no saturation", () => {
	assert.deepEqual(hexToHsv("#ff0000"), { h: 0, s: 1, v: 1 });
	assert.equal(hexToHsv("#00ff00").h, 120);
	assert.equal(hexToHsv("#0000ff").h, 240);
	assert.equal(hexToHsv("#808080").s, 0);
});

test("what is not a hex colour reads as white", () => {
	assert.equal(hsvToHex(hexToHsv("nonsense")), "#ffffff");
});
