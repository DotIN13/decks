/**
 * A slide deck, in either of reveal's two formats.
 *
 * Reveal's *format*, not reveal's runtime. What a deck view needs is: split the file, render
 * a slide, scale it to the box, and page through. That is this file. What reveal adds on top
 * — transitions, fragments, auto-animate, PDF export — costs about a megabyte and brings its
 * own keyboard layer, its own fullscreen and its own CSS reset, each of which would have to
 * be contained so it did not fight the canvas. The three renderers a slide actually needs
 * (marked, KaTeX, mermaid) are already vendored here for boards.
 *
 * ### Two formats, and HTML is the native one
 *
 * **`.slides.html` is what reveal actually is**: `<section>` elements, one per slide, nested
 * for a vertical stack. Markdown is a *plugin* in reveal — `plugin/markdown`, powered by
 * marked — so a `.slides.md` is that plugin's dialect: `---` between slides, `Note:` for
 * speaker notes. This file reads both and picks its splitter from the file's own extension,
 * which is the only place the format is ever declared.
 *
 * Keeping reveal's formats rather than inventing one is the portability: a deck written for
 * this view opens in reveal unchanged if you ever want the transitions.
 *
 * **A `<script>` in an HTML deck does not run.** The slides are inserted with `innerHTML`,
 * which never executes script elements — so a deck that carries its own
 * `Reveal.initialize()` is inert here rather than fighting this view for the keyboard, and a
 * deck from somewhere else cannot run code in the board's origin. The cost is the honest
 * one: a deck whose slides *depend* on reveal's JavaScript shows all its fragments at once.
 *
 * ### The one rule that matters
 *
 * A slide is laid out at a **fixed logical size** — 960×540 — and CSS-scaled to whatever box
 * it is in. Never reflowed. That is the whole difference between a slide and a document: if
 * the line breaks move when you present it, you did not arrange anything. It also means the
 * contact sheet is the same slides at a smaller scale rather than a second rendering that
 * could disagree with the first.
 */

/** The logical size a slide is authored at, before scaling. 16:9 unless the deck says so. */
const LOGICAL_W = 960;

/**
 * Whether a deck file is HTML — reveal's native format — rather than the markdown plugin's.
 *
 * The extension is the whole declaration (`deck/kinds.ts` says the same thing server-side),
 * so this takes the path the shell wrote into `data-slides` and nothing else. A query string
 * is expected: the shell asks for `talk.slides.html?raw=1`, because the shell is served at
 * the board's own URL and a bare reference would fetch the wrapper.
 */
