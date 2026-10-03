import { crc32, deflateRawSync } from "node:zlib";

/**
 * A zip file, written whole in memory.
 *
 * A canvas bundle is tens of megabytes at most, and it is read back by a browser that has only
 * `DecompressionStream` to inflate with (`web/src/connections/zip.ts`), so the format used is the
 * plain one every reader knows: one local header per file, stored or deflated, then the central
 * directory. No zip64, no encryption, no data descriptors.
 *
 * A file is stored rather than deflated when deflating would not make it smaller, which is what
 * already-compressed pictures and fonts do.
 */
export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

/** DOS time and date for "now", which is what every entry carries: a bundle is one moment. */
function dosStamp(at: Date): { time: number; date: number } {
	const time = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2);
	const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
	return { time, date };
}

export function zip(entries: readonly ZipEntry[], at = new Date()): Buffer {
	const { time, date } = dosStamp(at);
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "utf8");
		const raw = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
		const crc = crc32(raw);
		const deflated = deflateRawSync(raw, { level: 6 });
		const stored = deflated.length >= raw.length;
		const body = stored ? raw : deflated;
		const method = stored ? 0 : 8;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6); // names are UTF-8
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, name, body);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(time, 12);
		central.writeUInt16LE(date, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);

		offset += local.length + name.length + body.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
