/**
 * Where everything on a film or a sound goes, for the two that draw it.
 *
 * A media item is drawn twice: by the sheet's worker as a still (`paint.ts` `paintMedia`), and,
 * once it is pressed, by the one live player laid over it (`MediaPlayer.tsx`). The press must not
 * move anything — the play button under the pointer is the pause button a frame later, and the
 * waveform the sound was drawn with is the one its progress runs along — so both read their
 * places from here, in the item's own stage pixels.
 */

export interface MediaBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The colours a sound's card takes, by the app's scheme: the card paper and ink the notes use. */
export const SOUND_INK = {
	light: { paper: "#ffffff", fg: "#161616", muted: "#5c5c5c", bar: "#0000002e", played: "#3b5cf6", disc: "#3b5cf6", glyph: "#ffffff" },
	dark: { paper: "#242424", fg: "#fafafa", muted: "#aeaeae", bar: "#ffffff38", played: "#6f8bff", disc: "#6f8bff", glyph: "#ffffff" },
} as const;

/** A sound's card, the size it is dropped at; the layout scales with its height from here. */
export const SOUND_SIZE = { w: 420, h: 72 } as const;

export interface SoundLayout {
	/** The scale against a card of `SOUND_SIZE`'s height. */
	k: number;
	disc: { cx: number; cy: number; r: number };
	/** The name's row: its left, its top, the width it may take, and its type size. */
	name: { x: number; y: number; w: number; size: number };
	/** The running time, right-aligned at `right` on the name's row. */
	time: { right: number; y: number; size: number };
	/** The waveform's band. */
	wave: { x: number; y: number; w: number; h: number };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function soundLayout(box: MediaBox): SoundLayout {
	const k = clamp(box.h / SOUND_SIZE.h, 0.5, 3);
	const pad = 14 * k;
	const r = Math.min(20 * k, box.h / 2 - 4);
	const cx = box.x + pad + r;
	const cy = box.y + box.h / 2;
	const left = cx + r + 14 * k;
	const right = box.x + box.w - pad;
	const top = box.y + 13 * k;
	const timeSize = 13 * k;
	const timeRoom = 82 * k;
	const waveTop = box.y + 38 * k;
	return {
		k,
		disc: { cx, cy, r },
		name: { x: left, y: top, w: Math.max(10, right - left - timeRoom), size: 14 * k },
		time: { right, y: top + 1 * k, size: timeSize },
		wave: { x: left, y: waveTop, w: Math.max(10, right - left), h: Math.max(4, box.y + box.h - 13 * k - waveTop) },
	};
}

/**
 * The waveform's bars, as rectangles in stage pixels: one per peak, centred on the band's middle,
 * never shorter than a dot so a silence still reads as part of the line. With no peaks (a sound
 * placed before the server read them, or one ffmpeg could not decode) there are none, and the
 * band is drawn as a plain track.
 */
export function waveBars(wave: SoundLayout["wave"], peaks: readonly number[] | undefined): Array<{ x: number; y: number; w: number; h: number; at: number }> {
	if (!peaks?.length) return [];
	const step = wave.w / peaks.length;
	const width = Math.max(1, step * 0.58);
	const middle = wave.y + wave.h / 2;
	return peaks.map((peak, i) => {
		const h = Math.max(width, clamp(peak, 0, 1) * wave.h);
		return { x: wave.x + i * step + (step - width) / 2, y: middle - h / 2, w: width, h, at: (i + 0.5) / peaks.length };
	});
}

export interface FilmLayout {
	disc: { cx: number; cy: number; r: number };
	/** The running time's pill, in the bottom-right corner. */
	pill: { right: number; bottom: number; size: number; padX: number; padY: number };
}

export function filmLayout(box: MediaBox): FilmLayout {
	const short = Math.min(box.w, box.h);
	const r = clamp(short * 0.12, 14, 36);
	const k = clamp(short / 300, 0.7, 1.6);
	return {
		disc: { cx: box.x + box.w / 2, cy: box.y + box.h / 2, r },
		pill: { right: box.x + box.w - 10 * k, bottom: box.y + box.h - 10 * k, size: 12 * k, padX: 7 * k, padY: 3 * k },
	};
}

/** The play triangle inside a disc, a little right of centre so it reads as pointing rather than sitting. */
export function playTriangle(cx: number, cy: number, r: number): number[] {
	const side = r * 0.8;
	return [cx - side * 0.3, cy - side * 0.5, cx + side * 0.55, cy, cx - side * 0.3, cy + side * 0.5];
}

/** A running time as a clock, as the board runtime prints it: 1:04, or 1:02:03 past an hour. */
export function clockOf(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const pad = (value: number) => String(value).padStart(2, "0");
	const minutes = Math.floor(whole / 60) % 60;
	const hours = Math.floor(whole / 3600);
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(whole % 60)}` : `${minutes}:${pad(whole % 60)}`;
}
