/**
 * The document a new board starts from: a blank one.
 *
 * There are no templates any more. Every board the app creates is blank on purpose — the
 * heading is the title, nothing else — because a served shape turned out to be the wrong
 * bargain: it decided a board's look before the agent had a sentence, and a board that
 * starts shaped is a board the writer keeps the shape of. What an agent reaches for now is
 * the *examples* (`examples/` in the deck, refreshed from `runtime/examples/` on every
 * restart) — worked boards for coding, research and business that show the import map's
 * libraries in use, to borrow structure from rather than to be created from.
 *
 * Substitution is a handful of tokens and no template engine, the same as `pi/context.ts`
 * does for `AGENTS.md.tmpl`: `{{TITLE}}`, `{{W}}`, `{{H}}`, and `{{IMPORTMAP}}`, which
 * becomes the library map every new board's head carries (`IMPORT_MAP` below).
 */

/**
 * What a board *is*, as a file — the only choice a new board makes.
 *
 * - `board` — an HTML document with `data-id`s on its root-level blocks. A block that
 *   states where it goes is placed; a block that does not flows. Its height is whatever
 *   its content is, unless the file states one.
 * - `slides` — a reveal deck, one `<section>` per slide, laid out at a fixed size and
 *   scaled rather than reflowed.
 *
 * There were two board formats until this was written — `component` for placed boxes and
 * `flow` for a document — and they are one. Both words are still accepted from a caller
 * (`asBoardFormat`) and both mean `board`.
 */
export type BoardFormat = "board" | "slides";

export const BOARD_FORMATS: readonly BoardFormat[] = ["board", "slides"];

/**
 * What a new board of each format is called, and what it starts from.
 *
 * **The extension is derived from the format, never named by the caller.** A format and a
 * filename that could disagree is the one failure this design set out to make impossible:
 * `deck/kinds.ts` reads a board's format back *out of* its name, so a file called `.md` that
 * was asked for as slides would simply be a flow board and nothing would say why.
 */
const FORMATS: Record<BoardFormat, { extension: string }> = {
	/*
	 * `.html`, not `.md` — every board this app writes is a single HTML file.
	 *
	 * A document board used to be markdown, which meant the deck held two kinds of file and
	 * the markdown ones had to be wrapped in a synthesised document to be shown at all. An
	 * HTML board *is* the document: it carries board.css and board.js and holds its content
	 * in blocks of its own. Markdown is still read (`deck/kinds.ts`); it is no longer what
	 * gets created.
	 */
	board: { extension: ".html" },
	// `.slides.html` rather than `.slides.md`: HTML *is* reveal, and markdown is a plugin in
	// it. Both are read (`lib/slides.js` picks its splitter from the extension); a deck this
	// app creates is the native one.
	slides: { extension: ".slides.html" },
};

/** The extension a board of this format takes. */
export function extensionFor(format: BoardFormat): string {
	return FORMATS[format].extension;
}

export function isBoardFormat(value: unknown): value is BoardFormat {
	return typeof value === "string" && (BOARD_FORMATS as readonly string[]).includes(value);
}

/**
 * A format from whatever a caller said, including the two words that are now one thing.
 *
 * `component` and `flow` named the formats this one replaced, and they are all over the
 * wire, the agent tool's arguments and anybody's notes. Both answer `board`; anything
 * unrecognised answers nothing, and the caller's own default takes over.
 */
export function asBoardFormat(value: unknown): BoardFormat | undefined {
	if (isBoardFormat(value)) return value;
	return value === "component" || value === "flow" ? "board" : undefined;
}

/**
 * The width a board is worth keeping under, and it is **guidance, not a limit**.
 *
 * There used to be a hard cap here: 1600, clamped by `boardWidth` and again by `stage.fit`,
 * so a board that needed to be wider was quietly narrowed and its content left clipped.
 * That is the wrong trade — the thing being protected is readability, and a caller who
 * means 1800 has a reason that cannot be seen from in here. **Nothing is clamped now.**
 * What is left is a number to aim under, and defaults that are small on a small screen.
 *
 * 1200, because past it the eye loses its place coming back for the next line — and because
 * a board is read at the size the canvas has: `stage.viewport()` is the room on screen, not
 * divided by the zoom, so a board wider than the viewport is read scaled down.
 */
export const WIDE_BOARD_W = 1200;

/**
 * A width a board may actually be: what was asked for, or the format's own, clamped.
 *
 * `viewport` is the room the canvas has (`stage.viewport()`), and `undefined` means nobody
 * is looking — a board written by an agent nobody is watching gets the format's default
 * rather than a guess, because a guess would be indistinguishable from a measurement at the
 * point it got used. The format's own default is 1000 for a board, which is about as wide as
 * one is read at, and 960 for a deck, which is the logical width a slide is laid out at so it
 * opens at 1:1 with its own layout.
 */
