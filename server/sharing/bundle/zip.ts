import { crc32, deflateRawSync } from "node:zlib";

// A zip file in memory: each entry deflated unless that makes it bigger,
// names in UTF-8, one time for every entry, since a bundle is one moment.

export type ZipEntry = { name: string; data: Uint8Array };

function dosStamp(at: Date): { time: number; date: number } {
	const time = (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2);
	const date = ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate();
	return { time, date };
}

type Packed = { name: Buffer; body: Buffer; size: number; crc: number; method: number };

function pack(entry: ZipEntry): Packed {
	const raw = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
	const deflated = deflateRawSync(raw, { level: 6 });
	const stored = deflated.length >= raw.length;
	return { name: Buffer.from(entry.name, "utf8"), body: stored ? raw : deflated, size: raw.length, crc: crc32(raw), method: stored ? 0 : 8 };
}

/** The fields a local header and a central record share, from the version needed on. */
function common(p: Packed, time: number, date: number): Buffer {
	const b = Buffer.alloc(26);
	b.writeUInt16LE(20, 0);
	b.writeUInt16LE(0x0800, 2);
	b.writeUInt16LE(p.method, 4);
	b.writeUInt16LE(time, 6);
	b.writeUInt16LE(date, 8);
	b.writeUInt32LE(p.crc, 10);
	b.writeUInt32LE(p.body.length, 14);
	b.writeUInt32LE(p.size, 18);
	b.writeUInt16LE(p.name.length, 22);
	return b;
}

export function zip(entries: readonly ZipEntry[], at = new Date()): Buffer {
	const { time, date } = dosStamp(at);
	const parts: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const p of entries.map(pack)) {
		const head = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), common(p, time, date)]);
		parts.push(head, p.name, p.body);
		const tail = Buffer.alloc(14);
		tail.writeUInt32LE(offset, 10);
		centrals.push(Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0]), common(p, time, date), tail, p.name);
		offset += head.length + p.name.length + p.body.length;
	}
	const central = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(central.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...parts, central, end]);
}
