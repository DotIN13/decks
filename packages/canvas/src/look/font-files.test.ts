import assert from "node:assert/strict";
import { test } from "node:test";
import { EMOJI_URL, FONT_CDN, fontFiles, useShippedFonts } from "./font-files.ts";

const need = (text: string, more: Partial<{ family: string; weight: number; italic: boolean }> = {}) => ({ family: "Inter", weight: 400, italic: false, text, ...more });

test("words in Latin ask for the family's Latin file from the font CDN, with its regular weight to fall back on", () => {
	const files = fontFiles([need("Plain words", { weight: 600 })]);
	const bold = files.find((file) => file.key === "inter/latin/600/normal");
	assert.equal(bold?.url, `${FONT_CDN}/inter@latest/latin-600-normal.ttf`);
	assert.equal(bold?.fallback, `${FONT_CDN}/inter@latest/latin-400-normal.ttf`);
	assert.equal(bold?.local, undefined, "nothing is the app's own until the app says so");
	assert.ok(files.some((file) => file.key === "inter/latin/400/normal"), "the fallback family's regular is always asked for");
});

test("a face the app ships is asked of the app first; every other face is the CDN's alone", () => {
	useShippedFonts("http://127.0.0.1:4329/fonts", ["inter/latin-400-normal.ttf", "inter/latin-600-normal.ttf", "jetbrains-mono/latin-400-normal.ttf"]);
	const files = fontFiles([need("Plain words", { weight: 600 }), need("code", { family: "JetBrains Mono" }), need("slanted", { italic: true }), need("中文 and 🙂")]);
	const by = (key: string) => files.find((file) => file.key === key);
	assert.equal(by("inter/latin/600/normal")?.local, "http://127.0.0.1:4329/fonts/inter/latin-600-normal.ttf");
	assert.equal(by("inter/latin/600/normal")?.url, `${FONT_CDN}/inter@latest/latin-600-normal.ttf`, "the CDN's is still there, for when the app's is not");
	assert.equal(by("jetbrains-mono/latin/400/normal")?.local, "http://127.0.0.1:4329/fonts/jetbrains-mono/latin-400-normal.ttf");
	// Not shipped: the italic, the Chinese file, the emoji.
	assert.equal(by("inter/latin/400/italic")?.local, undefined);
	const chinese = files.find((file) => file.key.startsWith("noto-sans-sc/"));
	assert.ok(chinese && chinese.local === undefined && chinese.url.startsWith(FONT_CDN));
	const emoji = files.find((file) => file.key.startsWith("noto-color-emoji/"));
	assert.ok(emoji && emoji.url === EMOJI_URL && emoji.local === undefined);
});
