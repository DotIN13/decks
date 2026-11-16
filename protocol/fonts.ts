import { FONT_COVERAGE } from "./font-coverage.ts";

// Which font files a text needs and where they come from: one rule for the page's engine and the
// server's pictures. Fontsource's CDN serves every Google font as TrueType; a text gets its family,
// then Inter, then the first fallback file that draws each other character (`font-coverage.ts`).

export const FONT_CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
export const FALLBACK_FAMILY = "Inter";
/**
 * Colour emoji as pictures (Google's CBDT build of Noto Color Emoji, pinned to one commit): both font
 * engines draw it, where Fontsource's copy is the vector COLRv1 build, which the engine's painter does
 * not draw, and is 25 MB to this one's 11.
 */
export const EMOJI_URL = "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@e20cbc2bbec1926686be9f9bee7d1d2cfa1fea0e/2D/fonts/NotoColorEmoji.ttf";
/** Added to a face's name for its extended-Latin file. */
const EXT = " Ext";
const EMOJI = /\p{Extended_Pictographic}/u;
/** The families whose letters come in one large file per language, fetched in two weights only. */
const CJK = new Set(["noto-sans-sc", "noto-sans-jp", "noto-sans-kr", "noto-sans-tc"]);

export interface FontNeed {
	family: string;
	weight: number;
	italic: boolean;
	text: string;
}

/** One file: `key` names it, `family` is what it is registered as, and `fallback` is tried when `url` fails. */
export interface FontFile {
	key: string;
	family: string;
	url: string;
	fallback?: string;
}

/** The files these texts need: the family asked for and Inter in Latin, and a fallback for every other character. */
export function fontFiles(needs: readonly FontNeed[]): FontFile[] {
	const wanted = new Map<string, FontFile>();
	const want = (id: string, name: string, subset: string, weight: number, italic: boolean) => {
		const style = italic ? "italic" : "normal";
		const key = `${id}/${subset}/${weight}/${style}`;
		if (wanted.has(key)) return;
		if (id === "noto-color-emoji") wanted.set(key, { key, family: name, url: EMOJI_URL });
		else wanted.set(key, { key, family: name, url: `${FONT_CDN}/${id}@latest/${subset}-${weight}-${style}.ttf`, ...(weight !== 400 || italic ? { fallback: `${FONT_CDN}/${id}@latest/${subset}-400-normal.ttf` } : {}) });
	};
	want(fontsourceId(FALLBACK_FAMILY), FALLBACK_FAMILY, "latin", 400, false);
	for (const need of needs) {
		const weight = roundWeight(need.weight);
		for (const family of new Set([need.family, FALLBACK_FAMILY])) {
			want(fontsourceId(family), family, "latin", weight, need.italic);
			// Letters past plain Latin that are still Latin: ā, ł, ő, ș, ẞ and the rest.
			if (/[\u0100-\u024f\u1e00-\u1eff]/.test(need.text)) want(fontsourceId(family), `${family}${EXT}`, "latin-ext", weight, need.italic);
		}
		// Every other character, from the first fallback file that draws it.
		const seen = new Set<Fallback>();
		for (const ch of need.text) {
			const cp = ch.codePointAt(0)!;
			if (cp < 0x250 || (cp >= 0x1e00 && cp <= 0x1eff) || cp === 0x2028 || cp === 0x2029) continue;
			const file = fallbackFor(cp);
			if (!file || seen.has(file)) continue;
			seen.add(file);
			const w = CJK.has(file.id) ? (weight >= 600 ? 700 : 400) : nearest(file.weights, weight);
			want(file.id, file.name, file.subset, w, file.italic && need.italic);
		}
	}
	return [...wanted.values()];
}

// Names and weights, as Fontsource has them.

export const fontsourceId = (family: string) => family.trim().toLowerCase().replace(/\s+/g, "-");
export const roundWeight = (weight: number) => Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
const nearest = (weights: readonly number[], weight: number) => weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0] ?? 400);

// The fallback files, and which one draws a character.

/**
 * Every fallback file, in the order they are tried (`font-coverage.ts`, generated): Inter's other
 * languages, Noto Sans, one Noto family per script, then maths, symbols, Chinese, Japanese and Korean,
 * music and emoji. A file is fetched only when a text has a character only it draws.
 */
interface Fallback {
	id: string;
	family: string;
	weights: readonly number[];
	italic: boolean;
	subset: string;
	/** The name it is registered under, which is what a chain lists. */
	name: string;
	/** Code point ranges, as start and end pairs, sorted. */
	ranges: Int32Array;
}
/** The list, read from the table once, on first use. */
const read: { list?: Fallback[] } = {};
function fallbackList(): Fallback[] {
	if (read.list) return read.list;
	const fallbacks: Fallback[] = (read.list = []);
	for (const [id, family, weights, italic, subsets] of FONT_COVERAGE) {
		for (const [subset, text] of subsets) {
			const pairs: number[] = [];
			for (const part of text.split(",")) {
				const [a, b] = part.split("-");
				const start = parseInt(a!, 16);
				pairs.push(start, b === undefined ? start : parseInt(b, 16));
			}
			fallbacks.push({ id, family, weights, italic, subset, name: fileName(family, subset, subsets.length), ranges: Int32Array.from(pairs) });
		}
	}
	return fallbacks;
}

/**
 * The name a file is registered under. A face's extended-Latin letters are a file of their own under
 * a name of their own (`EXT`), tried after the face: under the face's own name it was sometimes
 * picked for plain words, and it has no digits, so "10 s" came out in a symbol font.
 */
function fileName(family: string, subset: string, files: number): string {
	if (subset === "latin") return family;
	if (subset === "latin-ext") return `${family}${EXT}`;
	return files === 1 ? family : `${family} ${subset}`;
}

const covers = (ranges: Int32Array, cp: number): boolean => {
	let lo = 0;
	let hi = ranges.length / 2 - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (cp < ranges[mid * 2]!) hi = mid - 1;
		else if (cp > ranges[mid * 2 + 1]!) lo = mid + 1;
		else return true;
	}
	return false;
};

/** The first fallback file that draws a character, if any does; kept, since a text repeats its letters. */
const fileOf = new Map<number, Fallback | null>();
function fallbackFor(cp: number): Fallback | undefined {
	const known = fileOf.get(cp);
	if (known !== undefined) return known ?? undefined;
	const list = fallbackList();
	// Pictures drawn in colour come from the emoji font, as they always have, not from a symbol font's outline.
	const emoji = cp >= 0x1f000 && EMOJI.test(String.fromCodePoint(cp));
	const found = (emoji ? list.find((f) => f.id === "noto-color-emoji" && covers(f.ranges, cp)) : undefined) ?? list.find((f) => covers(f.ranges, cp)) ?? null;
	fileOf.set(cp, found);
	return found ?? undefined;
}

/** Whether a registered family is one of the per-script fallbacks, tried after the family and Inter. */
export function isFallbackFamily(name: string): boolean {
	return fallbackList().some((f) => f.name === name);
}
