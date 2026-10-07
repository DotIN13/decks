import { relative, resolve } from "node:path";
import { crc32 } from "node:zlib";

/** For tests: the simplest resolver a host could write, paths inside one folder, keyed relative to it. */
export function inside(root: string) {
	return (path: string) => {
		const file = resolve(root, path);
		const key = relative(root, file);
		if (key.startsWith("..")) throw new Error(`${path} is outside the folder`);
		return { file, key, writable: true };
	};
}

/** A zip of stored entries, built by hand, so the reader is tested against bytes it did not write. */
export function storedZip(files: Record<string, string>): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, body] of Object.entries(files)) {
		const n = Buffer.from(name);
		const data = Buffer.from(body);
		const crc = crc32(data) >>> 0;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(10, 4);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(n.length, 26);
		locals.push(local, n, data);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(10, 6);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(n.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, n);
		offset += 30 + n.length + data.length;
	}
	const dir = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(dir.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, dir, end]);
}
