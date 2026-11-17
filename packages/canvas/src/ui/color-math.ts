/** A colour as hue (0 to 360), saturation and value (0 to 1), which is what the picker's square and strip move in. */
export type Hsv = { h: number; s: number; v: number };

export function hexToHsv(hex: string): Hsv {
	const m = /^#?([0-9a-f]{6})/i.exec(hex);
	const n = m ? parseInt(m[1]!, 16) : 0xffffff;
	const r = ((n >> 16) & 255) / 255;
	const g = ((n >> 8) & 255) / 255;
	const b = (n & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	const to = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
	return `#${to(r)}${to(g)}${to(b)}`;
}
