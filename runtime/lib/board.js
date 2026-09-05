/*
 * The board runtime: what turns a file of absolutely-positioned divs into a board.
 *
 * A board's head asks for exactly two things — `board.css` and this file. Anything
 * else it needs (markdown, maths, diagrams, PDFs) is fetched from the same `lib/`
 * directory the moment a component actually uses it, so a board of three stickies
 * does not pay for pdf.js and the agent does not have to remember which script
 * tag goes with which component.
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
		target.innerHTML = marked.parse(dedent(source), { gfm: true, breaks: false });
		await renderMath(target);
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
		}
		return `${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`;
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
				// textContent: this is somebody else's file, and it is text.
				pre.textContent = text;
				body.appendChild(pre);
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

		await Promise.allSettled(work);

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
