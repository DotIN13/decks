import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { imageSize } from "./shots.ts";
import { nativeBinary, NativeShots, type NativeRequest } from "./native-shots.ts";

/**
 * The native stage picture, through the real `stage-shot` when it is built (`cargo build --release
 * -p stage-shot` in packages/stage), and what it says when it cannot draw a box.
 */

const built = nativeBinary();
const doc = {
	version: "2.14",
	children: [
		{ type: "rectangle", id: "r", x: 20, y: 20, width: 100, height: 60, fill: "#2563eb" },
		{ type: "browser", id: "board:b", x: 200, y: 20, width: 120, height: 90, url: "boards/b.html" },
		{ type: "text", id: "sum", x: 20, y: 300, content: "Area $\\pi r^2$" },
	],
};

function request(dir: string, box: NativeRequest["box"], extra: Partial<NativeRequest> = {}): NativeRequest {
	const w = box.x2 - box.x1;
	const h = box.y2 - box.y1;
	return { doc, base: `${pathToFileURL(dir).href}/`, boards: [], box, scale: 1, width: w, height: h, scheme: "light", format: "png", out: join(dir, "out.png"), ...extra };
}

test("without the binary built, it says how to build it", async () => {
	const shots = new NativeShots({ boardPicture: () => ({ why: "none" }) }, () => undefined);
	const outcome = await shots.take(request(tmpdir(), { x1: 0, y1: 0, x2: 10, y2: 10 }));
	assert.equal(outcome.ok, false);
	assert.match(!outcome.ok ? outcome.why : "", /cargo build --release -p stage-shot/);
});

test("a board with no picture of its revision is said, before anything is drawn", async () => {
	const shots = new NativeShots({ boardPicture: (path) => ({ why: `the board ${path} has no picture` }) }, () => "/nonexistent/stage-shot");
	const outcome = await shots.take(request(tmpdir(), { x1: 0, y1: 0, x2: 400, y2: 200 }, { boards: [{ path: "boards/b.html", x: 200, y: 20, w: 120, h: 90 }] }));
	assert.deepEqual(outcome, { ok: false, why: "the board boards/b.html has no picture" });
});

test("drawn natively: a PNG of the box's size; math in the box sends it elsewhere", { skip: built ? false : "stage-shot is not built" }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "native-shots-"));
	const shots = new NativeShots({ boardPicture: () => ({ why: "no pictures here" }) });
	try {
		const outcome = await shots.take(request(dir, { x1: 0, y1: 0, x2: 160, y2: 100 }));
		assert.equal(outcome.ok, true, !outcome.ok ? outcome.why : "");
		const bytes = readFileSync(join(dir, "out.png"));
		assert.deepEqual(imageSize(bytes), { width: 160, height: 100 });
		// Warm: the second is the same picture, from the running process.
		assert.equal(shots.warm(), true);
		const again = await shots.take(request(dir, { x1: 0, y1: 0, x2: 160, y2: 100 }, { scale: 2, width: 320, height: 200 }));
		assert.equal(again.ok, true);
		assert.deepEqual(imageSize(readFileSync(join(dir, "out.png"))), { width: 320, height: 200 });
		const math = await shots.take(request(dir, { x1: 0, y1: 280, x2: 300, y2: 340 }));
		assert.equal(math.ok, false);
		assert.match(!math.ok ? math.why : "", /math \(sum\)/);
		// An image fill that is not there.
		const missing = await shots.take({ ...request(dir, { x1: 0, y1: 0, x2: 200, y2: 200 }), doc: { version: "2.14", children: [{ type: "rectangle", id: "p", x: 0, y: 0, width: 50, height: 50, fill: { type: "image", url: "gone.png", mode: "fill" } }] } });
		assert.equal(missing.ok, false);
		assert.match(!missing.ok ? missing.why : "", /cannot be loaded \(gone\.png\)/);
	} finally {
		shots.stop();
		rmSync(dir, { recursive: true, force: true });
	}
});
