/*
 * The board runtime: what turns a file of absolutely-positioned divs into a board.
 *
 * A board's head asks for `board.css`, this file, and — on a board this app wrote — an import
 * map. Anything it needs (markdown, maths, diagrams, PDFs) is fetched from the same `lib/`
 * directory the moment a component actually uses it, so a board of three stickies does not pay
 * for pdf.js and the agent does not have to remember which script tag goes with which component.
 * The map is the same bargain for the libraries an agent reaches for itself: a table of names,
 * pinned to versions, and nothing fetched until a board imports one.
 *
 * **It draws nothing of its own.** It used to route an arrow between two components
 * named by id, and that is gone on purpose: a line whose position is decided at mount
 * time is a drawing the file does not state, so the file stopped being the whole truth
 * about the board. Neither an agent nor a person could say where the line went without
 * running the page, and there was nothing to edit. A diagram is now a component that
 * owns its own geometry — an `<svg>` with coordinates its author chose — which is a
 * thing both of them can read and change. See `skills/board-authoring`.
 *
 * **What it renders, it can be asked to render again.** A `[data-md]` or
 * `[data-mermaid]` component is written as its source and mounted as the drawing made
 * from it, so a moment later the file's own words are nowhere in the live document.
 * That is why markdown used to be the one thing a user could not retype. The source is
 * kept instead, and handed out through `window.__board` along with a re-render of a
 * single component — which is what lets the editor open it, and what lets the frame
 * stay on the revision it loaded instead of reloading a whole board for one panel.
 *
 * It also owns the readiness flag. Every async mount is awaited, then
 * `window.__boardReady` goes true — which is what the app waits for before it
 * measures a board, and what the agent's Playwright waits for before it takes a
 * picture. Without it a screenshot is a race, and the race is usually lost. A
 * re-render takes the flag down and puts it back for the same reason.
 */
