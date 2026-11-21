import assert from "node:assert/strict";
import { test } from "node:test";
import { browserLocale, formatAgo, formatBytes, m } from "./index.ts";

test("a browser's languages pick Simplified Chinese for any zh but Traditional, and English for en", () => {
	assert.equal(browserLocale(["zh-CN"]), "zh-CN");
	assert.equal(browserLocale(["zh"]), "zh-CN");
	assert.equal(browserLocale(["zh-Hans-SG", "en"]), "zh-CN");
	assert.equal(browserLocale(["zh-TW", "en-US"]), "en");
	assert.equal(browserLocale(["en-GB"]), "en");
	assert.equal(browserLocale(["fr-FR"]), undefined);
});

test("a message is said in the language asked for, and English when none is", () => {
	assert.equal(m.settings_language(), "Language");
	assert.equal(m.settings_language({}, { locale: "zh-CN" }), "语言");
	assert.equal(m.settings_timezone_use({ zone: "UTC" }, { locale: "zh-CN" }), "使用 UTC");
});

test("times and sizes come from Intl", () => {
	const now = Date.UTC(2026, 10, 21, 12);
	assert.equal(formatAgo(now - 10_000, now), "now");
	assert.equal(formatAgo(now - 5 * 60_000, now), "5 min. ago");
	assert.equal(formatBytes(1_500_000), "1.5 MB");
});
