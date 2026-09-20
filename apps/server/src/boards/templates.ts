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
 * - `component` — absolutely-positioned boxes with `data-id`s. What every board was, and
 *   the only format Decks' own drag-and-retype editor can work on.
 * - `flow` — a document that reflows: markdown, or HTML that is not a component board.
 *   Its height is whatever its content is; see `deck/kinds.ts`.
 * - `slides` — reveal's markdown dialect, one slide at a time, aspect-locked.
 */
export type BoardFormat = "component" | "flow" | "slides";

export const BOARD_FORMATS: readonly BoardFormat[] = ["component", "flow", "slides"];

/**
 * What a new board of each format is called, and what it starts from.
 *
 * **The extension is derived from the format, never named by the caller.** A format and a
 * filename that could disagree is the one failure this design set out to make impossible:
 * `deck/kinds.ts` reads a board's format back *out of* its name, so a file called `.md` that
 * was asked for as slides would simply be a flow board and nothing would say why.
 */
const FORMATS: Record<BoardFormat, { extension: string }> = {
	component: { extension: ".html" },
	/*
	 * `.html`, not `.md` — every board this app writes is a single HTML file.
	 *
	 * A flow board used to be markdown, which meant the deck held two kinds of file and the
	 * markdown ones had to be wrapped in a synthesised document to be shown at all. An HTML
	 * flow board *is* the document: it carries board.css and board.js, says
	 * `class="board flow"`, and holds its content in one full-bleed component. Markdown is
	 * still read (`deck/kinds.ts`); it is no longer what gets created.
	 */
	flow: { extension: ".html" },
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
 * What a board with no size of its own is given.
 *
 * A *fallback dimension* rather than a maximum: `deck/loader.ts` hands it to a board whose
 * `<meta>` tag says nothing, and `deck/meta.ts` uses it when a resize arrives with no width.
 * Neither is a cap on anything, which is why it kept the number the old ceiling had and not
 * the name.
 */
export const DEFAULT_BOARD_W = 1600;

/**
 * A width a board may actually be: what was asked for, or the format's own, clamped.
 *
 * `viewport` is the room the canvas has (`stage.viewport()`), and `undefined` means nobody
 * is looking — a board written by an agent nobody is watching gets the format's default
 * rather than a guess, because a guess would be indistinguishable from a measurement at the
 * point it got used. The format's own default is 880 for a component board — the measure
 * prose actually wants — 720 for a flow document, and 960 for a deck, which is the logical
 * width a slide is laid out at so it opens at 1:1 with its own layout.
 */
export function boardWidth(wanted: number | undefined, viewport: number | undefined, format: BoardFormat = "component"): number {
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
	const own = format === "component" ? 880 : defaultFormatWidth(format);
	return Math.max(320, Math.min(own, room));
}

/**
 * The document for a new component board: a blank one.
 *
 * Heading and nothing else, on purpose, and the whole of what "no templates" means — every
 * board starts the same, and what it becomes is the agent's decision rather than the
 * shell's. The comment in the board is the only guidance: the title is the finding, the
 * import map in the head can reach any library, and the examples beside the deck show what
 * that looks like.
 */
export function renderBlank(title: string, size?: { w?: number; h?: number }): string {
	const w = Math.round(size?.w ?? 880);
	const h = Math.round(size?.h ?? 400);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeHtml(title)}</title>
		<meta name="board" content='{"w":${w},"h":${h},"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
		${importMapTag()}
	</head>
	<body class="board">
		<!--
			A blank board, by design: the app creates nothing but these.

			The heading is the title, and the title is the finding. Write it as a statement
			("Returning customer share fell after the second tab shipped") rather than a topic or
			a question, then fill the canvas under it.

			Whatever goes under it reads top to bottom and so does the file: one column, or a
			pair at x = 48 and x = 536 with the left one first. Lead with the finding and stop
			when it is said. A table beats a paragraph about a comparison, a diagram beats a
			paragraph about a structure, a number beats an adjective. Then \`stage.fit\` it, so
			the board is the size of what is on it rather than the size you guessed.

			For what a finished board can look like, read the examples in \`examples/\` beside
			this deck: worked boards for coding, research and business that use the libraries
			this head's import map names. Borrow their structure; do not start from one.
		-->
		<div class="text" data-id="heading" style="left: 48px; top: 40px; width: ${Math.max(320, w - 96)}px">
			<h1>${escapeHtml(title)}</h1>
		</div>

		<script src="../lib/board.js"></script>
	</body>
</html>
`;
}

/**
 * The document for a new board of a format that is not component HTML.
 *
 * One token and no layout, which is the difference from `renderBlank`: a flow board has no
 * boxes to place and a slide is laid out at a fixed logical size, so neither needs width
 * arithmetic. Both are blank too — a flow document is a title and an empty section, a slide
 * deck is one empty slide — for the same reason a component board is: the shape is the
 * agent's to make.
 */
export function renderFormat(format: Exclude<BoardFormat, "component">, title: string, size?: { w?: number }): string {
	const w = Math.round(size?.w ?? defaultFormatWidth(format));
	if (format === "slides") {
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
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeHtml(title)}</title>
		<!-- No height: a page's height is measured, never stored, so it cannot clip. -->
		<meta name="board" content='{"w":${w},"bg":"plain"}' />
		<!-- Colour and type tokens only (light and dark). The design is yours, in the style below. -->
		<link rel="stylesheet" href="../lib/theme.css" />
		<style>
			/* board.js sets the body to the board's width, so padding has to count inside it. */
			*, *::before, *::after { box-sizing: border-box; }
			body { margin: 0; padding: 40px 48px; font: 17px/1.5 var(--b-font); color: var(--b-fg); background: var(--b-bg); }
			h1 { margin: 0 0 8px; font-size: 34px; line-height: 1.2; letter-spacing: -0.01em; }
		</style>
		${importMapTag()}
	</head>
	<body class="board flow">
		<header data-id="title">
			<h1>${escapeHtml(title)}</h1>
		</header>
		<main data-id="main"></main>
		<script src="../lib/board.js"></script>
	</body>
</html>
`;
}

function defaultFormatWidth(format: Exclude<BoardFormat, "component">): number {
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
 * the app is already holding, fed in over `postMessage` by `canvas/live-chat.ts` and drawn
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
 * `web.status` the app is already holding (`canvas/live-chat.ts` feeds it, `lib/live-web.js`
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