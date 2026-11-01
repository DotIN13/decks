/** A CSS colour as red, green, blue from 0 to 1, read through the browser (`rgb(…)` or `color(srgb …)`); grey when it cannot be read. */
export function rgbOf(css: string, probe?: HTMLElement): [number, number, number] {
	if (typeof document === "undefined") return [0.5, 0.5, 0.5];
	const el = probe ?? document.body;
	const was = el.style.color;
	el.style.color = css;
	const got = getComputedStyle(el).color;
	el.style.color = was;
	const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(got);
	if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
	const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(got);
	if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])];
	return [0.5, 0.5, 0.5];
}
