// Markdown cards: the height CanvasKit gives with the app's own `layoutMarkdown`, against the C++
// walker (`cpp/card.cpp`) measuring with the same fonts. Every card on every saved stage, and made-up
// cards that use every kind of block, at many widths, sizes and styles.
// node --import tsx packages/engine/test/card-diff.mjs [made-up count]   (FONTS: a folder of the .ttf files)
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import CanvasKitInit from "canvaskit-wasm/bin/canvaskit.js";
import { parse } from "@decks/pen";
import { loadText } from "../src/text.ts";
import { layoutMarkdown } from "../../../apps/web/src/canvas/pen/markdown-layout.ts";
import { parseMarkdown } from "../../../apps/web/src/canvas/pen/markdown.ts";
import { encodeCard } from "../../../apps/web/src/canvas/pen/card-wire.ts";

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
// A picture of a known size for some addresses, none for others, as a card meets them.
const pictures = { "a.png": [640, 480], "wide.png": [1600, 300], "tall.png": [200, 900] };
const fakeImage = (url) => {
	const size = pictures[url.split("/").pop()];
	return size ? { width: () => size[0], height: () => size[1], delete() {} } : undefined;
};
const env = { ck, provider, chain, image: fakeImage, mono: "JetBrains Mono", scheme: "light" };
const wireEnv = { chain, mono: "JetBrains Mono", scheme: "light", image: fakeImage };

let failed = 0, compared = 0;
const check = (name, md, style, width) => {
	const want = layoutMarkdown(env, parseMarkdown(md), style, Math.max(1, width));
	const wantHeight = want.height;
	want.delete();
	const wire = encodeCard(md, style, wireEnv);
	const got = text.card(wire.numbers, wire.pool, Math.max(1, width));
	compared++;
	if (Math.abs(got - wantHeight) > 1e-6) {
		failed++;
		if (failed <= 10) console.log(`differs: ${name} width ${width} ${JSON.stringify(style)}: CanvasKit ${wantHeight}, C++ ${got}\n  ${JSON.stringify(process.env.FULL ? md : md.slice(0, 200))}`);
	}
};

// Every card on every saved stage, at its own width and a few others.
const cards = [];
const walk = (node, out) => {
	if (node.metadata?.type === "decks.markdown" && typeof node.content === "string") out.push(node);
	for (const child of node.children ?? []) walk(child, out);
};
for (const path of execSync("find /home/decks/data/decks /mnt/data/decks-data/worktrees -name '*.pen' -not -path '*/node_modules/*' 2>/dev/null || true", { encoding: "utf8" }).split("\n").filter(Boolean)) {
	try {
		for (const node of parse(readFileSync(path, "utf8")).children ?? []) walk(node, cards);
	} catch {}
}
const style = (o = {}) => ({ fontFamily: "Inter", fontSize: 14, fontWeight: 400, fontStyle: "normal", letterSpacing: 0, lineHeight: undefined, ...o });
const seen = new Set();
for (const node of cards) {
	if (seen.has(node.content)) continue;
	seen.add(node.content);
	for (const width of [typeof node.width === "number" ? node.width - 32 : 208, 120, 400]) check("saved card", node.content, style({ fontSize: typeof node.fontSize === "number" ? node.fontSize : 14 }), width);
}
console.log(`${seen.size} saved cards`);

// Made-up cards with every block.
let seed = Number(process.env.SEED ?? 3);
// mulberry32: an LCG multiplied in doubles loses bits past 2^53 and repeats within a few hundred numbers.
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const INLINE = ["plain words", "**bold words**", "*italic*", "`code()`", "[a link](https://example.com)", "~~struck~~", "==marked==", "x^2^", "H~2~O", "[[Wiki page]]", "[red words]{.red}", "[big words]{.large}", "[small]{.small}", "[serif words]{.serif}", "==highlight==", "{++added++}", "{--removed--}", "{>>a reason<<}", "😀 emoji", "中文字符", "naïve café", "→ arrows ✓", "a very long word supercalifragilisticexpialidocious", "![tiny](a.png)", "[^1]"];
const inline = () => Array.from({ length: 1 + Math.floor(rand() * 6) }, () => pick(INLINE)).join(" ");
const BLOCKS = [
	() => `${"#".repeat(1 + Math.floor(rand() * 6))} ${inline()}`,
	() => inline(),
	() => `${inline()}\n${inline()}`,
	() => Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, i) => `${pick(["-", "*", `${i + 1}.`])} ${pick(["", "[ ] ", "[x] "])}${inline()}`).join("\n"),
	() => `- ${inline()}\n  - ${inline()}\n    - ${inline()}\n- ${inline()}`,
	() => `1. ${inline()}\n\n2. ${inline()}`,
	() => `> ${inline()}\n> ${inline()}`,
	() => `> [!${pick(["note", "warning", "tip", "danger", "info"])}]${pick(["", " A title"])}\n> ${inline()}`,
	() => "```" + pick(["js", "python", "", "css"]) + "\n" + pick(["const x = 1;\nfunction f(a) { return a * 2; }", "def f(x):\n    return x + 1", "a very long line of code that will need to wrap because it is wider than the card is", ".a { color: red; }"]) + "\n```",
	() => `| ${inline()} | b | c |\n|:---|:---:|---:|\n| 1 | ${inline()} | 3 |\n| x | y | ${inline()} |`,
	() => `| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| ${Array.from({ length: 6 }, inline).join(" | ")} |`,
	() => pick(["![a picture](a.png)", "![wide](wide.png)", "![tall|120](tall.png)", "![missing](nowhere.png)", "![[notes.pdf]]"]),
	() => "---",
	() => `Words with a note[^1].\n\n[^1]: ${inline()}`,
];
const made = Number(process.argv[2] ?? 1500);
for (let i = 0; i < made; i++) {
	const md = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => pick(BLOCKS)()).join("\n\n");
	const st = style({ fontFamily: pick(["Inter", "Inter", "Lora", "JetBrains Mono"]), fontSize: pick([12, 14, 14, 16, 18, 24]), fontWeight: pick([400, 400, 500, 600]), letterSpacing: pick([0, 0, 0.5, -0.2]), lineHeight: pick([undefined, undefined, 1.3, 1.6]) });
	check("made-up", md, st, pick([120, 160, 208, 240, 300, 480]));
}
console.log(`${compared} card layouts compared: ${failed ? `${failed} differ` : "all the same"}`);
process.exit(failed ? 1 : 0);
