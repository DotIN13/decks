import { defaultWidth, formatOf } from "./kinds.ts";
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
	/** A slide deck's aspect, `"16:9"` by default — see `deck/kinds.ts`. */
	aspect?: string;
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META = /<meta\s+[^>]*name\s*=\s*["']([\w-]+)["'][^>]*>/gi;
const CONTENT = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * An attribute value as the browser would see it.
 *
 * A new board writes this tag single-quoted, so the JSON inside keeps its own
 * double quotes and needs nothing doing to it. But a board written by hand — or by an
 * editor that normalises quotes — arrives double-quoted, and then the only legal way to
 * carry `{"w":800}` is `content="{&quot;w&quot;:800}"`. That parsed as invalid JSON and was
 * swallowed by the `catch` below, so the board silently rendered at the default size and
 * the file looked correct to anyone reading it.
 *
 * Five entities, because those are the five a serialiser may produce in an attribute.
 */
function unescapeAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

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
			const parsed = JSON.parse(unescapeAttribute(value)) as { w?: unknown; h?: unknown; bg?: unknown; aspect?: unknown };
			if (Number.isFinite(Number(parsed.w))) meta.w = Number(parsed.w);
			if (Number.isFinite(Number(parsed.h))) meta.h = Number(parsed.h);
			if (typeof parsed.bg === "string") meta.bg = parsed.bg;
			/*
			 * `aspect` is here for an HTML deck, which has nowhere else to put it.
			 *
			 * A `.slides.md` declares it in front-matter; reveal's own markup has no
			 * equivalent — the slide size is an argument to `Reveal.initialize`, which is a
			 * script this view deliberately does not run. So it goes in the tag every board
			 * already carries rather than in something invented for the purpose.
			 */
			if (typeof parsed.aspect === "string" && parsed.aspect) meta.aspect = parsed.aspect;
		} catch {
			/* ignored: see above */
		}
	}

	return meta;
}

/**
 * The same document with a different size in it.
 *
 * Sizing a board is editing the one place that board keeps its size, which is exactly the kind of edit
 * an agent should not be doing by hand. For HTML it is JSON inside an attribute and the write has to
 * keep every other byte where it was. For markdown it is front-matter — and until this knew that, a
 * resize wrote a `<meta>` tag in above the `---`, where the front-matter parser stopped seeing it and
 * a reader saw the tag as text.
 *
 * Other keys are carried through, in either place: `bg`, `theme` and anything a later version adds to
 * the tag; `title`, `aspect` and the rest of the front-matter. A board with neither gets one, because
 * a board written by hand is still a board and refusing to resize it would be a rule about how it was
 * authored.
 */
export function withBoardSize(path: string, source: string, size: { w?: number; h?: number }): string {
	if (!HTML_FILE.test(path)) return withFrontMatterWidth(source, size);
	return withTagSize(source, size, defaultWidth(formatOf(path)));
}

/**
 * A markdown board's width, in the front-matter it already reads.
 *
 * **A height called on its own is nothing to write.** A markdown board's height is its content's and
 * the browser measures it, so a number in the file would be one nothing reads and every later write
 * has to carry — which is what `stage.fit` would otherwise add on every call.
 */
function withFrontMatterWidth(source: string, size: { w?: number; h?: number }): string {
	if (size.w === undefined) return source;
	const width = Math.max(1, Math.round(size.w));
	const line = `w: ${width}`;
	const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
	if (!block) return `---\n${line}\n---\n\n${source}`;
	const lines = (block[1] ?? "").split(/\r?\n/);
	const at = lines.findIndex((one) => /^w\s*:/.test(one));
	if (at >= 0) lines[at] = line;
	else lines.unshift(line);
	const rest = source.slice(block[0].length).replace(/^\r?\n/, "");
	return `---\n${lines.join("\n")}\n---\n\n${rest}`;
}