(() => {
	"use strict";

	/** Where this script came from, so its siblings can be found. */
	const LIB = new URL(".", document.currentScript?.src ?? "./").href;
	const lib = (file) => new URL(file, LIB).href;

	const loaded = new Map();

	/** Load a classic script once, resolving when its global is there. */
	function needScript(file) {
		if (loaded.has(file)) return loaded.get(file);
		const promise = new Promise((resolve, reject) => {
			const el = document.createElement("script");
			el.src = lib(file);
			el.onload = () => resolve();
			el.onerror = () => reject(new Error(`Cannot load ${file}`));
			document.head.appendChild(el);
		});
		loaded.set(file, promise);
		return promise;
	}

	function needStyle(file) {
		const key = `style:${file}`;
		if (loaded.has(key)) return loaded.get(key);
		const promise = new Promise((resolve) => {
			const el = document.createElement("link");
			el.rel = "stylesheet";
			el.href = lib(file);
			// A stylesheet that will not load is a cosmetic failure, not a reason to
			// hold up the board: resolve either way.
			el.onload = () => resolve();
			el.onerror = () => resolve();
			document.head.appendChild(el);
		});
		loaded.set(key, promise);
		return promise;
	}

	/** Load an ES module once. `import()` works from a classic script. */
	function needModule(file) {
		const key = `module:${file}`;
		if (!loaded.has(key)) loaded.set(key, import(lib(file)));
		return loaded.get(key);
	}

	// --- paths -------------------------------------------------------------------

	/**
	 * This board's own deck-relative path, from the URL it was served at.
	 *
	 * Null when the board was opened as a plain file, which is a supported way to
	 * look at one: there is no app to ask, so every path stays relative and the
	 * out-of-deck embeds are the only thing that does not work.
	 */
	const BOARD_PATH = (() => {
		const match = location.pathname.match(/^\/api\/board\/(.+)$/);
		return match ? decodeURIComponent(match[1]) : null;
	})();

	/**
	 * A board's idea of a path -> a URL a browser can fetch.
	 *
	 * Relative paths mean what they would mean in an `<img src>`: relative to this
	 * board. Ones that stay inside the deck are used as they are, which is what
	 * keeps a board openable as a plain file. Anything pointing outside goes
	 * through `/api/file`, which resolves it against a declared root and redirects
	 * to the absolute URL it lives at.
	 *
	 * It has to be a query parameter rather than a path: a browser strips `..`
	 * segments — and their `%2e%2e` spellings — out of a URL path before the
	 * request is sent, so `/api/file/../shared/x.html` would arrive as
	 * `/api/shared/x.html` and 404. Query strings are left alone.
	 */
	function urlFor(raw) {
		const path = String(raw ?? "").trim();
		if (!path) return null;
		if (/^(https?|data|blob):/i.test(path)) return path;
		if (path.startsWith("/api/f/") || path.startsWith("/api/file")) return path;
		if (!BOARD_PATH) return path;

		if (!path.startsWith("~") && !path.startsWith("/")) {
			const resolved = new URL(path, location.href);
			if (resolved.origin === location.origin && resolved.pathname.startsWith("/api/board/")) {
				return resolved.pathname + resolved.search;
			}
		}
		return `/api/file?path=${encodeURIComponent(path)}&from=${encodeURIComponent(BOARD_PATH)}`;
	}

	const nameOf = (path) => String(path).split("/").filter(Boolean).pop() ?? String(path);

	// --- links -------------------------------------------------------------------

	/*
	 * What a click on a link means inside a board.
	 *
	 * **A link never navigates the frame.** A board document *is* the reader's page, so
	 * sending it to example.com replaces the board with a foreign site at an address nobody
	 * can get back from — a frame has no back button — and a link to a sibling board would do
	 * the same thing, one board over. Both are losses, and neither is what the link's author
	 * meant.
	 *
	 * So a click becomes one of two things, and **which one is decided here, in the click
	 * itself**:
	 *
	 * - **a link to a board file** — a `.html` or `.md` path that resolves inside the deck —
	 *   goes up to the app as a request to put that board on the canvas (`{ decks:
	 *   "board.open" }`, and the deck-relative path). The app is the only thing here that knows
	 *   the deck, so it decides whether there is a board there, and a path it does not hold is
	 *   a notice rather than a board.
	 * - **everything else** — another site, or a file in the deck that is not a board, a PDF or
	 *   an image — opens in a tab of its own, by putting `target` on the anchor *before* the
	 *   default action runs. Deliberately not `preventDefault` plus `window.open`: a real
	 *   navigation keeps the tab, the address bar, the context menu and the middle click for
	 *   free, and the browser's own new-tab behaviour is then the feature rather than an
	 *   imitation of it.
	 *
	 * **It has to be decided here** rather than by asking the app. A tab can only be opened
	 * from a user gesture, and an answer that arrives as a `postMessage` is one turn too late
	 * for one: a `window.open` in the app's message handler opens an empty window and never
	 * navigates it, measured rather than guessed. The cost is the glob below, which is
	 * `deck/kinds.ts`'s — one list, two readers, and the same bargain `familyOf` makes with
	 * `embedFamily` on the app's side.
	 *
	 * Deliberately silent in **edit mode**, where a press on a link is part of dragging or
	 * retyping the component it sits in. `data-decks-edit` is the app's own flag on this
	 * document (`canvas/BoardFrame.tsx` does the writing), so this needs no second channel to
	 * ask about it.
	 *
	 * Opened as a plain file with no app above it, a board link opens in a tab as well: there
	 * is nobody to ask, and a new tab beats losing the board being read.
	 */
	const BOARD_PREFIX = "/api/board/";
	/** What a board file is called (`deck/kinds.ts`): the one thing about a board that a link can be read against. */
	const BOARD_FILE = /\.(?:html?|mdx?)$/i;

	/** The deck-relative path behind a `/api/board/…` URL, or null if it is not one. */
	function boardPathOf(url) {
		if (url.origin !== location.origin || !url.pathname.startsWith(BOARD_PREFIX)) return null;
		const path = url.pathname.slice(BOARD_PREFIX.length);
		// A percent-escape the browser let through but nothing can read is not a path.
		try {
			return decodeURIComponent(path);
		} catch {
			return null;
		}
	}

	/**
	 * Open a URL in its own tab.
	 *
	 * On the anchor when there is one, so the *browser* opens it: that is the difference
	 * between a link and a script, and it is what keeps a link's own `target` — an author who
	 * already wrote one has said where it should go.
	 */
	function openTab(url, anchor) {
		if (!anchor) {
			window.open(url, "_blank", "noopener");
			return;
		}
		if (anchor.target !== "_blank") anchor.target = "_blank";
		if (!/(^|\s)noopener(\s|$)/.test(anchor.rel)) anchor.rel = anchor.rel ? `${anchor.rel} noopener` : "noopener";
	}

	function onLinkClick(event) {
		/*
		 * Every one of these is a click the browser should handle exactly as it always has: a
		 * modified or non-primary click is *already* "open in a new tab", and a link inside a
		 * run of words while that run is open for typing belongs to the caret.
		 */
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (document.documentElement.hasAttribute("data-decks-edit")) return;
		const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (!anchor) return;
		const raw = (anchor.getAttribute("href") ?? "").trim();
		// A jump within this board is the one link that stays in it, and the one `urlFor` is
		// not asked about.
		if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) return;

		/*
		 * **Relative means relative to the board** — the same rule `[data-embed]` follows, and
		 * the reason a link and an embed of the same file agree about where it is. Everything
		 * else is a URL and is left alone, which is also what keeps an absolute `/api/board/…`
		 * href working as the browser reads it.
		 */
		const target = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/") ? raw : urlFor(raw);
		if (!target) return;
		let url;
		try {
			url = new URL(target, location.href);
		} catch {
			return;
		}

		const path = boardPathOf(url);
		if (path && BOARD_FILE.test(path) && window.parent !== window) {
			event.preventDefault();
			window.parent.postMessage({ decks: "board.open", path }, "*");
			return;
		}
		openTab(url.href, anchor);
	}

	/* Capture, so a board's own scripts — a live component, a game, an embed's gesture
	   guard — cannot swallow the click first: the link belongs to the document. */
	document.addEventListener("click", onLinkClick, true);

	// --- the board itself --------------------------------------------------------

	function readMeta() {
		const tag = document.querySelector('meta[name="board"]');
		let meta = {};
		if (tag) {
			try {
				meta = JSON.parse(tag.getAttribute("content") ?? "{}");
			} catch (error) {
				console.warn("[board] meta is not valid JSON:", error);
			}
		}
		return meta;
	}

	function applyMeta(meta) {
		const board = document.body;
		board.classList.add("board");
		if (Number.isFinite(Number(meta.w))) board.style.width = `${Number(meta.w)}px`;
		if (Number.isFinite(Number(meta.h))) board.style.height = `${Number(meta.h)}px`;
		board.dataset.bg = typeof meta.bg === "string" ? meta.bg : "grid";
		if (typeof meta.theme === "string") document.documentElement.dataset.theme = meta.theme;
	}

	// --- markdown and maths ------------------------------------------------------

	/**
	 * Markdown written inline in a board is indented to match the HTML around it,
	 * and every one of those spaces is significant to a markdown parser — four of
	 * them make a code block. So strip the common indent before parsing.
	 */
	function dedent(text) {
		const lines = text.replace(/\t/g, "  ").split("\n");
		const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length);
		const common = indents.length ? Math.min(...indents) : 0;
		return lines.map((line) => line.slice(common)).join("\n").trim();
	}

	async function renderMarkdown(target, source) {
		await needScript("marked.umd.js");
		const marked = window.marked;
		target.innerHTML = marked.parse(dedent(stripFrontMatter(source)), { gfm: true, breaks: false });
		await renderMath(target);
		await highlightCode(target);
	}

	/**
	 * Drop a YAML front-matter block, because it is metadata and not content.
	 *
	 * `marked` has no idea what front-matter is, so it renders the fence as a horizontal
	 * rule and the keys as a paragraph — a markdown board opened with a rule and the words
	 * "w: 760" across the top of it. True of any `.md` embedded on a board, not only of a
	 * board that is one, so it belongs here rather than in the shell.
	 *
	 * **Conservative on purpose.** A file may legitimately open with `---` as a rule, so the
	 * block only counts as front-matter if every line in it looks like `key: value`. Getting
	 * this wrong in the permissive direction eats the first section of somebody's document.
	 */
	function stripFrontMatter(source) {
		const text = String(source ?? "");
		const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
		if (!match) return text;
		const lines = (match[1] ?? "").split(/\r?\n/).filter((line) => line.trim().length > 0);
		if (lines.length === 0) return text;
		if (!lines.every((line) => /^[A-Za-z_][\w-]*\s*:/.test(line) || /^\s+\S/.test(line))) return text;
		return text.slice(match[0].length);
	}

	// --- code --------------------------------------------------------------------

	/**
	 * Which grammar an extension means, for a source file drawn as an embed.
	 *
	 * A fenced block in markdown says its own language (```ts), and a file says it with its
	 * extension — so this is the one place that second question is answered. An extension
	 * that is not here is drawn as it is, which is the honest answer for a `.txt` or a
	 * `.csv`: they are text and not a language, and a highlighter told otherwise invents
	 * structure that is not in the file. `.toml` and `.env` are read as `ini` because that
	 * is the nearest grammar the highlighter has, and it is close enough to be useful.
	 */
	const LANGUAGE_BY_EXTENSION = {
		ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
		js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
		py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin",
		c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", swift: "swift", php: "php",
		sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
		sql: "sql", css: "css", scss: "scss", less: "less",
		json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
		toml: "ini", ini: "ini", cfg: "ini", conf: "ini", env: "ini",
		diff: "diff", patch: "diff",
	};

	/**
	 * The highlighter, fetched the first time a board actually shows code.
	 *
	 * Vendored and not a stylesheet from a CDN, for the reason every other renderer here is:
	 * a board has to draw itself with no network, and a code block that is coloured on one
	 * machine and plain on another is a board that reads differently to the person looking at
	 * it and to the agent reading a screenshot of it.
	 *
	 * It carries the grammars and never a theme. The colours are `board.css`'s — the same
	 * tokens as everything else on the board — so light and dark are decided by the same two
	 * rules as the rest of the palette, and a board that styles itself does not fight a
	 * third-party theme for the foreground colour of a string.
	 */
	let highlightReady;
	function highlighter() {
		if (!highlightReady) {
			highlightReady = needModule("hljs.bundle.mjs").then((module) => module.default ?? module);
		}
		return highlightReady;
	}

	/** The elements a `highlightCode` call has already taken, so nothing is coloured twice. */
	const highlighting = new WeakSet();

	/**
	 * How much code is worth colouring, in characters.
	 *
	 * A highlighter is a tokeniser, and this one runs on the main thread while the board is
	 * being read. A text embed is allowed to draw the first 256 KB of a file, and a JSON dump
	 * that size is not read line by line by anybody — the first 64 KB is already more than a
	 * person scrolls. Past this the block is drawn as it was, which is what it did before
	 * there was a highlighter here.
	 */
	const HIGHLIGHT_LIMIT = 64 * 1024;

	/** The language an element names in its class, or the one its caller already knows. */
	function languageOf(element, fallback) {
		const named = /(?:^|\s)(?:lang|language)-([\w+#.]+)/i.exec(element.className ?? "");
		return String(named?.[1] ?? fallback ?? "").trim().toLowerCase() || null;
	}

	/**
	 * Colour every code block under `root` — and load the highlighter only if there is one.
	 *
	 * Three rules here are decisions rather than implementation details:
	 *
	 * - **A language that is not named is not guessed at.** `highlightAuto` scores every
	 *   grammar against the text and picks the winner: slow, and wrong often enough on a
	 *   five-line fragment to be worse than plain. A fence with no language is drawn plain,
	 *   the same way it is on GitHub.
	 * - **The scan and the claim on each element happen before the first `await`.** Two of these
	 *   run over the same document — the renderer that drew a markdown panel, and the pass at
	 *   the end of `start` that finds what the file itself carries — and an element claimed
	 *   twice would be wrapped in spans twice.
	 * - **A failure is a plain block, never a broken board.** One grammar throwing on one file
	 *   must not take the rest of the page with it.
	 */
	async function highlightCode(root, fallback) {
		if (!root?.querySelectorAll) return;

		const blocks = [];
		const consider = (element) => {
			if (!element || highlighting.has(element)) return;
			const text = element.textContent ?? "";
			if (!text.trim() || text.length > HIGHLIGHT_LIMIT) return;
			highlighting.add(element);
			blocks.push(element);
		};

		/*
		 * Blocks and only blocks. A `pre` is the block; its `code` child is what gets the
		 * classes, and a `pre` written without one is coloured itself. Inline `<code>` in a
		 * sentence is left alone on purpose: it lives inside a run of words that a person can
		 * retype, and spans put inside it would be markup the run editor would faithfully spell
		 * back into the file. Markdown's fenced blocks are `pre > code` and are unaffected — an
		 * inline code span has no language class and would not be coloured anyway.
		 */
		const candidates = [...root.querySelectorAll("pre")];
		if (root.matches?.("pre")) candidates.unshift(root);
		for (const pre of candidates) {
			const first = pre.firstElementChild;
			consider(first?.tagName === "CODE" ? first : pre);
		}
		if (blocks.length === 0) return;

		let hljs;
		try {
			hljs = await highlighter();
		} catch (error) {
			console.warn("[board] the highlighter did not load:", error);
			return;
		}

		for (const element of blocks) {
			const language = languageOf(element, fallback);
			if (!language || !hljs.getLanguage(language)) continue;
			try {
				element.innerHTML = hljs.highlight(element.textContent ?? "", { language, ignoreIllegals: true }).value;
				// Both classes, always: the highlighted element says which grammar produced it, even
				// when the grammar came from a file's extension rather than from a fence. A board's
				// own stylesheet can then key on one language, and a check can read the answer out.
				element.classList.add("hljs", `language-${language}`);
			} catch (error) {
				console.warn(`[board] could not highlight ${element.tagName.toLowerCase()} as ${language}:`, error);
			}
		}
	}

	/** KaTeX, but only if the text plausibly contains maths. */
	async function renderMath(target) {
		const text = target.textContent ?? "";
		if (!/\$|\\\(|\\\[/.test(text)) return;
		await Promise.all([needStyle("katex.min.css"), needScript("katex.min.js")]);
		await needScript("katex-auto-render.min.js");
		try {
			window.renderMathInElement(target, {
				delimiters: [
					{ left: "$$", right: "$$", display: true },
					{ left: "$", right: "$", display: false },
					{ left: "\\(", right: "\\)", display: false },
					{ left: "\\[", right: "\\]", display: true },
				],
				throwOnError: false,
			});
		} catch (error) {
			console.warn("[board] maths did not render:", error);
		}
	}

	/**
	 * The source each rendered component was written from.
	 *
	 * A `WeakMap` and not an attribute: the source is the file's, and writing it into
	 * the live DOM as a `data-source` would put a copy of it in the document the
	 * inspector reads and the editor walks — a second truth to keep in step, in the one
	 * place this project insists there is only one. A component the board removes takes
	 * its entry with it.
	 */
	const sources = new WeakMap();

	/** What a component's source is now: what it was retyped to, or what the file said. */
	function sourceOf(element) {
		const kept = sources.get(element);
		return kept === undefined ? (element.textContent ?? "") : kept;
	}

	/**
	 * Draw a `[data-md]` or `[data-mermaid]` component, and remember what from.
	 *
	 * The source is read out of the element the first time — after which the element no
	 * longer holds it, because rendering is what replaced it. A failure is reported in
	 * place and never rethrown: one diagram that will not parse must not take the board
	 * down with it, and the source is kept either way, so it can be retyped into
	 * something that does parse.
	 */
	async function drawSource(element, source) {
		const raw = source === undefined ? sourceOf(element) : source;
		sources.set(element, raw);
		const diagram = element.dataset.mermaid !== undefined;
		try {
			if (diagram) await renderMermaid(element, raw);
			else await renderMarkdown(element, raw);
		} catch (error) {
			const said = error instanceof Error ? error.message : String(error);
			if (diagram) element.textContent = `mermaid: ${said}`;
			console.warn(`[board] ${diagram ? "mermaid" : "markdown"}:`, error);
		}
	}

	/**
	 * Draw one component again, from a source the user has just changed.
	 *
	 * The alternative is reloading the frame, and the frame is deliberately pinned to
	 * the revision it loaded so a user's own edit does not reload the board they are
	 * editing (DESIGN §7) — a markdown panel that could only be re-rendered by reload
	 * would flash the whole board on every keystroke's worth of commit.
	 *
	 * `__boardReady` goes down for as long as it takes, because everything that waits
	 * for a board waits on that flag and a flag left true through a re-render is a
	 * promise this file had quietly stopped keeping. `board:ready` is *not* dispatched
	 * again: that event means the board finished loading, which happens once, and a
	 * board's own `<script>` listening for it would run a second time.
	 */
	async function redraw(element, source) {
		window.__boardReady = false;
		document.body.dataset.ready = "false";
		try {
			await drawSource(element, source);
		} finally {
			window.__boardReady = true;
			document.body.dataset.ready = "true";
		}
	}

	// --- mermaid -----------------------------------------------------------------

	let mermaidReady;
	async function renderMermaid(target, source) {
		if (!mermaidReady) {
			mermaidReady = needModule("mermaid.bundle.mjs").then(async (module) => {
				const mermaid = module.default ?? module;
				const dark =
					document.documentElement.dataset.theme === "dark" ||
					(!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
				const token = (name, fallback) =>
					getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
				mermaid.initialize({
					startOnLoad: false,
					theme: "base",
					themeVariables: {
						background: token("--b-bg", dark ? "#161616" : "#ffffff"),
						primaryColor: token("--b-accent-soft", dark ? "#1e2a52" : "#d7e2fc"),
						primaryBorderColor: token("--b-accent", "#3b5cf6"),
						primaryTextColor: token("--b-fg", dark ? "#fafafa" : "#161616"),
						lineColor: token("--b-border-strong", dark ? "#666" : "#999"),
						textColor: token("--b-fg", dark ? "#fafafa" : "#161616"),
						// Edge labels have their own three tokens; left to the theme's
						// defaults they come out a green that belongs to no palette here.
						tertiaryColor: token("--b-bg-layer", dark ? "#242424" : "#f2f2f2"),
						tertiaryTextColor: token("--b-muted", dark ? "#aeaeae" : "#5c5c5c"),
						edgeLabelBackground: token("--b-bg", dark ? "#161616" : "#ffffff"),
						fontSize: "14px",
					},
					// The diagram source comes from the same place the board does, but
					// "strict" costs nothing here and keeps a pasted diagram honest.
					securityLevel: "strict",
					fontFamily: getComputedStyle(document.body).fontFamily,
				});
				return mermaid;
			});
		}
		const mermaid = await mermaidReady;
		const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
		const { svg } = await mermaid.render(id, dedent(source));
		target.innerHTML = svg;

		/*
		 * Mermaid sizes its SVG to the diagram; a board sizes its components to the
		 * layout. Without this the diagram spills out of the panel it was put in —
		 * and since the SVG carries a viewBox, dropping the fixed width is all it
		 * takes for it to scale down into the box instead.
		 */
		const drawn = target.querySelector("svg");
		if (drawn) {
			drawn.removeAttribute("width");
			drawn.removeAttribute("height");
			drawn.style.maxWidth = "100%";
			drawn.style.maxHeight = "100%";
			drawn.setAttribute("preserveAspectRatio", "xMidYMid meet");
		}
	}

	// --- PDFs --------------------------------------------------------------------

	/** "3-5", "2", "1,4-6" -> [3,4,5] / [2] / [1,4,5,6]. Empty means "all". */
	function parsePages(spec, total) {
		if (!spec) return null;
		const pages = new Set();
		for (const part of String(spec).split(",")) {
			const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
			if (range) {
				const from = Number(range[1]);
				const to = Number(range[2]);
				for (let page = Math.max(1, from); page <= Math.min(total, to); page++) pages.add(page);
				continue;
			}
			const single = Number(part.trim());
			if (Number.isInteger(single) && single >= 1 && single <= total) pages.add(single);
		}
		return pages.size > 0 ? [...pages].sort((a, b) => a - b) : null;
	}

	let pdfjsReady;
	async function renderPdf(body, url, spec, width) {
		if (!pdfjsReady) {
			pdfjsReady = needModule("pdf.min.mjs").then((pdfjs) => {
				pdfjs.GlobalWorkerOptions.workerSrc = lib("pdf.worker.min.mjs");
				return pdfjs;
			});
		}
		const pdfjs = await pdfjsReady;
		const doc = await pdfjs.getDocument({
			url,
			// Vendored beside this file so a board renders a paper with no network.
			standardFontDataUrl: lib("standard_fonts/"),
			wasmUrl: lib("wasm/"),
			// Nothing in a board needs PDF scripting, and it is the part of a PDF
			// most worth not running.
			isEvalSupported: false,
		}).promise;

		const pages = parsePages(spec, doc.numPages) ?? [...Array(doc.numPages).keys()].map((index) => index + 1);
		for (const number of pages) {
			const page = await doc.getPage(number);
			const base = page.getViewport({ scale: 1 });
			// Render at the component's width, times the display density, so a
			// zoomed-in board is not looking at a blurry upscale.
			const scale = Math.min(4, ((width || base.width) / base.width) * Math.min(2, devicePixelRatio || 1));
			const viewport = page.getViewport({ scale });
			const canvas = document.createElement("canvas");
			canvas.className = "page";
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			body.appendChild(canvas);
			await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
			await stillPicture(canvas);
		}
		return `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`;
	}

	/**
	 * A rendered page is kept as an image, not left on the canvas it was drawn on.
	 *
	 * A `<canvas>` is a drawing surface, and the browser treats it as one for as long as it
	 * exists: while the board is being panned or zoomed, every frame re-uploads each canvas's
	 * pixels to the compositor as if something might have drawn on it — about 2ms per page at
	 * 4× CPU throttle, paid on every step of every gesture for the life of the board. Nothing
	 * ever draws on it again, so the same pixels as an `<img>` are a picture the compositor
	 * keeps. The swap waits for the image to load, so `__boardReady` still means visible.
	 */
	function stillPicture(canvas) {
		return new Promise((resolve) => {
			canvas.toBlob((blob) => {
				if (!blob) return resolve();
				const image = document.createElement("img");
				image.className = canvas.className;
				image.width = canvas.width;
				image.height = canvas.height;
				image.alt = "";
				image.addEventListener("load", () => resolve(), { once: true });
				image.addEventListener("error", () => resolve(), { once: true });
				image.src = URL.createObjectURL(blob);
				canvas.replaceWith(image);
			}, "image/png");
		});
	}

	// --- embeds ------------------------------------------------------------------

	function chrome(host, kind, label, note) {
		host.classList.add("embed");
		host.dataset.kind = kind;
		host.innerHTML = "";
		const head = document.createElement("div");
		head.className = "embed-head";
		const name = document.createElement("span");
		name.className = "name";
		name.textContent = label;
		name.title = label;
		const right = document.createElement("span");
		right.className = "note";
		right.textContent = note ?? "";
		head.append(name, right);
		const body = document.createElement("div");
		body.className = "embed-body";
		host.append(head, body);
		return { head, body, note: right };
	}

	/** A delta big enough to be a mistake or a prank is not a gesture. */
	const CLAMP = 2000;
	const clampDelta = (value) => Math.max(-CLAMP, Math.min(CLAMP, value));

	/**
	 * Finger ids for embeds, from a range no real pointer will use.
	 *
	 * The stage pools fingers by id from every document it can see, so a guest's own
	 * `pointerId` — which starts at 1 in its document, like everyone else's — would be
	 * the same finger as a thumb on the board next to it, and a pinch made of the two
	 * would be one finger teleporting. Counted here rather than per embed, so two embeds
	 * cannot collide either.
	 */
	let nextEmbedFinger = 900001;

	/**
	 * An HTML embed, and the gesture that cannot get out of it.
	 *
	 * `frame-gestures.ts` forwards a wheel out of a *board* by listening inside the
	 * board's own document, which same origin allows (DESIGN §4). An HTML embed is one
	 * document deeper and sandboxed, so nobody can listen inside it: a two-finger scroll
	 * over an embedded page arrives there and stops, and the canvas — which pans by
	 * handling wheel itself rather than by scrolling anything — never learns the gesture
	 * happened. The board could not be dragged by that patch of itself either, which is
	 * the same bug wearing a different hat.
	 *
	 * Two answers, and an embed gets whichever one it earns:
	 *
	 * - **A veil**, for a page that has never heard of Decks. A transparent sheet in
	 *   *this* document covers the frame, so wheel and pointer land where the canvas can
	 *   already see them; a click lifts it, and it comes back when the pointer leaves the
	 *   box. That last part is the whole design: an embedded prototype has to be usable,
	 *   and a scroll must not be swallowed by something you are merely passing over.
	 *   Leaving is the release gesture because Escape cannot be — once focus is inside
	 *   the frame its keys belong to its document too, which is where this started.
	 * - **The bridge**, for a page that opts in with `lib/embed-guest.js`. It applies the
	 *   same rule one level down — a scroll its own boxes can take is theirs, the rest is
	 *   posted up — and this side replays it as a wheel over the frame, which
	 *   `frame-gestures.ts` then forwards without ever knowing it was synthetic. A guest
	 *   needs no veil and no click, so announcing itself takes the veil away.
	 *
	 * Touch goes the same way and cannot go the same route: a fabricated `pointerdown`
	 * would reach the board's editor as well as the canvas, so fingers arrive as a
	 * `decks:embed-finger` event that only `frame-gestures.ts` reads, while a fabricated
	 * wheel is indistinguishable from a real one to the only listener that wants it.
	 *
	 * Only messages from this frame's own window are read, and only the three shapes below.
	 * An embed is quarantined content; a postMessage channel into the app's document is
	 * exactly the sort of thing that must not quietly become a remote control.
	 */
	function guardEmbed(host, body, frame) {
		/** This embed's own finger ids -> the ones the stage is told about. */
		const fingers = new Map();

		const veil = document.createElement("div");
		veil.className = "embed-veil";
		const hint = document.createElement("div");
		hint.className = "embed-hint";

		const live = () => host.classList.contains("embed-live");
		const set = (on) => {
			host.classList.toggle("embed-live", on);
			hint.textContent = on ? "interacting · leave to pan" : "click to interact";
		};

		veil.addEventListener("click", () => set(true));
		hint.addEventListener("click", (event) => {
			event.stopPropagation();
			set(!live());
		});
		body.addEventListener("pointerleave", () => set(false));
		document.addEventListener("pointerdown", (event) => {
			if (!host.contains(event.target)) set(false);
		});
		// Works while focus is still out here, which is the case worth having.
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape") set(false);
		});

		body.append(veil, hint);
		set(false);

		window.addEventListener("message", (event) => {
			// A remount replaces the frame; the listener on `window` outlives it.
			if (!frame.isConnected) return;
			if (event.source !== frame.contentWindow) return;
			const message = event.data;
			if (!message || typeof message !== "object") return;

			if (message.t === "decks:embed-ready") {
				host.classList.add("embed-guest");
				host.classList.remove("embed-live");
				veil.remove();
				hint.remove();
				return;
			}
			if (message.t === "decks:touch") {
				const phase = message.phase;
				if (phase !== "down" && phase !== "move" && phase !== "up") return;
				const raw = Number(message.id);
				const x = Number(message.x);
				const y = Number(message.y);
				if (!Number.isFinite(raw) || !Number.isFinite(x) || !Number.isFinite(y)) return;

				let id = fingers.get(raw);
				if (id === undefined) {
					// A move or an up for a gesture this side never saw begin is noise.
					if (phase !== "down") return;
					id = nextEmbedFinger++;
					fingers.set(raw, id);
				}

				/*
				 * Named rather than replayed. A synthetic `WheelEvent` is read by nobody
				 * but `frame-gestures.ts`, so replaying one is honest; a synthetic
				 * `pointerdown` would also reach the editor, which would select this
				 * embed and then drag it while the finger was busy inside the page.
				 * `frame-gestures.ts` listens for this event and nothing else does.
				 */
				const rect = frame.getBoundingClientRect();
				document.dispatchEvent(
					new CustomEvent("decks:embed-finger", {
						detail: { phase, id, x: rect.left + x, y: rect.top + y },
					}),
				);
				if (phase === "up") fingers.delete(raw);
				return;
			}
			if (message.t !== "decks:wheel") return;

			const dx = Number(message.dx);
			const dy = Number(message.dy);
			if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;

			/*
			 * The guest's `clientX/clientY` are its own pixels, and its own pixels are
			 * this document's: the frame fills the embed's body at 1:1, and the canvas's
			 * zoom is a transform on an ancestor of both. So the point is the frame's
			 * offset plus the guest's and the deltas pass through unchanged — the same
			 * trade `frame-gestures.ts` makes one level up, for the same reason.
			 */
			const rect = frame.getBoundingClientRect();
			frame.dispatchEvent(
				new WheelEvent("wheel", {
					deltaX: clampDelta(dx),
					deltaY: clampDelta(dy),
					clientX: rect.left + (Number(message.x) || 0),
					clientY: rect.top + (Number(message.y) || 0),
					ctrlKey: message.zooming === true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
	}

	/**
	 * The extensions rendered as escaped preformatted text.
	 *
	 * Two families were originally one: `.txt` was handled inside the markdown branch
	 * and everything else with a `.py` or a `.json` in it fell through to the generic
	 * "here is a file" chip, which is a blank box with a name on it. Source is the
	 * thing people most often want *on* a board next to a plan, so it is a family.
	 *
	 * Rendered with `textContent`, never `innerHTML`: a `.json` containing `<script>`
	 * is a file with those characters in it, and a board is same-origin (DESIGN §4),
	 * so parsing it as markup would be the one place foreign bytes could execute with
	 * the app's authority.
	 */
	const TEXTUAL = new Set([
		"txt", "text", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
		"ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cc", "cpp", "hpp",
		"cs", "swift", "php", "sh", "bash", "zsh", "fish", "sql", "css", "scss", "less", "diff", "patch",
	]);

	/** How much of a text file is drawn. A 50MB log must not become a 50MB DOM node. */
	const TEXT_LIMIT = 256 * 1024;

	/**
	 * Which family an extension belongs to — the one place that decides.
	 *
	 * It was a ladder of `if`s inside the mount, which was fine until there were six
	 * of them and the fallback stopped being an edge case: "anything" is the whole
	 * point of an embed, so what happens to an unrecognised file is a family too.
	 */
	function familyOf(extension) {
		if (["md", "markdown", "mdx"].includes(extension)) return "md";
		if (extension === "pdf") return "pdf";
		if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"].includes(extension)) return "image";
		if (["html", "htm", "xhtml"].includes(extension)) return "html";
		if (TEXTUAL.has(extension)) return "text";
		return "file";
	}

	/** A byte count as a person would say it. */
	function sizeLabel(bytes) {
		if (!Number.isFinite(bytes) || bytes <= 0) return "";
		if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	}

	async function mountEmbed(host) {
		const raw = host.dataset.embed;
		const url = urlFor(raw);
		const label = nameOf(raw);
		if (!url) {
			chrome(host, "missing", String(raw), "no path");
			return;
		}

		/*
		 * The extension comes from the path the *board* wrote, not from the URL it
		 * resolved to: an out-of-deck path becomes `/api/file?path=...`, which ends
		 * in no extension at all, and every embed outside the deck was landing in
		 * the generic "here is a file" branch.
		 */
		const extension = (String(raw).split("?")[0].split("#")[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
		const mode = host.dataset.mode ?? "live";
		const family = familyOf(extension);

		try {
			if (family === "md") {
				const { body, note } = chrome(host, "md", label);
				const response = await fetch(url);
				if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
				const text = await response.text();
				await renderMarkdown(body, text);
				note.textContent = `${text.split("\n").length} lines`;
				return;
			}

			if (family === "text") {
				const { body, note } = chrome(host, "text", label);
				/*
				 * Asked for by range, so the truncation happens on the wire rather than in
				 * memory: `/api/board` and `/api/f` both send with `acceptRanges`, and a
				 * board that fetched a 50MB log in full would stall every other mount
				 * behind it — `__boardReady` waits for all of them.
				 *
				 * A server that ignores the header answers 200 with everything, so the
				 * slice below is the second half of the same guard.
				 */
				const response = await fetch(url, { headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } });
				if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
				const whole = await response.text();
				const text = whole.slice(0, TEXT_LIMIT);
				/*
				 * A 206 does *not* mean truncated: a range wider than the file is answered
				 * with the whole file and a 206 anyway, so every text embed claimed to be
				 * "the first 256 KB". `Content-Range` carries the real total, and the
				 * character-count fallback is for a server that ignored the header.
				 */
				const total = Number(String(response.headers.get("content-range") ?? "").split("/")[1]);
				const partial = Number.isFinite(total) ? total > TEXT_LIMIT : whole.length >= TEXT_LIMIT;
				const pre = document.createElement("pre");
				const code = document.createElement("code");
				// textContent: this is somebody else's file, and it is text.
				code.textContent = text;
				pre.appendChild(code);
				body.appendChild(pre);
				// The extension says what the file is; `data-lang` is the way out for a file whose
				// name says nothing useful (`queries.txt` that is really SQL).
				await highlightCode(pre, host.dataset.lang || LANGUAGE_BY_EXTENSION[extension]);
				if (partial) {
					const rest = document.createElement("a");
					rest.className = "more";
					rest.href = url;
					rest.target = "_blank";
					rest.rel = "noreferrer";
					rest.textContent = "open the whole file";
					body.appendChild(rest);
				}
				note.textContent = partial
					? `first ${sizeLabel(TEXT_LIMIT)}${Number.isFinite(total) ? ` of ${sizeLabel(total)}` : ""}`
					: `${text.split("\n").length} lines`;
				return;
			}

			if (family === "pdf") {
				const { body, note } = chrome(host, "pdf", label, "loading…");
				const pages = await renderPdf(body, url, host.dataset.pages, host.clientWidth - 2);
				note.textContent = host.dataset.pages ? `pages ${host.dataset.pages} of ${pages}` : pages;
				return;
			}

			if (family === "image") {
				const { body } = chrome(host, "image", label);
				const img = document.createElement("img");
				img.src = url;
				img.alt = label;
				body.appendChild(img);
				return;
			}

			if (family === "html") {
				const { body, note } = chrome(host, "html", label, mode === "snapshot" ? "snapshot" : "live");
				/*
				 * The one place a board contains something it did not write.
				 *
				 * `/api/file` already serves it with `Content-Security-Policy: sandbox`,
				 * so it is in an opaque origin before this attribute is read; the
				 * attribute says the same thing again for the case where the response
				 * is cached or the route changes. A foreign page gets scripts and
				 * nothing else — no same-origin, no forms, no top-level navigation.
				 */
				const frame = document.createElement("iframe");
				frame.src = url;
				frame.setAttribute("sandbox", "allow-scripts");
				frame.setAttribute("referrerpolicy", "no-referrer");
				frame.title = label;
				body.appendChild(frame);
				note.textContent = mode === "snapshot" ? "snapshot" : "sandboxed";
				// A thumbnail has no pointer, and a veil in one would only be furniture.
				if (mode !== "snapshot") guardEmbed(host, body, frame);
				return;
			}

			/*
			 * Anything else — a `.zip`, a `.sketch`, a file with no extension at all.
			 *
			 * This is the branch that decides whether "drop anything onto a board" is
			 * true, so it is a component rather than an apology: the name, the size, the
			 * kind, and two things to do with it. A blank box with a console warning
			 * behind it was the previous answer, and a user looking at the board could
			 * not tell it from a broken embed.
			 */
			const { body, note } = chrome(host, "file", label);
			let size;
			try {
				const head = await fetch(url, { method: "HEAD" });
				if (!head.ok) throw new Error(`${head.status}`);
				const length = Number(head.headers.get("content-length"));
				if (Number.isFinite(length) && length > 0) size = length;
			} catch {
				/* the chip is worth showing even when the size is not known */
			}
			const link = document.createElement("a");
			link.href = url;
			link.target = "_blank";
			link.rel = "noreferrer";
			link.textContent = label;
			const meta = document.createElement("span");
			meta.className = "meta";
			meta.textContent = [extension ? `${extension.toUpperCase()} file` : "file", sizeLabel(size)]
				.filter(Boolean)
				.join(" · ");
			// `download` and not another `target=_blank`: for a type the browser cannot
			// display, opening is a download that looks like a failed navigation, and for
			// one it can, a person who wants the file wants the file.
			const save = document.createElement("a");
			save.className = "more";
			save.href = url;
			save.download = label;
			save.textContent = "download";
			body.append(link, meta, save);
			note.textContent = extension || "file";
		} catch (error) {
			const { body } = chrome(host, "missing", label, "not available");
			const message = document.createElement("span");
			message.textContent = String(raw);
			const why = document.createElement("span");
			why.textContent = error instanceof Error ? error.message : String(error);
			body.append(message, why);
			console.warn(`[board] embed ${raw}:`, error);
		}
	}

	/** A live component: fed by the app, over `postMessage`, and never from the file. */
	/**
	 * Draw a slide deck, and hand the app the handle it pages with.
	 *
	 * The handle goes on `window.__deck` rather than being returned, because the thing that
	 * drives it is in the *parent* document: the arrow keys arrive in the app's own
	 * keyboard handler or are forwarded out of this frame by `frame-gestures.ts`, and
	 * neither of those can await a promise this function returned. One deck per board, so
	 * one global is the whole of the addressing needed.
	 */
	async function mountSlides(element) {
		const file = element.getAttribute("data-slides");
		if (!file) return;
		try {
			const [slides, response] = await Promise.all([needModule("slides.js"), fetch(new URL(file, location.href))]);
			if (!response.ok) throw new Error(`${response.status}`);
			const source = await response.text();
			const deck = slides.mountDeck(element, source, {
				/*
				 * How a slide's body becomes a slide, and it differs by format.
				 *
				 * A markdown deck goes through the board's own renderer, so a slide gets the
				 * same marked, KaTeX and mermaid a `[data-md]` component does — one renderer,
				 * not two. A reveal HTML deck is *already* markup: it is inserted as-is and
				 * then offered to KaTeX, which is the only enhancement that makes sense on
				 * hand-written HTML. Running it through marked instead would have been the
				 * tempting one line, and it mangles a deck the moment a `<section>` indents
				 * its contents four spaces — which reveal's own examples do.
				 */
				render: slides.isHtmlDeck(file)
					? async (into, markup) => {
							into.innerHTML = markup;
							await renderMath(into);
							await highlightCode(into);
						}
					: (into, markdown) => renderMarkdown(into, markdown),
			});
			window.__deck = deck;
			/*
			 * Re-fit on resize, because a board is dragged and a fullscreen overlay is a
			 * different size again. Cheap: it sets one custom property and two pixel
			 * widths, and it is the only thing that has to happen when the box changes.
			 */
			new ResizeObserver(() => deck.fit()).observe(element);
		} catch (error) {
			element.textContent = `Cannot read ${file}: ${(error && error.message) || "unknown error"}`;
			element.classList.add("embed-missing");
		}
	}

	async function mountLive(host) {
		try {
			const module = await needModule("live-chat.js");
			module.mountLiveChat(host, { markdown: renderMarkdown });
		} catch (error) {
			host.textContent = `Cannot show this conversation: ${error.message}`;
			host.dataset.state = "broken";
		}
	}

	/** The status card for the user's shared Chrome — `lib/live-web.js`, fed by the app. */
	async function mountLiveWeb(host) {
		try {
			const module = await needModule("live-web.js");
			module.mountLiveWeb(host);
		} catch (error) {
			host.textContent = `Cannot show the shared browser: ${error.message}`;
			host.dataset.state = "broken";
		}
	}

	// --- go ----------------------------------------------------------------------

	async function start() {
		const meta = readMeta();
		applyMeta(meta);

		const work = [];

		for (const element of document.querySelectorAll("[data-md], [data-mermaid]")) {
			work.push(drawSource(element));
		}
		for (const element of document.querySelectorAll("[data-embed]")) {
			work.push(mountEmbed(element));
		}
		/*
		 * Live components, which are not documents.
		 *
		 * A `[data-live]` box draws itself from something the app is holding rather than
		 * from anything in the file — a conversation, today. Loaded on demand like every
		 * other renderer here, so a board without one never fetches it.
		 */
		for (const element of document.querySelectorAll('[data-live="chat"]')) {
			work.push(mountLive(element));
		}
		for (const element of document.querySelectorAll('[data-live="web"]')) {
			work.push(mountLiveWeb(element));
		}
		/*
		 * A slide deck, which is neither a document nor live.
		 *
		 * `[data-slides]` names a deck file — reveal's HTML, or its markdown plugin's
		 * dialect. The view is
		 * `slides.js`, loaded on demand like every other renderer here — so a deck costs a
		 * board that is not one exactly nothing.
		 */
		for (const element of document.querySelectorAll("[data-slides]")) {
			work.push(mountSlides(element));
		}
		/*
		 * Maths in a flow board's own markup.
		 *
		 * A `[data-md]` component gets KaTeX because the markdown renderer runs it over what
		 * it rendered. A flow board written as HTML has no such moment — the prose is in the
		 * file — so `$…$` sat there as three characters. Offered to the whole document rather
		 * than per component because a flow board *is* one document, and `renderMath` looks
		 * for a delimiter before loading anything, so a board with no maths pays nothing.
		 */
		if (document.body.classList.contains("flow")) {
			work.push(renderMath(document.body));
		}

		await Promise.allSettled(work);

		/*
		 * Code the *file* carries, which no renderer above has seen.
		 *
		 * Everything the runtime drew has already been coloured by whatever drew it, and this
		 * pass finds what is left: a `<pre>` an agent typed into a board, and a flow board's own
		 * prose. Last, so a block inside a panel that was rendered has been claimed already and
		 * is not looked at twice.
		 */
		await highlightCode(document.body);

		// Fonts last: text laid out in a fallback face and then reflowed is the
		// other half of a screenshot taken too early.
		try {
			await document.fonts?.ready;
		} catch {
			/* not fatal */
		}

		/*
		 * What the app is allowed to ask of a mounted board.
		 *
		 * `mount` re-mounts an embed whose `data-embed` changed, `source` hands back the
		 * words a rendered component was written from, and `redraw` draws it again from
		 * words the user has just typed. `markdown` is here for a caller that has prose
		 * and an element and no component to go with them.
		 */
		window.__board = { meta, mount: mountEmbed, markdown: renderMarkdown, source: sourceOf, redraw };
		window.__boardReady = true;
		document.body.dataset.ready = "true";
		document.dispatchEvent(new CustomEvent("board:ready", { detail: { meta } }));
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start());
	else void start();
})();
