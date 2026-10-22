/**
 * The document a new board starts from: a blank one.
 *
 * There are no templates any more. Every board the app creates is blank on purpose — the
 * heading is the title, nothing else — because a served shape turned out to be the wrong
 * bargain: it decided a board's look before the agent had a sentence, and a board that
 * starts shaped is a board the writer keeps the shape of.
 *
 * Substitution is a handful of tokens and no template engine, the same as `pi/context.ts`
 * does for `AGENTS.md.tmpl`: `{{TITLE}}`, `{{W}}`, `{{H}}`, and `{{IMPORTMAP}}`, which
 * becomes the library map every new board's head carries (`IMPORT_MAP` below).
 */

/**
 * The width a new board starts at when nobody asked for one: 1000, which is the measure a board is
 * written to and about as wide as one is read at.
 */
export const BOARD_W = 1000;

/**
 * The width a board is worth keeping under, and it is **guidance, not a limit**.
 *
 * There used to be a hard cap here: 1600, clamped by `boardWidth` and again by `decks.canvas.fit`,
 * so a board that needed to be wider was quietly narrowed and its content left clipped.
 * That is the wrong trade — the thing being protected is readability, and a caller who
 * means 1800 has a reason that cannot be seen from in here. **Nothing is clamped now.**
 * What is left is a number to aim under, and defaults that are small on a small screen.
 *
 * 1200, because past it the eye loses its place coming back for the next line — and because
 * a board is read at the size the canvas has: `decks.view.viewport()` is the room on screen, not
 * divided by the zoom, so a board wider than the viewport is read scaled down.
 */
export const WIDE_BOARD_W = 1200;

/**
 * A width a board may actually be: what was asked for, or the default (`BOARD_W`), clamped.
 *
 * `viewport` is the room the canvas has (`decks.view.viewport()`), and `undefined` means nobody
 * is looking — a board written by an agent nobody is watching gets the default rather than a
 * guess, because a guess would be indistinguishable from a measurement at the point it got used.
 */
export function boardWidth(wanted: number | undefined, viewport: number | undefined): number {
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
	return Math.max(320, Math.min(BOARD_W, room));
}

/**
 * The document for a new board: a blank one.
 *
 * Heading and nothing else, on purpose, and the whole of what "no templates" means — every
 * board starts the same, and what it becomes is the agent's decision rather than the
 * shell's. The comment in the board is the only guidance: the title is the finding, and the
 * import map in the head can reach any library.
 *
 * **No height in the meta tag.** A height there is a floor the content can raise and never
 * a ceiling, so leaving it out is what makes a new board exactly as tall as what gets
 * written on it. `decks.canvas.fit` writes one in once there is something to measure.
 *
 * The one block it starts with is the document: `.doc`, the width of the board and as tall as
 * its content. A board is one page that flows; everything written on it goes inside that block,
 * laid out with ordinary CSS. `data-id="doc"` is a name, so a comment or an agent can point at
 * it, and nothing depends on it.
 */
export function renderBlank(title: string, size?: { w?: number; h?: number }): string {
	const w = Math.round(size?.w ?? BOARD_W);
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

			The page flows: write inside this block, top to bottom, and lay it out with ordinary
			CSS (flex, grid). It is the width of the board and as tall as its content.

			Lead with the finding and stop when it is said. A table beats a paragraph about a
			comparison, a diagram beats a paragraph about a structure, a number beats an
			adjective. Then \`decks canvas fit\` it, so the board is the size of what is on it rather
			than the size you guessed.
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
 * The component fills the board (board.css, `body.board > .live`), so the page measures exactly
 * the board's height: a mirror never clips and `decks.canvas.fit` has nothing to do to it. The
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
		></div>

		<script src="../../lib/board.js"></script>
	</body>
</html>
`;
}

/** The default size of the shared-browser card: a short, wide status card. */
export const WEB_BOARD_SIZE = { w: 560, h: 420 };

/** A document board's size when it is made: a page and its bar, with room for the panel. */
export const DOC_BOARD_SIZE = { w: 1000, h: 1100 };

const escapeAttr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * A document board: one `data-live="doc"` box filling the board, naming its file (`lib/live-doc.js`).
 *
 * `dataPath` is as an embed's: relative to the board, or absolute for a file outside the deck.
 */
export function renderDocBoard(title: string, dataPath: string, size?: { w?: number; h?: number }): string {
	const w = Math.round(size?.w ?? DOC_BOARD_SIZE.w);
	const h = Math.round(size?.h ?? DOC_BOARD_SIZE.h);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeAttr(title)}</title>
		<meta name="board" content='{"w":${w},"h":${h},"bg":"plain"}' />
		<link rel="stylesheet" href="../../lib/board.css" />
	</head>
	<body class="board">
		<div class="live" data-id="doc" data-live="doc" data-path="${escapeAttr(dataPath)}"></div>

		<script src="../../lib/board.js"></script>
	</body>
</html>
`;
}

/**
 * A board that is one file, edge to edge: a PDF's pages, or a web page live, with nothing round it
 * — no heading, no frame, no name strip (`data-bare`, `lib/board.css`). The board is the file's own
 * shape: a PDF's first page, a laptop's screen for a page; a PDF's further pages scroll inside it.
 */
export function renderFileBoard(title: string, src: string, size: { w: number; h: number }): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeAttr(title)}</title>
		<meta name="board" content='{"w":${Math.round(size.w)},"h":${Math.round(size.h)},"bg":"plain"}' />
		<link rel="stylesheet" href="../../lib/board.css" />
	</head>
	<body class="board">
		<div data-id="file" data-embed="${escapeAttr(src)}" data-bare></div>

		<script src="../../lib/board.js"></script>
	</body>
</html>
`;
}

/**
 * A board that is an app (`apps/service.ts`): one `data-live="app"` box filling it, which
 * `lib/live-app.js` draws as a bar (state, name, Reload, Open, Log) over a frame of `/app/<name>/`.
 * A stub, like a document board: nothing about the app is in it but its name, so the app can
 * change, build and restart without the board being written again.
 */
export function renderAppBoard(name: string, title: string, size?: { w?: number; h?: number }): string {
	const w = Math.round(size?.w ?? 1100);
	const h = Math.round(size?.h ?? 760);
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${escapeAttr(title)}</title>
		<meta name="board" content='{"w":${w},"h":${h},"bg":"plain"}' />
		<link rel="stylesheet" href="../../lib/board.css" />
	</head>
	<body class="board">
		<div class="live" data-id="app" data-live="app" data-app="${escapeAttr(name)}"></div>

		<script src="../../lib/board.js"></script>
	</body>
</html>
`;
}

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
		></div>

		<script src="../lib/board.js"></script>
	</body>
</html>
`;
}