/** The HTML half: one number, in the one `<meta name="board">` tag. */
function withTagSize(html: string, size: { w?: number; h?: number }, fallback: number): string {
	const meta = readBoardMeta(html);
	// The same default the loader uses, and it has to be the same one: a file that says nothing
	// about its width would otherwise be given one number on disk and read back as another.
	const w = Math.max(1, Math.round(size.w ?? meta.w ?? fallback));
	/*
	 * A height nobody gave is **left out** rather than invented.
	 *
	 * It used to fall back to 800 and be written like any other number, which was wrong in the
	 * one case that matters: a document board's tag is `{"w":760,"bg":"plain"}` — the width is the
	 * only size it declares, because its height is its content and the browser measures it. A drag
	 * on the width of that board therefore wrote an `h` into the file that said nothing, had never
	 * been asked for, and would have to be kept in step with a measurement that overwrites it.
	 * Caught by `e2e/checks/geometry.mjs`, which asserts that the rest of the tag is untouched.
	 *
	 * Nothing is lost by omitting it: the loader has its own starting height for a board that
	 * declares none, and the browser replaces that with the content's as soon as anybody looks.
	 */
	const h = size.h !== undefined ? Math.max(1, Math.round(size.h)) : meta.h !== undefined ? Math.max(1, Math.round(meta.h)) : undefined;
	const stated = { w, ...(h !== undefined ? { h } : {}) };

	META.lastIndex = 0;
	for (let tag = META.exec(html); tag; tag = META.exec(html)) {
		if (tag[1]?.toLowerCase() !== "board") continue;
		const content = CONTENT.exec(tag[0]);
		let rest: Record<string, unknown> = {};
		if (content) {
			try {
				const parsed = JSON.parse(unescapeAttribute(content[1] ?? content[2] ?? "{}")) as Record<string, unknown>;
				const { w: _w, h: _h, ...others } = parsed;
				rest = others;
			} catch {
				/* a broken tag is replaced rather than preserved; it said nothing usable */
			}
		}
		const replaced = tag[0].replace(
			/content\s*=\s*(?:"[^"]*"|'[^']*')/i,
			`content='${JSON.stringify({ ...stated, ...rest })}'`,
		);
		// Single-quoted, because the JSON inside carries double quotes of its own. If the
		// tag had no `content` at all there is nothing to replace, so one is added.
		const written = replaced === tag[0] ? tag[0].replace(/\s*\/?>$/, ` content='${JSON.stringify({ ...stated, ...rest })}'>`) : replaced;
		return html.slice(0, tag.index) + written + html.slice(tag.index + tag[0].length);
	}

	const tag = `<meta name="board" content='${JSON.stringify({ ...stated, bg: "grid" })}' />`;
	const title = /<\/title>/i.exec(html);
	if (title) return `${html.slice(0, title.index + title[0].length)}\n\t\t${tag}${html.slice(title.index + title[0].length)}`;
	const head = /<head[^>]*>/i.exec(html);
	if (head) return `${html.slice(0, head.index + head[0].length)}\n\t\t${tag}${html.slice(head.index + head[0].length)}`;
	return `${tag}\n${html}`;
}


/**
 * What a board says about itself — an HTML document or a markdown file.
 *
 * The interesting field is the title, and the interesting decision is that it comes from the
 * **content**. A rail listing `notes.md`, `report.html`, `talk.slides.md` has no information
 * in it; a rail listing what those documents are called is the whole point of having one. So
 * the first `#` of a markdown file, or the `<title>` of a document, and the filename only
 * when neither exists.
 *
 * Front-matter is read for `w` and `aspect`, and deliberately not for anything else. It is
 * how a board an agent writes can declare its own width the way an HTML board can — without
 * it, an agent could create a markdown board but not size it, and would have to ask the user
 * to drag the edge. Not a full YAML parser: three keys, one line each, at the top of the
 * file, in the same spirit as the regex above.
 *
 * **An HTML file has no front-matter**, so for one of those the same three fields are taken
 * from `<meta name="board">` — the tag every board in every deck already carries. That is
 * what lets a `.slides.html` declare a 4:3 aspect: reveal's markup has no place to say it,
 * and inventing a place would be a second way to describe a file that already describes
 * itself.
 */
export function readMeta(path: string, source: string): BoardMeta {
	const meta: BoardMeta = HTML_FILE.test(path) ? readBoardMeta(source) : {};
	const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
	if (front) {
		for (const line of (front[1] ?? "").split(/\r?\n/)) {
			const pair = /^([a-z_]+)\s*:\s*(.+?)\s*$/i.exec(line);
			if (!pair) continue;
			const value = (pair[2] ?? "").replace(/^["']|["']$/g, "");
			if (pair[1] === "title" && value) meta.title = value;
			else if (pair[1] === "aspect" && value) meta.aspect = value;
			else if (pair[1] === "w") {
				const w = Number(value);
				if (Number.isFinite(w) && w > 0) meta.w = Math.round(w);
			}
		}
	}
	if (meta.title) return meta;

	// `<title>` for a document, then the first heading, then nothing — and `nothing` is
	// what makes the caller fall back to the filename.
	const titled = TITLE.exec(source);
	if (titled?.[1]?.trim()) return { ...meta, title: titled[1].trim() };
	const body = front ? source.slice(front[0].length) : source;
	const heading = /^\s*#\s+(.+?)\s*$/m.exec(body);
	if (heading?.[1]) return { ...meta, title: heading[1].replace(/\s*#*\s*$/, "") };
	// An HTML document with an `<h1>` but no `<title>`, which a lot of exports are.
	const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(source);
	if (h1?.[1]) return { ...meta, title: h1[1].replace(/<[^>]*>/g, "").trim() || undefined };
	void path;
	return meta;
}

/** Whether a path is HTML, for deciding where its metadata lives. */
const HTML_FILE = /\.html?$/i;

