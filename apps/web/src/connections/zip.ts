/**
 * Reading a `.decks` file: the zip `server/src/share/zip.ts` writes.
 *
 * The central directory is read for the names and offsets, then each entry's bytes are taken from
 * its local header, inflated with the browser's own `DecompressionStream`. Only stored and deflated
 * entries are read, which is everything the writer makes and almost every zip tool makes.
 */
export interface ZipFile {
	name: string;
	bytes(): Promise<Uint8Array>;
}

export class NotAZip extends Error {}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function readZip(buffer: ArrayBuffer): ZipFile[] {
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	// The end record is in the last 22 bytes plus at most a 64 KB comment.
	let end = -1;
	for (let at = buffer.byteLength - 22; at >= Math.max(0, buffer.byteLength - 22 - 65_535); at--) {
		if (view.getUint32(at, true) === 0x06054b50) {
			end = at;
			break;
		}
	}
	if (end < 0) throw new NotAZip("This file is not a .decks bundle: it is not a zip.");
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	const decoder = new TextDecoder();
	const files: ZipFile[] = [];
	for (let i = 0; i < count; i++) {
		if (view.getUint32(at, true) !== 0x02014b50) throw new NotAZip("This bundle's table of contents is damaged.");
		const method = view.getUint16(at + 10, true);
		const size = view.getUint32(at + 20, true);
		const nameLength = view.getUint16(at + 28, true);
		const extra = view.getUint16(at + 30, true);
		const comment = view.getUint16(at + 32, true);
		const local = view.getUint32(at + 42, true);
		const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + extra + comment;
		if (name.endsWith("/")) continue;
		files.push({
			name,
			bytes: async () => {
				const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
				const body = bytes.subarray(start, start + size);
				if (method === 0) return body.slice();
				if (method === 8) return inflate(body);
				throw new NotAZip(`${name} is packed in a way this reader does not know (method ${method}).`);
			},
		});
	}
	return files;
}
