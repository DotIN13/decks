// The C++ text measure against CanvasKit's paragraph, measuring as the app does today (fonts.ts), with
// the same font files. Strings of every kind the drawing holds: words, numbers, punctuation, URLs,
// Chinese, symbols, long words, hard breaks; at many sizes, weights, spacings and widths.
// node --import tsx packages/engine/test/text-diff.mjs [cases]   (FONTS: a folder of the .ttf files)
import { readFileSync, readdirSync } from "node:fs";
import CanvasKitInit from "canvaskit-wasm/bin/canvaskit.js";
import { loadText } from "../src/text.ts";

const dir = process.env.FONTS ?? new URL("../../../_scratch/fonts/", import.meta.url).pathname;
const family = (file) => {
	const fam = file.startsWith("inter") ? "Inter" : file.startsWith("noto-sans-sc") ? "Noto Sans SC" : file.startsWith("noto-sans-symbols-2") ? "Noto Sans Symbols 2" : file.startsWith("noto-sans-symbols") ? "Noto Sans Symbols" : file.startsWith("jetbrains") ? "JetBrains Mono" : "Lora";
	return file.includes("latin-ext") ? `${fam} Ext` : fam;
};
const ck = await CanvasKitInit({ locateFile: (f) => new URL(`../../../node_modules/canvaskit-wasm/bin/${f}`, import.meta.url).pathname });
const provider = ck.TypefaceFontProvider.Make();
const text = await loadText();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".ttf")).sort()) {
	const bytes = readFileSync(dir + file);
	provider.registerFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), family(file));
	text.font(new Uint8Array(bytes), family(file));
}
const chain = (fam) => [...new Set([fam, `${fam} Ext`, "Inter", "Inter Ext", "Noto Sans SC", "Noto Sans Symbols 2", "Noto Sans Symbols", "Noto Color Emoji"])];
const roundWeight = (w) => Math.min(900, Math.max(100, Math.round(w / 100) * 100));
// fonts.ts's measure, word for word, for plain text.
const reference = (t, style, maxWidth) => {
	const ps = new ck.ParagraphStyle({ textAlign: ck.TextAlign.Left, textStyle: { color: ck.BLACK, fontFamilies: chain(style.fontFamily), fontSize: style.fontSize, fontStyle: { weight: { value: roundWeight(style.fontWeight) }, slant: style.fontStyle === "italic" ? ck.FontSlant.Italic : ck.FontSlant.Upright }, letterSpacing: style.letterSpacing, ...(style.lineHeight !== undefined ? { heightMultiplier: style.lineHeight, halfLeading: true } : {}) } });
	const b = ck.ParagraphBuilder.MakeFromFontProvider(ps, provider);
	b.addText(t || " ");
	const p = b.build();
	b.delete();
	p.layout(Math.max(1, maxWidth ?? 1e6));
	const out = { w: maxWidth === undefined ? Math.ceil(p.getMaxIntrinsicWidth()) : Math.min(maxWidth, Math.ceil(p.getLongestLine())), h: p.getHeight(), lines: p.getLineMetrics().map((l) => t.slice(l.startIndex, l.endIndex)) };
	p.delete();
	return out;
};
const mine = text.measure(chain);
const mineLines = (t, style, maxWidth) => text.lines(t || " ", style, maxWidth, chain(style.fontFamily)).spans.map((x) => (t || " ").slice(x.from, x.to));

let seed = Number(process.env.SEED ?? 5);
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (list) => list[Math.floor(rand() * list.length)];
const WORDS = ["the", "Decks", "canvas", "board", "a", "is", "agent's", "re-drawn", "well-known", "2026", "10:30", "$40", "75%", "(note)", "[draft]", "e.g.", "U.S.", "—", "–", "...", "…", "https://example.com/a/b", "path/to/file.md", "co-op", "naïve", "Łódź", "über", "→", "✓", "★", "中文", "汉字测试", "，", "。", "「引用」", "x²", "AVA", "WAVE", "Typography", "fi", "ffl", "longwordwithoutanybreaksatall", "C++", "#tag", "@name", "\"quoted\"", "'single'", "Hello!", "Why?", "a/b", "1/2", "3.14", "-5", "+1"];
const sentence = () => {
	const n = 1 + Math.floor(rand() * 14);
	let out = "";
	for (let i = 0; i < n; i++) out += (i ? pick([" ", " ", " ", " ", "  ", "\n", ""]) : "") + pick(WORDS);
	return out;
};
let failed = 0, wDiff = 0, hDiff = 0;
const cases = Number(process.argv[2] ?? 3000);
for (let i = 0; i < cases; i++) {
	const style = { fontFamily: pick(["Inter", "Inter", "Inter", "JetBrains Mono", "Lora", "Nonexistent"]), fontSize: pick([10, 12, 13, 14, 14, 16, 18.5, 24, 32, 48]), fontWeight: pick([400, 400, 400, 600, 700, 300, 500, 800]), fontStyle: pick(["normal", "normal", "normal", "italic"]), letterSpacing: pick([0, 0, 0, 0.5, 1, -0.3, 2]), lineHeight: pick([undefined, undefined, 1.2, 1.5, 1.33]) };
	const t = sentence();
	const maxWidth = pick([undefined, 40, 80, 120, 160, 208, 240, 300, 500]);
	const want = reference(t, style, maxWidth);
	const got = mine(t, style, maxWidth);
	const bad = want.w !== got.w || Math.abs(want.h - got.h) > 0.01;
	if (want.w !== got.w) wDiff++;
	if (Math.abs(want.h - got.h) > 0.01) hDiff++;
	if (bad) {
		failed++;
		if (failed <= 12) console.log(`differs: ${JSON.stringify(t)} ${JSON.stringify(style)} width ${maxWidth}: CanvasKit ${JSON.stringify({ w: want.w, h: want.h })} lines ${JSON.stringify(want.lines)}, C++ ${JSON.stringify(got)} lines ${JSON.stringify(mineLines(t, style, maxWidth))}`);
	}
}
console.log(`${cases} measures: ${failed} differ (${wDiff} in width, ${hDiff} in height)`);
process.exit(failed ? 1 : 0);
