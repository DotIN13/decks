import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { lookOf } from "./ladder.ts";

/**
 * The pictures folder, cleaned of what nothing will ask for again (`PictureService.cleanDaily`):
 *
 * - every picture of a page the deck no longer has (a card deleted while the server was off, a whole
 *   canvas removed, a board the migration turned into a card under a new path);
 * - every picture of a page in a look other than the one it is drawn in now (`lookOf`), which a
 *   card's next picture would replace anyway, and which a page nobody pictures again keeps forever;
 * - a compressed picture (`.astc`) whose brotli copy (`.astc.br`) is beside it: the copy is what is
 *   sent, and the plain one is unpacked from it again for a browser that takes no brotli.
 *
 * A file written in the last ten minutes is left, since it may be one being made. Names that are not
 * pictures (a folder, a stage's shots) are left too.
 */
export interface CleanResult {
	removed: number;
	bytes: number;
	orphans: number;
	oldLooks: number;
	plainPacked: number;
}

const PICTURE = /^([0-9a-f]{16})-\d+-(?:light|dark)-/;
const LOOK = /-l(\d+)\.(?:webp|jpg|astc(?:\.br|\.gz)?)$/;
const FRESH_MS = 10 * 60_000;

/** The 16 characters a page's pictures start with (`thumbName`). */
export function pictureHash(path: string): string {
	return createHash("sha1").update(path).digest("hex").slice(0, 16);
}

export function cleanPictures(dir: string, pages: Iterable<string>, now = Date.now()): CleanResult {
	const looks = new Map<string, number>();
	for (const path of pages) looks.set(pictureHash(path), lookOf(path));
	const result: CleanResult = { removed: 0, bytes: 0, orphans: 0, oldLooks: 0, plainPacked: 0 };
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return result;
	}
	for (const name of names) {
		const page = PICTURE.exec(name);
		if (!page) continue;
		const file = join(dir, name);
		let stat;
		try {
			stat = statSync(file);
		} catch {
			continue;
		}
		if (!stat.isFile() || now - stat.mtimeMs < FRESH_MS) continue;
		const look = looks.get(page[1]!);
		const kind =
			look === undefined ? "orphans"
			: Number(LOOK.exec(name)?.[1] ?? 0) !== look ? "oldLooks"
			: name.endsWith(".astc") && existsSync(`${file}.br`) ? "plainPacked"
			: undefined;
		if (!kind) continue;
		rmSync(file, { force: true });
		result[kind] += 1;
		result.removed += 1;
		result.bytes += stat.size;
	}
	return result;
}
