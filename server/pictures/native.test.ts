import { test } from "node:test";
import assert from "node:assert/strict";
import { fontsFor } from "./native-shot.ts";
import { nativeBinary } from "./native.ts";

// Rule 17: what the native tool is given, and when the browser draws instead.

test("rule 17: Latin words take the protocol's Latin files, each with whether it is a fallback", async () => {
	const at = async (file: { key: string }) => `/fonts/${file.key}`;
	const latin = await fontsFor([{ family: "Lora", weight: 650, italic: false, text: "Pro plan, 20% off" }], at);
	assert.ok(Array.isArray(latin));
	assert.ok(latin.some((one) => one.key === "lora/latin/700/normal" && !one.fallback));
	assert.ok(latin.some((one) => one.key.startsWith("inter/latin/")), "Inter backs every family");
});

test("rule 17: Chinese, Japanese or emoji words are the browser's, with why", async () => {
	const at = async (file: { key: string }) => `/fonts/${file.key}`;
	for (const text of ["你好", "こんにちは", "Done 🎉"]) {
		const got = await fontsFor([{ family: "Inter", weight: 400, italic: false, text }], at);
		assert.ok(!Array.isArray(got) && /beyond Latin/.test(got.why), `${text}: ${JSON.stringify(got)}`);
	}
});

test("rule 17: a font that cannot be fetched sends the picture to the browser, never boxes", async () => {
	const got = await fontsFor([{ family: "Inter", weight: 400, italic: false, text: "a" }], async () => undefined);
	assert.ok(!Array.isArray(got) && /could not be fetched/.test(got.why));
});

test("rule 17: DECKS_NATIVE_SHOT names the binary, and a missing one is none", () => {
	const was = process.env.DECKS_NATIVE_SHOT;
	process.env.DECKS_NATIVE_SHOT = "/nowhere/shot";
	assert.equal(nativeBinary(), undefined);
	if (was === undefined) delete process.env.DECKS_NATIVE_SHOT;
	else process.env.DECKS_NATIVE_SHOT = was;
});
