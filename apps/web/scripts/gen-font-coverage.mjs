// Which font file draws which characters, for the drawing's font fallback (`font-files.ts`).
//
// Every Noto family Fontsource serves, plus Inter's own language subsets, in the order the fallback
// tries them. What a file covers is read from the file's own character map, never from Fontsource's
// published ranges: those undersell a family served as one file (Noto Sans Math lists "latin" and
// holds 3,034 signs) and oversell a split one (Noto Sans SC's ranges include Hangul; its
// chinese-simplified file does not).
//
// The order: Inter's languages and Noto Sans, then each script's own family, and only then maths,
// symbols and the Chinese, Japanese and Korean families, which also hold letters of other scripts
// (Noto Sans Math has Arabic letters, for Arabic mathematics, without Arabic's joining).
//
//   node apps/web/scripts/gen-font-coverage.mjs   (writes packages/canvas/src/render/font-coverage.ts)
import { writeFileSync } from "node:fs";

const API = "https://api.fontsource.org/v1/fonts";
const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
const EMOJI_URL = "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@e20cbc2bbec1926686be9f9bee7d1d2cfa1fea0e/2D/fonts/NotoColorEmoji.ttf";
// Tried first: Inter's languages, then Noto Sans; after every script's own family, the sign and CJK families.
const FIRST = ["inter", "noto-sans"];
const AFTER_SCRIPTS = ["noto-sans-math", "noto-sans-symbols-2", "noto-sans-symbols", "noto-sans-sc", "noto-sans-jp", "noto-sans-kr", "noto-sans-tc"];
// Variants of a family already listed, and faces meant for display or code rather than text.
const SKIP = new Set(["noto-sans-display", "noto-sans-mono", "noto-sans-hk", "noto-sans-adlam-unjoined", "noto-sans-nko-unjoined", "noto-sans-lao-looped", "noto-sans-thai-looped", "noto-sans-phagspa", "noto-sans-syriac-eastern", "noto-sans-syriac-western"]);
const CJK_SUBSET = { "noto-sans-sc": "chinese-simplified", "noto-sans-jp": "japanese", "noto-sans-kr": "korean", "noto-sans-tc": "chinese-traditional" };
// Last, after the music signs: the emoji font.
const LAST = ["noto-music", "noto-color-emoji"];

const all = await (await fetch(API)).json();
const noto = all.map((f) => f.id).filter((id) => id.startsWith("noto-sans") && !SKIP.has(id) && !FIRST.includes(id) && !AFTER_SCRIPTS.includes(id)).sort();
const order = [...FIRST, ...noto, ...AFTER_SCRIPTS, ...LAST];

/** The code points a TrueType file maps, from its cmap (formats 4 and 12). */
function cmap(buffer) {
	const d = new DataView(buffer);
	const tables = d.getUint16(4);
	let at = -1;
	for (let i = 0; i < tables; i++) if (String.fromCharCode(...new Uint8Array(buffer, 12 + 16 * i, 4)) === "cmap") at = d.getUint32(12 + 16 * i + 8);
	const out = new Set();
	if (at < 0) return out;
	const n = d.getUint16(at + 2);
	for (let i = 0; i < n; i++) {
		const s = at + d.getUint32(at + 4 + 8 * i + 4);
		const format = d.getUint16(s);
		if (format === 12) {
			const groups = d.getUint32(s + 12);
			for (let g = 0; g < groups; g++) {
				const a = d.getUint32(s + 16 + 12 * g), b = d.getUint32(s + 20 + 12 * g);
				for (let c = a; c <= b; c++) out.add(c);
			}
		} else if (format === 4) {
			const segs = d.getUint16(s + 6) / 2;
			for (let k = 0; k < segs; k++) {
				const end = d.getUint16(s + 14 + 2 * k), start = d.getUint16(s + 16 + 2 * segs + 2 * k);
				if (start === 0xffff) continue;
				for (let c = start; c <= end; c++) out.add(c);
			}
		}
	}
	return out;
}

/** Code points as "0370-0377,037a": short, and read back by `font-files.ts`. */
function compact(points) {
	const sorted = [...points].filter((c) => c > 0x20 && c !== 0xa0).sort((a, b) => a - b);
	const out = [];
	for (let i = 0; i < sorted.length; ) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
		out.push(i === j ? sorted[i].toString(16) : `${sorted[i].toString(16)}-${sorted[j].toString(16)}`);
		i = j + 1;
	}
	return out.join(",");
}

const entries = [];
const limit = 8;
let next = 0;
async function work() {
	while (next < order.length) {
		const index = next++;
		const id = order[index];
		const meta = await (await fetch(`${API}/${id}`)).json();
		const weights = meta.weights ?? [400];
		const italic = (meta.styles ?? []).includes("italic");
		const subsets = CJK_SUBSET[id] ? [CJK_SUBSET[id]] : (meta.subsets ?? []).filter((s) => id === "inter" || !["latin", "latin-ext", "vietnamese", "cyrillic", "cyrillic-ext", "greek", "greek-ext"].includes(s) || id === "noto-sans" || (meta.subsets ?? []).length === 1);
		const found = [];
		for (const subset of subsets) {
			const weight = weights.includes(400) ? 400 : weights[0];
			// Emoji from Google's picture (CBDT) build, which `font-files.ts` fetches too (`EMOJI_URL`).
			const response = await fetch(id === "noto-color-emoji" ? EMOJI_URL : `${CDN}/${id}@latest/${subset}-${weight}-normal.ttf`);
			if (!response.ok) {
				console.warn(`no file: ${id} ${subset}`);
				continue;
			}
			const points = cmap(await response.arrayBuffer());
			if (points.size) found.push({ subset, ranges: compact(points) });
		}
		entries[index] = { id, family: meta.family, weights, italic, subsets: found };
		process.stdout.write(`${id} `);
	}
}
await Promise.all(Array.from({ length: limit }, work));
const kept = entries.filter((e) => e && e.subsets.length);
const body = kept.map((e) => `\t[${JSON.stringify(e.id)}, ${JSON.stringify(e.family)}, ${JSON.stringify(e.weights)}, ${e.italic}, [${e.subsets.map((s) => `[${JSON.stringify(s.subset)}, ${JSON.stringify(s.ranges)}]`).join(", ")}]],`).join("\n");
writeFileSync(
	new URL("../../../packages/canvas/src/render/font-coverage.ts", import.meta.url),
	`// Generated by apps/web/scripts/gen-font-coverage.mjs on ${new Date().toISOString().slice(0, 10)}: do not edit by hand.\n` +
		`// Each family in fallback order: its Fontsource id, its name, its weights, whether it has italics,\n` +
		`// and per subset file the code points it draws, as hex ranges.\n` +
		`export const FONT_COVERAGE: ReadonlyArray<readonly [id: string, family: string, weights: readonly number[], italic: boolean, subsets: ReadonlyArray<readonly [subset: string, ranges: string]>]> = [\n${body}\n];\n`,
);
console.log(`\n${kept.length} families written`);
