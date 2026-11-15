import { test } from "node:test";
import assert from "node:assert/strict";
import { fontFiles } from "./native-shot.ts";
import { nativeBinary } from "./native.ts";

// Rule 17: what the native tool is given, and when the browser draws instead.

test("rule 17: Latin words take each family's latin file and Inter's; latin-ext only when needed", () => {
	const files = fontFiles([{ family: "Lora", weight: 650, italic: false, text: "Pro plan — 20% off" }]);
	assert.ok(!("why" in files));
	assert.deepEqual(files.map((one) => one.key).sort(), ["inter/latin/400/normal", "inter/latin/700/normal", "lora/latin/700/normal"]);
	const ext = fontFiles([{ family: "Inter", weight: 400, italic: true, text: "Łódź" }]);
	assert.ok(!("why" in ext) && ext.some((one) => one.key === "inter/latin-ext/400/italic" && one.family === "Inter Ext"));
});

test("rule 17: words beyond Latin are the browser's, with the character named", () => {
	const files = fontFiles([{ family: "Inter", weight: 400, italic: false, text: "你好" }]);
	assert.ok("why" in files && /你/.test(files.why));
});

test("rule 17: DECKS_STAGE_SHOT names the binary, and a missing one is none", () => {
	const was = process.env.DECKS_STAGE_SHOT;
	process.env.DECKS_STAGE_SHOT = "/nowhere/stage-shot";
	assert.equal(nativeBinary(), undefined);
	if (was === undefined) delete process.env.DECKS_STAGE_SHOT;
	else process.env.DECKS_STAGE_SHOT = was;
});
