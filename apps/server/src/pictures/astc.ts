import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

/**
 * Card pictures compressed for the GPU: ASTC in 4 × 4 blocks, a byte a pixel, every size of the
 * picture down to one pixel, so the canvas writes them straight to its GPU (`render/engine.ts`,
 * `putCompressedPicture`) with nothing decoded and nothing copied by the page, and holds them in a
 * quarter of the memory. Encoded by ARM's `astcenc` (the `astcenc` package's binary for this
 * machine); with none, pictures stay WebP.
 *
 * The file: `DKA1`, then width, height and the number of sizes as 32-bit little-endian numbers, then
 * each size's length in bytes, then the sizes' blocks one after another, largest first.
 */
export const MAGIC = "DKA1";

const run = promisify(execFile);

/** The encoder for this machine, or undefined when there is none. */
let found: string | null | undefined;
export function encoder(): string | undefined {
	if (found !== undefined) return found ?? undefined;
	try {
		const require = createRequire(import.meta.url);
		const pkg = require.resolve(`@astcenc/${process.platform}-${process.arch}/package.json`);
		const bin = (JSON.parse(readFileSync(pkg, "utf8")) as { bin?: string | Record<string, string> }).bin;
		const path = typeof bin === "string" ? bin : bin ? Object.values(bin)[0] : undefined;
		found = path ? join(dirname(pkg), path) : null;
	} catch {
		found = null;
	}
	return found ?? undefined;
}

/** One size of a picture: RGBA, rows top to bottom, premultiplied. */
export interface Level {
	width: number;
	height: number;
	rgba: Uint8Array;
}

/** An uncompressed TGA of a level, top row first: what `astcenc` reads. */
function tga(level: Level): Buffer {
	const header = Buffer.alloc(18);
	header[2] = 2;
	header.writeUInt16LE(level.width, 12);
	header.writeUInt16LE(level.height, 14);
	header[16] = 32;
	// 8 bits of alpha, rows from the top.
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

/** Every size compressed, in one file (`MAGIC`). */
export async function compress(levels: Level[], binary = encoder()): Promise<Buffer> {
	if (!binary) throw new Error("no astcenc for this machine");
	const dir = mkdtempSync(join(tmpdir(), "decks-astc-"));
	try {
		const blocks: Buffer[] = [];
		for (const [n, level] of levels.entries()) {
			const input = join(dir, `${n}.tga`);
			const output = join(dir, `${n}.astc`);
			writeFileSync(input, tga(level));
			await run(binary, ["-cl", input, output, "4x4", "-medium", "-silent"], { timeout: 60_000 });
			// The `.astc` file's own 16-byte header, then the blocks.
			blocks.push(readFileSync(output).subarray(16));
		}
		const head = Buffer.alloc(16 + 4 * levels.length);
		head.write(MAGIC, 0, "ascii");
		head.writeUInt32LE(levels[0]!.width, 4);
		head.writeUInt32LE(levels[0]!.height, 8);
		head.writeUInt32LE(levels.length, 12);
		blocks.forEach((one, n) => head.writeUInt32LE(one.length, 16 + 4 * n));
		return Buffer.concat([head, ...blocks]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
