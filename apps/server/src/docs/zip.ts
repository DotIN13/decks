import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Just enough of the zip format to read one entry of a `.docx` and write it back.
 *
 * A `.docx` is a zip of XML, and the page edits one of them, `word/document.xml`. Reading takes
 * the central directory at the end of the file; writing rebuilds the archive with every other
 * entry's compressed bytes copied as they were, so nothing but the edited part is touched.
 * No zip64 and no encryption: a Word document needs neither.
 */

interface Entry {
	name: Buffer;
	method: number;
	crc: number;
	compressedSize: number;
	size: number;
	time: number;
	date: number;
	data: Buffer;
	external: number;
	versionMadeBy: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function entries(zip: Buffer): Entry[] {
	let end = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
		if (zip.readUInt32LE(i) === EOCD) {
			end = i;
			break;
		}
	}
	if (end === -1) throw new Error("Not a zip file: no end of central directory");
	const count = zip.readUInt16LE(end + 10);
	let at = zip.readUInt32LE(end + 16);
	const out: Entry[] = [];
	for (let n = 0; n < count; n++) {
		if (zip.readUInt32LE(at) !== CENTRAL) throw new Error("Not a zip file: a broken central directory");
		const method = zip.readUInt16LE(at + 10);
		const nameLength = zip.readUInt16LE(at + 28);
		const extraLength = zip.readUInt16LE(at + 30);
		const commentLength = zip.readUInt16LE(at + 32);
		const offset = zip.readUInt32LE(at + 42);
		const compressedSize = zip.readUInt32LE(at + 20);
		const name = zip.subarray(at + 46, at + 46 + nameLength);
		if (zip.readUInt32LE(offset) !== LOCAL) throw new Error(`Not a zip file: no local header for ${name}`);
		const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
		out.push({
			name: Buffer.from(name),
			method,
			crc: zip.readUInt32LE(at + 16),
			compressedSize,
			size: zip.readUInt32LE(at + 24),
			time: zip.readUInt16LE(at + 12),
			date: zip.readUInt16LE(at + 14),
			data: zip.subarray(start, start + compressedSize),
			external: zip.readUInt32LE(at + 38),
			versionMadeBy: zip.readUInt16LE(at + 4),
		});
		at += 46 + nameLength + extraLength + commentLength;
	}
	return out;
}

/** One entry's bytes, or `undefined` when the archive has no entry by that name. */
export function readEntry(zip: Buffer, name: string): Buffer | undefined {
	const entry = entries(zip).find((e) => e.name.toString("utf8") === name);
	if (!entry) return undefined;
	if (entry.method === 0) return Buffer.from(entry.data);
	if (entry.method === 8) return inflateRawSync(entry.data);
	throw new Error(`${name} is compressed in a way this reader does not know (method ${entry.method})`);
}

/** The archive with one entry's bytes replaced, every other entry copied as it was. */
export function replaceEntry(zip: Buffer, name: string, bytes: Buffer): Buffer {
	const list = entries(zip);
	const target = list.find((e) => e.name.toString("utf8") === name);
	if (!target) throw new Error(`The archive has no ${name}`);
	target.method = 8;
	target.data = deflateRawSync(bytes);
	target.crc = crc32(bytes) >>> 0;
	target.size = bytes.length;
	target.compressedSize = target.data.length;

	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of list) {
		const local = Buffer.alloc(30);
		local.writeUInt32LE(LOCAL, 0);
		local.writeUInt16LE(20, 4);
		// Bit 11: names are UTF-8. No data descriptor, since the sizes are written here.
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(entry.method, 8);
		local.writeUInt16LE(entry.time, 10);
		local.writeUInt16LE(entry.date, 12);
		local.writeUInt32LE(entry.crc, 14);
		local.writeUInt32LE(entry.compressedSize, 18);
		local.writeUInt32LE(entry.size, 22);
		local.writeUInt16LE(entry.name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, entry.name, entry.data);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(CENTRAL, 0);
		central.writeUInt16LE(entry.versionMadeBy || 20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(entry.method, 10);
		central.writeUInt16LE(entry.time, 12);
		central.writeUInt16LE(entry.date, 14);
		central.writeUInt32LE(entry.crc, 16);
		central.writeUInt32LE(entry.compressedSize, 20);
		central.writeUInt32LE(entry.size, 24);
		central.writeUInt16LE(entry.name.length, 28);
		central.writeUInt32LE(entry.external, 38);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, entry.name);
		offset += 30 + entry.name.length + entry.compressedSize;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(EOCD, 0);
	end.writeUInt16LE(list.length, 8);
	end.writeUInt16LE(list.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