export function boardWidth(wanted: number | undefined, viewport: number | undefined, format: BoardFormat = "board"): number {
	/*
	 * The room on screen, or nothing — and **no ceiling of our own**.
	 *
	 * This used to be `min(viewport, 1600)`, which capped a board on a large screen at a
	 * number nobody had asked for. What is left is the screen: a default should fit the
	 * device it will be read on, which is what keeps a phone's boards narrow.
	 */
	const room = viewport && viewport > 0 ? viewport : Number.POSITIVE_INFINITY;
	// A width somebody typed is theirs, whatever it is. The default is the only thing this
	// function decides, and an agent that means 1800 has a reason we cannot see from here.
	if (wanted) return Math.round(wanted);
	return Math.max(320, Math.min(defaultFormatWidth(format), room));
}

/**
 * The document for a new board: a blank one.
 *
 * Heading and nothing else, on purpose, and the whole of what "no templates" means — every
 * board starts the same, and what it becomes is the agent's decision rather than the
 * shell's. The comment in the board is the only guidance: the title is the finding, the
 * import map in the head can reach any library, and the examples beside the deck show what
 * that looks like.
 *
 * **No height in the meta tag.** A height there is a floor the content can raise and never
 * a ceiling, so leaving it out is what makes a new board exactly as tall as what gets
 * written on it. `stage.fit` writes one in once there is something to measure.
 *
 * The one block it starts with is the document: `.doc`, which board.css puts at the origin at
 * the full width of the board, as tall as its own content. A block beside it that states a
 * `left` and a `top` is placed at that point instead, and is the thing a person can drag. That
 * is the whole of the layout model, and board.css's `body.board > *` is what makes it work:
 * every root-level block is out of the flow, so two of them cannot push each other about.
 */
export function renderBlank(title: string, size?: { w?: number; h?: number }): string {
	const w = Math.round(size?.w ?? defaultFormatWidth("board"));
	// A stated height is a floor and a new board wants none — but a caller that asked for a
	// size meant it, so an explicit one is written and the content raises it if it needs to.
	const h = size?.h ? `,"h":${Math.round(size.h)}` : "";
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeHtml(title)}</title>
		<meta name="board" content='{"w":${w}${h},"bg":"plain"}' />
		<link rel="stylesheet" href="../lib/board.css" />
		<style>
			/* The design is yours. These are a starting measure, not a house style, and they say
			   \`.board .doc\` because that is what board.css's own rule for it says. */
			.board .doc { padding: 40px 48px; font-size: 17px; line-height: 1.5 }
			.board .doc h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.2; letter-spacing: -0.01em }
		</style>
		${importMapTag()}
	</head>
	<body class="board">
		<!--
			A blank board, by design: the app creates nothing but these.

			The heading is the title, and the title is the finding. Write it as a statement
			("Returning customer share fell after the second tab shipped") rather than a topic or
			a question, then fill the block under it.

			Every root-level block is out of the page's flow, so write inside this one: it is the
			width of the board and as tall as its content, which is what makes what you put in it
			read as a document, top to bottom. A block beside it that states a \`left\` and a
			\`top\` is placed at that point instead, and can be dragged. Both live in one file, and
			neither of them is a format.

			Lead with the finding and stop when it is said. A table beats a paragraph about a
			comparison, a diagram beats a paragraph about a structure, a number beats an
			adjective. Then \`stage.fit\` it, so the board is the size of what is on it rather
			than the size you guessed.

			For what a finished board can look like, read the examples in \`examples/\` beside
			this deck: worked boards for coding, research and business that use the libraries
			this head's import map names. Borrow their structure; do not start from one.
		-->
		<div class="doc" data-id="doc">
			<h1>${escapeHtml(title)}</h1>
		</div>

		<script src="../lib/board.js"></script>
	</body>
</html>
`;
}

/**
 * The document for a new deck of slides: one empty slide.
 *
 * No width arithmetic and no layout, which is the difference from a board: a slide is laid
 * out at a fixed logical size. Blank too, for the same reason — the shape is the agent's.
 */
export function renderSlides(title: string, size?: { w?: number }): string {
	const w = Math.round(size?.w ?? defaultFormatWidth("slides"));
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeHtml(title)}</title>
		<meta name="board" content='{"w":${w},"aspect":"16:9"}' />
	</head>
	<body class="reveal">
		<div class="slides">
			<section>
				<h1>${escapeHtml(title)}</h1>
			</section>
		</div>
	</body>
