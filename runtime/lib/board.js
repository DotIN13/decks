/*
 * The board runtime: what turns a file of absolutely-positioned divs into a board.
 *
 * A board's head asks for exactly two things — `board.css` and this file. Anything
 * else it needs (markdown, maths, diagrams, PDFs) is fetched from the same `lib/`
 * directory the moment a component actually uses it, so a board of three stickies
 * does not pay for pdf.js and the agent does not have to remember which script
 * tag goes with which component.
 *
 * It also owns the readiness flag. Every async mount is awaited, then
 * `window.__boardReady` goes true — which is what the app waits for before it
 * measures a board, and what the agent's Playwright waits for before it takes a
 * picture. Without it a screenshot is a race, and the race is usually lost.
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

		try {
			if (["md", "markdown", "mdx", "txt", "text"].includes(extension)) {
				const { body, note } = chrome(host, "md", label);
				const response = await fetch(url);
				if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
				const text = await response.text();
				if (extension === "txt" || extension === "text") {
					const pre = document.createElement("pre");
					pre.textContent = text;
					body.appendChild(pre);
				} else {
					await renderMarkdown(body, text);
				}
				note.textContent = `${text.split("\n").length} lines`;
				return;
			}

			if (extension === "pdf") {
				const { body, note } = chrome(host, "pdf", label, "loading…");
				const pages = await renderPdf(body, url, host.dataset.pages, host.clientWidth - 2);
				note.textContent = host.dataset.pages ? `pages ${host.dataset.pages} of ${pages}` : pages;
				return;
			}

			if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(extension)) {
				const { body } = chrome(host, "image", label);
				const img = document.createElement("img");
				img.src = url;
				img.alt = label;
				body.appendChild(img);
				return;
			}

			if (["html", "htm", "xhtml"].includes(extension)) {
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
				return;
			}

			// Something else: say what it is and how big, rather than showing a blank.
			const { body, note } = chrome(host, "file", label);
			let size;
			try {
				const head = await fetch(url, { method: "HEAD" });
				if (!head.ok) throw new Error(`${head.status}`);
				const length = Number(head.headers.get("content-length"));
				if (Number.isFinite(length) && length > 0) size = length;
			} catch {
				/* the card is worth showing even when the size is not known */
			}
			const link = document.createElement("a");
			link.href = url;
			link.target = "_blank";
			link.rel = "noreferrer";
			link.textContent = label;
			const meta = document.createElement("span");
			meta.textContent = size ? `${(size / 1024).toFixed(0)} KB` : extension ? `.${extension}` : "file";
			body.append(link, meta);
			note.textContent = "open";
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

	// --- connectors --------------------------------------------------------------

	/**
	 * Draw every `svg.link[data-from][data-to]` between the two components it names.
	 *
	 * Positions are read from the live layout rather than computed from the style
	 * attributes, so a component whose height came from its own content — a card
	 * that grew a line of text — still gets an arrow that touches it.
	 */
	function drawLinks() {
		const board = document.body;
		for (const svg of document.querySelectorAll("svg.link")) {
			const from = document.querySelector(`[data-id="${cssEscape(svg.dataset.from ?? "")}"]`);
			const to = document.querySelector(`[data-id="${cssEscape(svg.dataset.to ?? "")}"]`);
			svg.innerHTML = "";
			if (!from || !to || from === svg || to === svg) continue;

			const a = box(from, board);
			const b = box(to, board);
			const [start, end] = nearestSides(a, b);
			const bend = Math.max(24, Math.abs(end.x - start.x) / 2);
			const horizontal = start.side === "left" || start.side === "right";
			const c1 = horizontal ? { x: start.x + (start.side === "right" ? bend : -bend), y: start.y } : { x: start.x, y: start.y + (start.side === "bottom" ? bend : -bend) };
			const c2 = horizontal ? { x: end.x + (end.side === "right" ? bend : -bend), y: end.y } : { x: end.x, y: end.y + (end.side === "bottom" ? bend : -bend) };

			const ns = "http://www.w3.org/2000/svg";
			const marker = document.createElementNS(ns, "marker");
			const markerId = `arrow-${Math.random().toString(36).slice(2, 8)}`;
			marker.setAttribute("id", markerId);
			marker.setAttribute("viewBox", "0 0 10 10");
			marker.setAttribute("refX", "9");
			marker.setAttribute("refY", "5");
			marker.setAttribute("markerWidth", "6");
			marker.setAttribute("markerHeight", "6");
			marker.setAttribute("orient", "auto-start-reverse");
			const head = document.createElementNS(ns, "path");
			head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
			head.setAttribute("fill", "currentColor");
			marker.appendChild(head);
			const defs = document.createElementNS(ns, "defs");
			defs.appendChild(marker);

			const path = document.createElementNS(ns, "path");
			path.setAttribute("d", `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`);
			path.setAttribute("marker-end", `url(#${markerId})`);
			// `currentColor` on the head, so an arrow tinted by CSS keeps its point.
			path.style.color = getComputedStyle(path).stroke;

			svg.append(defs, path);

			const label = svg.dataset.label;
			if (label) {
				const text = document.createElementNS(ns, "text");
				text.setAttribute("x", String((start.x + end.x) / 2));
				text.setAttribute("y", String((start.y + end.y) / 2 - 6));
				text.setAttribute("text-anchor", "middle");
				text.textContent = label;
				svg.appendChild(text);
			}
		}
	}

	function cssEscape(value) {
		return window.CSS?.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
	}

	function box(element, board) {
		const rect = element.getBoundingClientRect();
		const origin = board.getBoundingClientRect();
		return {
			left: rect.left - origin.left,
			top: rect.top - origin.top,
			width: rect.width,
			height: rect.height,
			cx: rect.left - origin.left + rect.width / 2,
			cy: rect.top - origin.top + rect.height / 2,
		};
	}

	/** The pair of sides that face each other, so the line takes the short way. */
	function nearestSides(a, b) {
		const dx = b.cx - a.cx;
		const dy = b.cy - a.cy;
		if (Math.abs(dx) >= Math.abs(dy)) {
			return dx >= 0
				? [{ x: a.left + a.width, y: a.cy, side: "right" }, { x: b.left, y: b.cy, side: "left" }]
				: [{ x: a.left, y: a.cy, side: "left" }, { x: b.left + b.width, y: b.cy, side: "right" }];
		}
		return dy >= 0
			? [{ x: a.cx, y: a.top + a.height, side: "bottom" }, { x: b.cx, y: b.top, side: "top" }]
			: [{ x: a.cx, y: a.top, side: "top" }, { x: b.cx, y: b.top + b.height, side: "bottom" }];
	}

	// --- go ----------------------------------------------------------------------

	async function start() {
		const meta = readMeta();
		applyMeta(meta);

		const work = [];

		for (const element of document.querySelectorAll("[data-md]")) {
			work.push(renderMarkdown(element, element.textContent ?? "").catch((error) => console.warn("[board] markdown:", error)));
		}
		for (const element of document.querySelectorAll("[data-mermaid]")) {
			const source = element.textContent ?? "";
			work.push(renderMermaid(element, source).catch((error) => {
				element.textContent = `mermaid: ${error instanceof Error ? error.message : String(error)}`;
				console.warn("[board] mermaid:", error);
			}));
		}
		for (const element of document.querySelectorAll("[data-embed]")) {
			work.push(mountEmbed(element));
		}

		await Promise.allSettled(work);
		drawLinks();

		// Fonts last: text laid out in a fallback face and then reflowed is the
		// other half of a screenshot taken too early.
		try {
			await document.fonts?.ready;
		} catch {
			/* not fatal */
		}
		drawLinks();

		window.__board = { meta, redraw: drawLinks, mount: mountEmbed, markdown: renderMarkdown };
		window.__boardReady = true;
		document.body.dataset.ready = "true";
		document.dispatchEvent(new CustomEvent("board:ready", { detail: { meta } }));
	}

	// Redraw connectors when the layout moves under them — a resized frame, a
	// component the editor just dragged, an embed that finished loading tall.
	const observer = new ResizeObserver(() => drawLinks());
	addEventListener("load", () => observer.observe(document.body));
	addEventListener("resize", () => drawLinks());

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start());
	else void start();
})();
