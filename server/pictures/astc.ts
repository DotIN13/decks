import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

// A picture compressed for the GPU (rule 16): every size, 4 x 4 ASTC blocks,
// in one file the canvas reads. The encoder works in a scratch folder of its
// own under the system's temp folder, never in the deck.

export const MAGIC = "DKA1";
export const ASTC_TYPE = "application/vnd.decks.astc";
const run = promisify(execFile);

export type Level = { width: number; height: number; rgba: Uint8Array };

/** The astcenc binary for this machine, or undefined when none is installed. */
export function encoder(): string | undefined {
	try {
		const require = createRequire(import.meta.url);
		const pkg = require.resolve(`@astcenc/${process.platform}-${process.arch}/package.json`);
		const bin = (require(pkg) as { bin?: string | Record<string, string> }).bin;
		const path = typeof bin === "string" ? bin : bin ? Object.values(bin)[0] : undefined;
		return path ? join(dirname(pkg), path) : undefined;
	} catch {
		return undefined;
	}
}

/** The levels a browser page makes from a picture: the first a multiple of 16 each way, then halves. */
export const LEVELS = `async (b64) => {
	const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	const source = await createImageBitmap(new Blob([raw]));
	const round = (n) => Math.max(16, Math.round(n / 16) * 16);
	let width = round(source.width), height = round(source.height);
	let bitmap = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
	const out = [];
	for (;;) {
		const g = new OffscreenCanvas(width, height).getContext("2d");
		g.drawImage(bitmap, 0, 0);
		const px = g.getImageData(0, 0, width, height).data;
		for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; px[i] = Math.round(px[i] * a); px[i + 1] = Math.round(px[i + 1] * a); px[i + 2] = Math.round(px[i + 2] * a); }
		let text = "";
		for (let i = 0; i < px.length; i += 0x8000) text += String.fromCharCode(...px.subarray(i, i + 0x8000));
		out.push({ width, height, b64: btoa(text) });
		if (width === 1 && height === 1) return out;
		width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
		bitmap = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
	}
}`;

/** A TGA of one level, which astcenc reads: BGRA, 8 bits of alpha, rows from the top. */
function tga(level: Level): Buffer {
	const header = Buffer.alloc(18);
	header[2] = 2;
	header.writeUInt16LE(level.width, 12);
	header.writeUInt16LE(level.height, 14);
	header[16] = 32;
	header[17] = 0x28;
	const body = Buffer.alloc(level.width * level.height * 4);
	for (let i = 0; i < body.length; i += 4) {
		body[i] = level.rgba[i + 2]!;
		body[i + 1] = level.rgba[i + 1]!;
		body[i + 2] = level.rgba[i]!;
		body[i + 3] = level.rgba[i + 3]!;
	}
	return Buffer.concat([header, body]);
}

/** The file: MAGIC, width, height, level count, each level's length, then each level's blocks. */
export function pack(levels: Level[], blocks: Uint8Array[]): Uint8Array {
	const head = Buffer.alloc(16 + 4 * levels.length);
	head.write(MAGIC, 0, "ascii");
	head.writeUInt32LE(levels[0]!.width, 4);
	head.writeUInt32LE(levels[0]!.height, 8);
	head.writeUInt32LE(levels.length, 12);
	blocks.forEach((one, n) => head.writeUInt32LE(one.length, 16 + 4 * n));
	return new Uint8Array(Buffer.concat([head, ...blocks]));
}

/** Every level encoded, packed in one file. */
export async function compress(levels: Level[], binary = encoder()): Promise<Uint8Array> {
	if (!binary) throw new Error("no astcenc for this machine");
	const dir = await mkdtemp(join(tmpdir(), "decks-astc-"));
	try {
		const blocks: Uint8Array[] = [];
		for (const [n, level] of levels.entries()) {
			const input = join(dir, `${n}.tga`);
			const output = join(dir, `${n}.astc`);
			await writeFile(input, tga(level));
			await run(binary, ["-cl", input, output, "4x4", "-medium", "-silent"], { timeout: 60_000 });
			blocks.push(new Uint8Array((await readFile(output)).subarray(16)));
		}
		return pack(levels, blocks);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
