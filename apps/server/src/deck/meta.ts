/**
 * What a board says about itself, read from the top of the file.
 *
 * Deliberately regex and not a parser: this runs for every board on every deck
 * load and on every file change, and the three things it wants are in the head of
 * a document the agent just wrote. `parse5` earns its place where correctness is
 * load-bearing — applying a user's edit to the file (§6.5) — not here, where a
 * missing title costs a heading in the rail.
 */

export interface BoardMeta {
	title?: string;
	w?: number;
	h?: number;
	bg?: string;
	poster?: string;
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META = /<meta\s+[^>]*name\s*=\s*["']([\w-]+)["'][^>]*>/gi;
const CONTENT = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

export function readBoardMeta(html: string): BoardMeta {
	const meta: BoardMeta = {};

	const title = TITLE.exec(html)?.[1]?.replace(/\s+/g, " ").trim();
	if (title) meta.title = title;

	META.lastIndex = 0;
	for (let tag = META.exec(html); tag; tag = META.exec(html)) {
		const name = tag[1]?.toLowerCase();
		const content = CONTENT.exec(tag[0]);
		const value = content?.[1] ?? content?.[2];
		if (!name || value === undefined) continue;

		if (name === "poster") {
			meta.poster = value;
			continue;
		}
		if (name !== "board") continue;

		// `content` is JSON so a board can grow a field without a new meta tag.
		// Written by hand as often as by an agent, so a broken one is ignored
		// rather than fatal — the board still renders at the default size.
		try {
			const parsed = JSON.parse(value) as { w?: unknown; h?: unknown; bg?: unknown };
			if (Number.isFinite(Number(parsed.w))) meta.w = Number(parsed.w);
			if (Number.isFinite(Number(parsed.h))) meta.h = Number(parsed.h);
			if (typeof parsed.bg === "string") meta.bg = parsed.bg;
		} catch {
			/* ignored: see above */
		}
	}

	return meta;
}
