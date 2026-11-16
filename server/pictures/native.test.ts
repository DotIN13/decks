import { test } from "node:test";
import assert from "node:assert/strict";
import { fontsFor } from "./native-shot.ts";
import { nativeBinary } from "./native.ts";

// Rule 17: what the native tool is given, and when the browser draws instead.

test("rule 17: the fonts are the protocol's files for the words, each with whether it is a fallback", async () => {
	const fetched: string[] = [];
	const at = async (file: { key: string }) => (fetched.push(file.key), `/fonts/${file.key}`);
	const latin = await fontsFor([{ family: "Lora", weight: 650, italic: false, text: "Pro plan, 20% off" }], at);
	assert.ok(latin.some((one) => one.key === "lora/latin/700/normal" && !one.fallback));
	assert.ok(latin.some((one) => one.key.startsWith("inter/latin/")), "Inter backs every family");
	const chinese = await fontsFor([{ family: "Inter", weight: 400, italic: false, text: "你好" }], at);
	assert.ok(chinese.some((one) => one.fallback && one.key.startsWith("noto-sans-sc/")), JSON.stringify(chinese.map((one) => one.key)));
});

test("rule 17: a font that cannot be fetched is left out, not refused", async () => {
	const none = await fontsFor([{ family: "Inter", weight: 400, italic: false, text: "a" }], async () => undefined);
	assert.deepEqual(none, []);
});

test("rule 17: DECKS_NATIVE_SHOT names the binary, and a missing one is none", () => {
	const was = process.env.DECKS_NATIVE_SHOT;
	process.env.DECKS_NATIVE_SHOT = "/nowhere/shot";
	assert.equal(nativeBinary(), undefined);
	if (was === undefined) delete process.env.DECKS_NATIVE_SHOT;
	else process.env.DECKS_NATIVE_SHOT = was;
});
