/**
 * Text measured by the C++ scene (`cpp/text.cpp`): HarfBuzz shapes the words, and the scene chooses
 * each letter's font, breaks the lines and stacks them, as the app's CanvasKit paragraph does today
 * (`apps/web/src/canvas/pen/fonts.ts`, the reference; `test/text-diff.mjs` compares the two).
 */
import type { MeasureText, TextStyle } from "@decks/pen";
import createSceneModule from "../wasm/scene.mjs";

interface TextModule {
	HEAPU8: Uint8Array;
	HEAPF64: Float64Array;
	_text_scratch(bytes: number): number;
	_text_answer(): number;
	_text_lines(): number;
	_text_font(bytes: number, nameLength: number): number;
	_text_measure(length: number, chainLength: number, size: number, weight: number, italic: number, letterSpacing: number, lineHeight: number, maxWidth: number): number;
}

export interface TextEngine {
	/** A font file for a family, its weight and slant read from the file. */
	font(bytes: ArrayBuffer | Uint8Array, family: string): void;
	/** One paragraph's numbers: its unbroken width (trailing spaces in), its longest line, its height and lines. */
	lines(text: string, style: TextStyle, maxWidth: number | undefined, chain: readonly string[]): { unbroken: number; longest: number; height: number; lines: number; spans: Array<{ from: number; to: number; width: number }> };
	/** The measure the layout takes, as `PenFonts.measure` gives it for plain words. */
	measure(chain: (family: string) => readonly string[]): MeasureText;
}

const encoder = new TextEncoder();
const roundWeight = (weight: number) => Math.min(900, Math.max(100, Math.round(weight / 100) * 100));

/** The text half of a scene module that is already loaded. */
export function textOf(module: unknown): TextEngine {
	const m = module as TextModule;
	const write = (parts: Uint8Array[]) => {
		const total = parts.reduce((n, p) => n + p.length, 0);
		const at = m._text_scratch(total);
		let k = at;
		for (const part of parts) {
			m.HEAPU8.set(part, k);
			k += part.length;
		}
	};
	const engine: TextEngine = {
		font(bytes, family) {
			const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
			const name = encoder.encode(family);
			write([data, name]);
			m._text_font(data.length, name.length);
		},
		lines(text, style, maxWidth, chain) {
			const words = encoder.encode(text);
			const names = encoder.encode(chain.join("\n"));
			write([words, names]);
			m._text_measure(words.length, names.length, style.fontSize, roundWeight(style.fontWeight), style.fontStyle === "italic" ? 1 : 0, style.letterSpacing, style.lineHeight ?? NaN, maxWidth ?? NaN);
			const at = m._text_answer() >> 3;
			const lines = m.HEAPF64[at + 3]!;
			const l = m._text_lines() >> 3;
			// Byte offsets back to string offsets, for a caller that slices the text.
			const bytes = encoder.encode(text);
			const decoder = new TextDecoder();
			const index = (b: number) => decoder.decode(bytes.subarray(0, b)).length;
			const spans = Array.from({ length: lines }, (_, i) => ({ from: index(m.HEAPF64[l + i * 3]!), to: index(m.HEAPF64[l + i * 3 + 1]!), width: m.HEAPF64[l + i * 3 + 2]! }));
			return { unbroken: m.HEAPF64[at]!, longest: m.HEAPF64[at + 1]!, height: m.HEAPF64[at + 2]!, lines, spans };
		},
		measure(chain) {
			return (text, style, maxWidth) => {
				const got = engine.lines(text || " ", style, maxWidth === undefined ? undefined : Math.max(1, maxWidth), chain(style.fontFamily));
				return { w: maxWidth === undefined ? Math.ceil(got.unbroken) : Math.min(maxWidth, Math.ceil(got.longest)), h: got.height };
			};
		},
	};
	return engine;
}

const inNode = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string" && typeof (globalThis as { window?: unknown }).window === "undefined";

/** A scene module of its own, for text alone: the tests, and a page that only measures. */
export async function loadText(): Promise<TextEngine> {
	const options: Record<string, unknown> = { measure: () => ({ w: 0, h: 0 }) };
	if (!inNode) {
		const wasmUrl = new URL("../wasm/scene.wasm", import.meta.url).href;
		options.locateFile = (path: string) => (path.endsWith(".wasm") ? wasmUrl : path);
	}
	return textOf(await createSceneModule(options));
}
