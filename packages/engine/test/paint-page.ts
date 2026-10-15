// The page for `paint-diff.mjs`: one tile painted twice, by CanvasKit through the app's `paint.ts`
// and by the C++ painter, and the two compared pixel by pixel.
import CanvasKitInit from "canvaskit-wasm/bin/canvaskit.js";
import { baseTheme, expand, layout, type PenDocument } from "@decks/pen";
import { paintDocument } from "../../../apps/web/src/canvas/pen/paint.ts";
import { paintRecord } from "../../../apps/web/src/canvas/pen/paint-wire.ts";
import { loadScene } from "../src/scene.ts";

declare global {
	interface Window {
		compare(doc: PenDocument, tile: { x: number; y: number; size: number }, scheme: "light" | "dark", pixels: number): Promise<unknown>;
	}
}

const ckReady = CanvasKitInit({ locateFile: (file: string) => `/${file}` });
const sceneReady = loadScene();
let painterCanvas: OffscreenCanvas | undefined;
let painter: ReturnType<Awaited<typeof sceneReady>["painter"]>;

window.compare = async (doc, tile, scheme, pixels) => {
	const ck = await ckReady;
	const scene = await sceneReady;
	const theme = baseTheme(doc, scheme);
	const nodes = expand(doc);
	const placed = layout(doc, nodes, { theme });
	// CanvasKit, in software, as the reference.
	const surface = ck.MakeSurface(pixels, pixels)!;
	const canvas = surface.getCanvas();
	canvas.clear(ck.TRANSPARENT);
	canvas.save();
	canvas.scale(pixels / tile.size, pixels / tile.size);
	canvas.translate(-tile.x, -tile.y);
	paintDocument(canvas, nodes, { ck, fonts: undefined as never, doc, placed, scheme, image: () => undefined, icon: () => undefined });
	canvas.restore();
	const want = canvas.readPixels(0, 0, { width: pixels, height: pixels, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB })!;
	surface.delete();
	// The C++ painter.
	scene.layout(doc, nodes, { theme, paint: (node, t) => paintRecord(doc, node, t, scheme) });
	if (!painterCanvas) {
		painterCanvas = new OffscreenCanvas(pixels, pixels);
		painter = scene.painter(painterCanvas);
	}
	if (painterCanvas.width !== pixels) {
		painterCanvas.width = pixels;
		painterCanvas.height = pixels;
	}
	const drawn = painter!.tile(tile.x, tile.y, tile.size, pixels, { dark: scheme === "dark" });
	const bitmap = painterCanvas.transferToImageBitmap();
	const read = new OffscreenCanvas(pixels, pixels).getContext("2d")!;
	read.drawImage(bitmap, 0, 0);
	const got = read.getImageData(0, 0, pixels, pixels).data;
	// Compared as colours on white, so a faint pixel's colour, which means little, does not count.
	let differ = 0, worst = 0;
	const over = (d: Uint8Array | Uint8ClampedArray, k: number) => [0, 1, 2].map((c) => (d[k + c]! * d[k + 3]! + 255 * (255 - d[k + 3]!)) / 255);
	for (let k = 0; k < want.length; k += 4) {
		const a = over(want, k), b = over(got, k);
		const d = Math.max(...a.map((v, c) => Math.abs(v - b[c]!)));
		worst = Math.max(worst, d);
		if (d > 24) differ++;
	}
	return { drawn, differ, worst: Math.round(worst), pixels: pixels * pixels, want: drawn && differ ? Array.from(want) : undefined, got: drawn && differ ? Array.from(got) : undefined };
};
