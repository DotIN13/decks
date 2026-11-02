/**
 * A board picture compressed for the GPU, as the server sends it (`apps/server/src/boards/astc.ts`):
 * `DKA1`, width, height and the number of sizes, each size's length, then the sizes' ASTC blocks.
 * What `putCompressedPicture` takes: the bytes, and `[at, length, …]` of each size.
 */
export function readCompressed(data: Uint8Array): { data: Uint8Array; width: number; height: number; spans: Uint32Array; bytes: number } | undefined {
	if (data.length < 16 || String.fromCharCode(...data.subarray(0, 4)) !== "DKA1") return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const width = view.getUint32(4, true);
	const height = view.getUint32(8, true);
	const levels = view.getUint32(12, true);
	const spans = new Uint32Array(levels * 2);
	let at = 16 + 4 * levels;
	for (let n = 0; n < levels; n++) {
		const length = view.getUint32(16 + 4 * n, true);
		spans[n * 2] = at;
		spans[n * 2 + 1] = length;
		at += length;
	}
	if (at > data.length || levels === 0) return undefined;
	return { data, width, height, spans, bytes: at - (16 + 4 * levels) };
}
