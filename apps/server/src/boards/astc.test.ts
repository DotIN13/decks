import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { compress, encoder, MAGIC, type Level } from "./astc.ts";
import { compressedName, SMALL_WIDTHS, smallWidthFor, squeezed, wireEncoding, wireName } from "./thumbs.ts";

/** A picture's sizes, top half red and bottom half blue, each half the one before down to one pixel. */
function levels(width: number, height: number): Level[] {
	const out: Level[] = [];
	for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
		const rgba = new Uint8Array(w * h * 4);
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(y < h / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * w + x) * 4);
		out.push({ width: w, height: h, rgba });
		if (w === 1 && h === 1) break;
	}
	return out;
}

test("a picture's sizes compress into one file: its size, its count of sizes, and each size's blocks", { skip: !encoder() && "no astcenc for this machine" }, async () => {
	const file = await compress(levels(32, 16));
	assert.equal(file.subarray(0, 4).toString("ascii"), MAGIC);
	assert.deepEqual([file.readUInt32LE(4), file.readUInt32LE(8), file.readUInt32LE(12)], [32, 16, 6]);
	// 32 × 16 is 8 × 4 blocks, then 4 × 2, 2 × 1, and one block for each size from 4 × 2 down.
	const lengths = [0, 1, 2, 3, 4, 5].map((n) => file.readUInt32LE(16 + 4 * n));
	assert.deepEqual(lengths, [32 * 16, 8 * 16, 2 * 16, 16, 16, 16]);
	assert.equal(file.length, 16 + 4 * 6 + lengths.reduce((a, b) => a + b, 0));
	// Rows from the top: the first block is the red half, as a one-colour block holds it (16-bit RGBA at byte 8).
	const first = file.subarray(16 + 4 * 6, 16 + 4 * 6 + 16);
	assert.deepEqual([first.readUInt16LE(8), first.readUInt16LE(12)], [0xffff, 0]);
});

test("a picture's compressed sizes sit beside it", () => {
	assert.equal(compressedName("/d/ab-3-light-2-whole-w1024.webp"), "/d/ab-3-light-2-whole-w1024.astc");
});

test("pictures are kept at 192 and 480 px only, and another width asked for is sent the nearest", () => {
	assert.deepEqual(SMALL_WIDTHS, [192, 480]);
	assert.equal(smallWidthFor(192), 192);
	assert.equal(smallWidthFor(256), 480);
	assert.equal(smallWidthFor(480), 480);
	assert.equal(smallWidthFor(1024), 480);
	assert.equal(smallWidthFor(100), 192);
	assert.equal(smallWidthFor(Number("")), undefined);
	assert.equal(smallWidthFor(Number.NaN), undefined);
});

test("a compressed picture is squeezed for the wire once, beside it, and comes back the same", async () => {
	const dir = mkdtempSync(join(tmpdir(), "astc-wire-"));
	const packed = join(dir, "ab-3-light-2-whole-w480-l3.astc");
	// Blocks of plain paper repeat: what a board's picture mostly is.
	writeFileSync(packed, Buffer.alloc(64 * 1024, 7));
	const br = await squeezed(packed, "br");
	assert.equal(br, wireName(packed, "br"));
	assert.ok(statSync(br!).size < 1024);
	assert.deepEqual(brotliDecompressSync(readFileSync(br!)), readFileSync(packed));
	const gz = await squeezed(packed, "gzip");
	assert.equal(gz, `${packed}.gz`);
	assert.deepEqual(gunzipSync(readFileSync(gz!)), readFileSync(packed));
	rmSync(dir, { recursive: true, force: true });
});

test("brotli is sent where the browser takes it, else gzip (Safari over plain http), else neither", () => {
	assert.equal(wireEncoding("gzip, deflate, br, zstd"), "br");
	assert.equal(wireEncoding("gzip, deflate"), "gzip");
	assert.equal(wireEncoding("br;q=0, gzip"), "gzip");
	assert.equal(wireEncoding("identity"), undefined);
	assert.equal(wireEncoding(undefined), undefined);
	assert.equal(wireEncoding("brx"), undefined);
});