export function isHtmlDeck(file) {
	return /\.slides\.html?(?:$|[?#])/i.test(String(file ?? ""));
}

/**
 * Split a deck file into front-matter and slides.
 *
 * `---` on a line of its own separates slides, which is reveal's rule and also YAML's
 * front-matter fence — so the fence has to be consumed first or the deck opens with an empty
 * slide made of its own metadata.
 *
 * `--` (reveal's vertical separator) is deliberately *not* a separator here. ← → is one
 * dimension, a contact sheet is a grid of a sequence, and a deck that branches has no honest
 * thumbnail; a vertical stack becomes consecutive slides instead.
 */
export function splitDeck(source) {
	const text = String(source ?? "").replace(/\r\n/g, "\n");
	const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
	const meta = {};
	if (front) {
		for (const line of (front[1] || "").split("\n")) {
			const pair = /^([a-z_]+)\s*:\s*(.+?)\s*$/i.exec(line);
			if (pair) meta[pair[1]] = (pair[2] || "").replace(/^["']|["']$/g, "");
		}
	}
	const body = front ? text.slice(front[0].length) : text;
	const slides = body
		.split(/^---[ \t]*$/m)
		.map((chunk) => chunk.replace(/^\n+|\n+$/g, ""))
		// A trailing `---` is a habit, not an empty slide; so is a leading one.
		.filter((chunk) => chunk.length > 0);
	return { meta, slides: slides.length > 0 ? slides : [""] };
}

/**
 * Split a reveal HTML deck into its slides.
 *
 * The native format: `<section>` elements inside `.reveal > .slides`, or — for a fragment of
 * a file rather than a whole page — the top-level sections of the body. Both are accepted
 * because both are things people have on disk, and telling them apart costs one query.
 *
 * **A nested stack becomes consecutive slides**, which is the same decision `--` gets in the
 * markdown dialect and for the same reason: `←` `→` is one dimension, a contact sheet is a
 * grid of a sequence, and a deck that branches has no honest thumbnail. Reveal's own default
 * for an external markdown file is to have no vertical separator either, so the two formats
 * agree here.
 *
 * Speaker notes are `<aside class="notes">`, reveal's own element, taken out of the slide the
 * way `Note:` is taken out of a markdown one.
 *
 * Parsed with `DOMParser` rather than a regex, because nested sections and an aside inside
 * one are structure rather than text — this is the one place in the runtime where getting it
 * wrong silently loses somebody's slide.
 */
export function splitHtmlDeck(source) {
	const text = String(source ?? "");
	const doc = new DOMParser().parseFromString(text, "text/html");
	const root = doc.querySelector(".reveal .slides") ?? doc.body;
	const sections = [...root.children].filter((el) => el.tagName === "SECTION");
	const flat = [];
	for (const section of sections) {
		const nested = [...section.children].filter((el) => el.tagName === "SECTION");
		for (const slide of nested.length > 0 ? nested : [section]) flat.push(slide);
	}
	const meta = {};
	const titled = doc.querySelector("title");
	if (titled?.textContent?.trim()) meta.title = titled.textContent.trim();
	/*
	 * A file with no `<section>` in it at all is one slide of whatever it holds, rather than
	 * an empty deck. Somebody saving a single slide out of a deck is the case, and a board
	 * that renders nothing is indistinguishable from a broken one.
	 */
	if (flat.length === 0) return { meta, slides: [text.trim() ? bodyOf(doc) : ""] };
	return { meta, slides: flat.map((el) => el.innerHTML) };
}

/** The body's own markup, for a deck file that turned out not to have sections. */
function bodyOf(doc) {
	return doc.body ? doc.body.innerHTML : "";
}

/**
 * A slide's markdown and its speaker notes, separated.
 *
 * `notes?:` at the start of a line, to the end of the slide, case-insensitively — which is
 * reveal's own default for `data-separator-notes` and matches `Note:`, `Notes:` and `note:`
 * alike. It was `^Note:` exactly, so a deck written with the plural had its notes rendered
 * as body text on the slide. Parsed and kept rather than dropped, so that the day a
 * presenter view exists the content is already in the file; hidden by CSS until then.
 */
export function splitNote(slide) {
	const at = /^notes?:[ \t]*/im.exec(slide);
	if (!at) return { body: slide, note: "" };
	return { body: slide.slice(0, at.index).replace(/\n+$/, ""), note: slide.slice(at.index + at[0].length).trim() };
}

/**
 * The same, for a slide of HTML: reveal's own `<aside class="notes">`.
 *
 * Returned as text rather than markup because that is all the note is used for today — it is
 * kept in the DOM and hidden, against the day there is a presenter view — and text cannot
 * carry an unclosed tag into the slide it was taken out of.
 */
export function splitHtmlNote(slide) {
	const html = String(slide ?? "");
	if (!/<aside[^>]*\bnotes\b/i.test(html)) return { body: html, note: "" };
	const holder = document.createElement("div");
	holder.innerHTML = html;
	const notes = [...holder.querySelectorAll("aside.notes")];
	const note = notes.map((el) => (el.textContent ?? "").trim()).filter(Boolean).join("\n\n");
	for (const el of notes) el.remove();
	return { body: holder.innerHTML, note };
}

/** `"4:3"` → the logical height for a 960-wide slide. Anything unreadable is 16:9. */
export function logicalSize(aspect) {
	const parts = String(aspect ?? "16:9").split(":").map(Number);
	const w = parts[0];
	const h = parts[1];
	const ratio = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? h / w : 9 / 16;
	return { w: LOGICAL_W, h: Math.round(LOGICAL_W * ratio) };
}

/**
 * How many columns a contact sheet of `count` slides should have in a box of this shape.
 *
 * Chosen to fill the box rather than fixed, because a deck board can be dragged to any
 * width: the aim is the largest thumbnail that still fits every slide, which is the smallest
 * column count whose rows also fit. Falls back to something sane rather than looping
 * forever when the box is absurd.
 */
export function sheetColumns(count, box, slide) {
	if (count <= 1) return 1;
	const ratio = slide.h / slide.w;
	for (let columns = 1; columns <= count; columns++) {
		const rows = Math.ceil(count / columns);
		const cell = box.w / columns;
		if (cell * ratio * rows <= box.h) return columns;
	}
	return Math.ceil(Math.sqrt(count));
}

/**
 * Mount a deck into a `.deck` component.
 *
 * `board.js` calls this when it sees `data-slides`, hands it a way to render one slide's
 * body — its own, so a markdown slide gets the same marked + KaTeX + mermaid a `[data-md]`
 * component does — and gets back a handle the app drives with the arrow keys.
 *
 * **The format comes from the filename**, which is already in `data-slides` and is the only
 * place a format is ever declared. So this reads it off the host rather than being told
 * twice, and `board.js` reads the same attribute to decide which renderer to pass.
 *
 * Everything about *which* slide is showing lives here and nowhere else: the number is view
 * state, not deck content, so paging a deck writes nothing and leaves no revision. A reload
 * opens on slide one, which is the honest consequence of that choice and the right trade —
 * the alternative makes your git history a log of you presenting.
 */
export function mountDeck(host, source, options) {
	const html = isHtmlDeck(host.getAttribute("data-slides"));
	const { meta, slides } = html ? splitHtmlDeck(source) : splitDeck(source);
	const logical = logicalSize(host.dataset.aspect || meta.aspect);
	const render = options.render;
	const onChange = options.onChange || (() => {});

	host.textContent = "";
	host.style.setProperty("--slide-w", `${logical.w}px`);
	host.style.setProperty("--slide-h", `${logical.h}px`);

	const stage = document.createElement("div");
	stage.className = "deck-stage";
	host.appendChild(stage);

	const sheet = document.createElement("div");
	sheet.className = "deck-sheet";
	sheet.hidden = true;
	host.appendChild(sheet);

	const count = document.createElement("div");
	count.className = "deck-count";
	host.appendChild(count);

	const step = (direction, glyph) => {
		const button = document.createElement("button");
		button.className = `deck-step ${direction}`;
		button.type = "button";
		button.textContent = glyph;
		button.setAttribute("aria-label", direction === "prev" ? "Previous slide" : "Next slide");
		// The click must not also reach the canvas as a board click; the canvas reads
		// pointerdown, so stopping it here is what keeps a page-turn from being a selection.
		button.addEventListener("pointerdown", (event) => event.stopPropagation());
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			go(at + (direction === "prev" ? -1 : 1));
		});
		host.appendChild(button);
		return button;
	};
	const back = step("prev", "‹");
	const forward = step("next", "›");

	/**
	 * One slide, rendered into a box of its own.
	 *
	 * Rendered lazily and kept: a deck of forty slides should not render forty on open, and
	 * a slide you have already seen should not re-render when you page back to it — a
	 * mermaid diagram takes long enough that re-rendering it is visible.
	 */
	const drawn = new Map();
	/**
	 * `where` is passed rather than inferred from `into`, and that is the bug this replaces.
	 *
	 * The key used to be read off the container — `into === sheet ? "sheet" : "stage"` — but
	 * a contact-sheet slide is appended to its *cell*, never to the sheet itself. So every
	 * thumbnail was filed under the stage's key: building the sheet handed back the elements
	 * already standing on the stage (those cells came out empty) and moved the rest into
	 * cells (those slides came out blank on the stage, paging forwards or back). One deck
	 * looked at zoomed out and then zoomed into was mostly empty rectangles.
	 */
	const slideEl = (index, into, where) => {
		const key = `${index}:${where}`;
		if (drawn.has(key)) return drawn.get(key);
		const el = document.createElement("div");
		el.className = "slide";
		const { body, note } = html ? splitHtmlNote(slides[index] || "") : splitNote(slides[index] || "");
		into.appendChild(el);
		void render(el, body).then(() => {
			if (!note) return;
			const held = document.createElement("div");
			held.className = "slide-note";
			held.textContent = note;
			el.appendChild(held);
		});
		drawn.set(key, el);
		return el;
	};

	let at = 0;
	let mode = "stage";

	/** Scale the current slide to the box it is in. The only place `--fit` is set. */
	const fit = () => {
		const box = { w: host.clientWidth, h: host.clientHeight };
		if (mode === "sheet") {
			const columns = sheetColumns(slides.length, box, logical);
			sheet.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
			// A cell's own width decides the scale of the slide inside it; the gap and the
			// padding are already in `box` because `clientWidth` is the padded box.
			const cell = (box.w - 20 - (columns - 1) * 8) / columns;
			sheet.style.setProperty("--fit", String(Math.max(0.02, cell / logical.w)));
			for (const cellEl of sheet.querySelectorAll(".sheet-cell")) {
				cellEl.style.height = `${Math.round(cell * (logical.h / logical.w))}px`;
			}
			return;
		}
		const scale = Math.min(box.w / logical.w, box.h / logical.h);
		stage.style.width = `${Math.round(logical.w * scale)}px`;
		stage.style.height = `${Math.round(logical.h * scale)}px`;
		stage.style.setProperty("--fit", String(scale));
	};

	function go(next) {
		const clamped = Math.max(0, Math.min(slides.length - 1, next));
		at = clamped;
		for (const el of stage.querySelectorAll(".slide")) el.hidden = true;
		const showing = slideEl(at, stage, "stage");
		showing.hidden = false;
		count.textContent = `${at + 1} / ${slides.length}`;
		back.disabled = at === 0;
		forward.disabled = at === slides.length - 1;
		for (const [index, cellEl] of [...sheet.querySelectorAll(".sheet-cell")].entries()) {
			cellEl.dataset.on = String(index === at);
		}
		fit();
		onChange(at, slides.length);
	}

	/**
	 * The contact sheet, built once and only when first asked for.
	 *
	 * Which is the point of doing it lazily: a deck that is never zoomed out never renders
	 * its slides twice, and a canvas of ten decks does not render a hundred slides on load.
	 */
	const buildSheet = () => {
		if (sheet.childElementCount > 0) return;
		for (let index = 0; index < slides.length; index++) {
			const cell = document.createElement("div");
			cell.className = "sheet-cell";
			cell.dataset.on = String(index === at);
			sheet.appendChild(cell);
			slideEl(index, cell, "sheet");
		}
	};

	// Open on the first slide. Everything above is machinery; this is the line that makes a
	// deck a deck rather than an empty rectangle with two arrows on it.
	go(0);

	return {
		total: slides.length,
		current: () => at,
		go,
		next: () => go(at + 1),
		prev: () => go(at - 1),
		first: () => go(0),
		last: () => go(slides.length - 1),
		fit,
		/**
		 * Swap between the slide and the contact sheet.
		 *
		 * Driven from outside because the *canvas* knows the zoom and the board does not —
		 * a board inside a scaled frame cannot tell how large it is being drawn.
		 */
		setMode: (wanted) => {
			if (wanted === mode) return;
			mode = wanted === "sheet" ? "sheet" : "stage";
			if (mode === "sheet") buildSheet();
			sheet.hidden = mode !== "sheet";
			stage.hidden = mode === "sheet";
			for (const el of [back, forward, count]) el.hidden = mode === "sheet";
			fit();
		},
	};
}
