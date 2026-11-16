import { test } from "node:test";
import assert from "node:assert/strict";
import { EMOJI_URL, FONT_CDN, fontFiles, fontsourceId, isFallbackFamily, roundWeight } from "./fonts.ts";

// Which font files a text needs: its family and Inter in Latin, extended Latin when it has those
// letters, and the first fallback file for every other character.

test("plain words take Inter and their family, in Latin, at the weight rounded", () => {
	const files = fontFiles([{ family: "Lora", weight: 640, italic: true, text: "Hello" }]);
	assert.deepEqual(files.map((f) => f.key), ["inter/latin/400/normal", "lora/latin/600/italic", "inter/latin/600/italic"]);
	assert.equal(files[1]!.url, `${FONT_CDN}/lora@latest/latin-600-italic.ttf`);
	assert.equal(files[1]!.fallback, `${FONT_CDN}/lora@latest/latin-400-normal.ttf`);
	assert.equal(files[0]!.fallback, undefined);
});

test("extended Latin is a file of its own, under the face's name and Ext", () => {
	const files = fontFiles([{ family: "Inter", weight: 400, italic: false, text: "łódź" }]);
	assert.ok(files.some((f) => f.key === "inter/latin-ext/400/normal" && f.family === "Inter Ext"));
});

test("other scripts come from the fallback files; emoji from the pinned picture build", () => {
	const keys = fontFiles([{ family: "Inter", weight: 700, italic: false, text: "你好 🙂" }]).map((f) => f.key);
	assert.ok(keys.some((k) => k.startsWith("noto-sans-sc/") && k.endsWith("/700/normal")), keys.join(" "));
	const emoji = fontFiles([{ family: "Inter", weight: 400, italic: false, text: "🙂" }]).find((f) => f.url === EMOJI_URL);
	assert.ok(emoji && isFallbackFamily(emoji.family));
	assert.equal(isFallbackFamily("Lora"), false);
});

test("names and weights as Fontsource has them", () => {
	assert.equal(fontsourceId(" JetBrains  Mono "), "jetbrains-mono");
	assert.deepEqual([roundWeight(40), roundWeight(449), roundWeight(951)], [100, 400, 900]);
});
