import assert from "node:assert/strict";
import { test } from "node:test";
import { cell, FORMS, NAMES, POINTERS, ROWS, rulesFor, SAME } from "./rules.ts";
import { profileFrom } from "./profile.ts";

const AXES: Record<string, readonly string[]> = { form: FORMS, pointer: POINTERS, os: ["computer", "mobile"], engine: ["webkit", "chromium", "other"], gpu: ["big", "small", "phone"] };

test("every row says what it is in words, and has one value or one per column of its axis, no more", () => {
	for (const [name, row] of Object.entries(ROWS)) {
		assert.ok(typeof row.says === "string" && row.says.length > 10, `${name} says nothing`);
		const keys = Object.keys(row).filter((key) => key !== "says" && key !== "by");
		if (!row.by) assert.deepEqual(keys, ["value"], `${name} has no axis, so one value`);
		else {
			assert.ok(AXES[row.by], `${name} is by an unknown axis "${row.by}"`);
			assert.deepEqual([...keys].sort(), [...AXES[row.by]!].sort(), `${name} has a value for each ${row.by}`);
		}
	}
});

test("every row is read under one name, and every name reads a row", () => {
	const named = Object.values(NAMES);
	assert.equal(new Set(named).size, named.length, "a row is read under two names");
	assert.deepEqual([...named].sort(), Object.keys(ROWS).sort());
});

test("a row by form gives each form its own column; a row by pointer is the whole record", () => {
	const desk = rulesFor({ form: "desk", os: "computer", engine: "chromium" });
	const tablet = rulesFor({ form: "tablet", os: "mobile", engine: "webkit" });
	const phone = rulesFor({ form: "phone", os: "mobile", engine: "webkit" });
	assert.deepEqual([desk.handleSize, tablet.handleSize, phone.handleSize], [9, 10, 10]);
	assert.deepEqual([desk.handleReach, tablet.handleReach, phone.handleReach], [15, 44, 44]);
	assert.deepEqual([desk.holdOnBare, tablet.holdOnBare, phone.holdOnBare], ["none", "marquee", "marquee"]);
	assert.deepEqual([desk.properties, tablet.properties, phone.properties], ["panel", "popover", "sheet"]);
	assert.deepEqual([desk.coastBy, tablet.coastBy], ["os", "ours"]);
	assert.deepEqual(desk.slop, { mouse: 3, pen: 4, touch: 8 });
	assert.deepEqual(desk.snapBy, { mouse: true, pen: true, touch: true }, "a finger snaps as a mouse does");
	assert.deepEqual(desk.awake.live, { card: 12, app: 2, document: 2 });
	assert.deepEqual(phone.awake.live, { card: 3, app: 1, document: 1 });
	assert.deepEqual(tablet.layers, { scaling: false, sliding: false }, "WebKit puts nothing on layers");
	assert.equal(SAME.tapMs, 600);
	assert.throws(() => cell("no.such-rule", { form: "desk", os: "computer", engine: "other" }));
});

const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const base = { platform: "MacIntel", userAgent: MAC_CHROME, maxTouchPoints: 0, coarse: false, shortSide: 1117 };

test("the profile: a Mac is a desk, an iPad a tablet, an iPhone a phone, a Surface folded flat a tablet", () => {
	assert.deepEqual(profileFrom(base), { form: "desk", os: "computer", engine: "chromium" });
	assert.deepEqual(profileFrom({ ...base, userAgent: IPAD, maxTouchPoints: 5, coarse: true, shortSide: 768 }), { form: "tablet", os: "mobile", engine: "webkit" });
	assert.deepEqual(profileFrom({ ...base, platform: "iPhone", userAgent: IPHONE, maxTouchPoints: 5, coarse: true, shortSide: 390 }), { form: "phone", os: "mobile", engine: "webkit" });
	assert.deepEqual(profileFrom({ ...base, platform: "Linux armv8l", userAgent: ANDROID_TABLET, maxTouchPoints: 5, coarse: true, shortSide: 800 }), { form: "tablet", os: "mobile", engine: "chromium" });
	assert.deepEqual(profileFrom({ ...base, platform: "Linux armv8l", userAgent: ANDROID_TABLET, maxTouchPoints: 5, coarse: true, shortSide: 412 }).form, "phone", "a small Android screen is a phone");
	assert.deepEqual(profileFrom({ ...base, platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0", maxTouchPoints: 10, coarse: true }), { form: "tablet", os: "computer", engine: "chromium" });
});

test("?device= forces a form and its system; the older computer and mobile force the system alone; ?engine= the engine", () => {
	assert.deepEqual(profileFrom({ ...base, device: "phone" }), { form: "phone", os: "mobile", engine: "chromium" });
	assert.deepEqual(profileFrom({ ...base, device: "tablet", engine: "webkit" }), { form: "tablet", os: "mobile", engine: "webkit" });
	assert.deepEqual(profileFrom({ ...base, userAgent: IPAD, maxTouchPoints: 5, coarse: true, shortSide: 768, device: "desk" }), { form: "desk", os: "computer", engine: "webkit" });
	assert.equal(profileFrom({ ...base, device: "mobile" }).os, "mobile");
	assert.equal(profileFrom({ ...base, device: "nonsense" }).form, "desk");
});