</html>
`;
}

function defaultFormatWidth(format: BoardFormat): number {
	return format === "slides" ? 960 : 1000;
}

/**
 * The libraries a new board can import by bare name, and the exact version each resolves to.
 *
 * One map, substituted into every new board's head through `{{IMPORTMAP}}`, so the versions are
 * bumped in one place. **It costs a board nothing.** An import map is a table of names — the
 * browser fetches a library only when a board actually imports it, and nothing is fetched at
 * all for a board that never does.
 *
 * Pinned rather than `@latest`, because a file's bytes are supposed to say what it renders; an
 * agent that wants another version edits the map in the board it is writing, which is the one it
 * will be read from. `three/addons/` is a prefix mapping, so `three/addons/controls/OrbitControls.js`
 * resolves beside the same `three` build the map names — those two have to match, or a scene ends up
 * with two copies of the library and an object from one is not an object from the other.
 */
const IMPORT_MAP = JSON.stringify(
	{
		imports: {
			d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm",
			three: "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
			"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/",
			gsap: "https://cdn.jsdelivr.net/npm/gsap@3.15.0/+esm",
			"chart.js": "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/+esm",
		},
	},
	null,
	2,
);

/**
 * The tag a `{{IMPORTMAP}}` token becomes.
 *
 * The JSON keeps its own two-space indentation rather than the document's tabs: an agent edits
 * this map in the file, and a JSON block that lines up like JSON is one it can edit without
 * counting tabs.
 */
function importMapTag(): string {
	return `<script type="importmap">\n${IMPORT_MAP}\n\t\t</script>`;
}

/**
 * A file name from a title: lower case, words joined by dashes, ASCII only where it can be.
 *
 * Titles are often not English — the first board written in this app was in Chinese — so
 * anything left after stripping the shape of a filename is kept rather than mangled, and a
 * title that reduces to nothing falls back to `fallback` (the word that names what is being
 * made: `board`, `mirror`, `web`).
 */
export function slugFor(title: string, fallback = "board"): string {
	const slug = title
		.toLowerCase()
		.replace(/['"`]/g, "")
		.replace(/[^\p{Letter}\p{Number}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || fallback;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The default size of a mirror: tall and narrow, because a conversation is a column. */
export const MIRROR_SIZE = { w: 560, h: 900 };

/**
 * The whole document of a live board.
 *
 * Four lines that never change, which is the point: a mirror's content is a conversation
 * the app is already holding, fed in over `postMessage` by `board/live-chat.ts` and drawn
 * by `lib/live-chat.js`. Nothing here is written again as the conversation grows — no
 * watcher event, no revision churn, and a board file somebody can read and understand.
 *
 * The component fills the board and carries an explicit height, so `contentExtent`
 * measures it exactly: a mirror never clips and `stage.fit` has nothing to do to it. The
 * growth happens inside, where the list scrolls.
 */
export function renderMirror(name: string, agentId: string, size?: { w?: number; h?: number }): string {
	const w = Math.round(size?.w ?? MIRROR_SIZE.w);
	const h = Math.round(size?.h ?? MIRROR_SIZE.h);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeHtml(name)}, the conversation</title>
		<meta name="board" content='{"w":${w},"h":${h},"bg":"plain"}' />
		<link rel="stylesheet" href="../../lib/board.css" />
	</head>
	<body class="board">
		<div
			class="live"
			data-id="mirror"
			data-live="chat"
			data-agent="${escapeHtml(agentId)}"
			style="left: 0; top: 0; width: ${w}px; height: ${h}px"
		></div>

		<script src="../../lib/board.js"></script>
	</body>
</html>
`;
}

/** The default size of the shared-browser card: a short, wide status card. */
export const WEB_BOARD_SIZE = { w: 560, h: 420 };

/**
 * The status board for the user's shared Chrome.
 *
 * A stub, like a mirror: the component carries `data-live="web"` and draws itself from the
 * `web.status` the app is already holding (`board/live-chat.ts` feeds it, `lib/live-web.js`
 * draws it). There is deliberately no picture of the tab in it — the tab is on the user's own
 * screen — so the card says which tab is shared, whether it is connected, what the agent did,
 * and carries the Allow/Deny for a submit and the Stop button.
 */
export function renderWebBoard(size?: { w?: number; h?: number }): string {
	const w = Math.round(size?.w ?? WEB_BOARD_SIZE.w);
	const h = Math.round(size?.h ?? WEB_BOARD_SIZE.h);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Your Chrome, shared with the deck</title>
		<meta name="board" content='{"w":${w},"h":${h},"bg":"plain"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<div
			class="live"
			data-id="web"
			data-live="web"
			style="left: 0; top: 0; width: ${w}px; height: ${h}px"
		></div>

		<script src="../lib/board.js"></script>
	</body>
</html>
`;
}