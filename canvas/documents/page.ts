import type { DocClientMessage, DocServerMessage, DocVersion, Splice } from "./model.ts";
import { DocSync } from "./client.ts";
import { spliceDiff } from "./merge.ts";
import type { DocSync as Sync } from "./client.ts";
import { docxBlocks, readParagraph } from "./blocks.ts";
import { findMarks, marksOf, segments, shiftMarks, spliceBetween, type Mark } from "./marks.ts";
import { LiveEditor, type BlockStyle, type FormatState, type InlineStyle } from "./live.ts";
import { Reading } from "./reading.ts";
import { GoogleView } from "./gview.ts";
import type { DocsRequest } from "./google/types.ts";
import { STYLE } from "./page/style.ts";
import { base, clip, dir, el, keyName, svg, when } from "./page/parts.ts";
import { PdfPane } from "./page/pdf.ts";
import { Remotes } from "./page/remote.ts";
import { buildPage } from "./page/dom.ts";

/**
 * `canvas/documents/page.ts`: a document drawn as a page you type into, in plain DOM.
 *
 * Markdown and LaTeX are typed into as they read (`live.ts`): the file's own characters, styled,
 * with their syntax hidden until the caret reaches it, and a toolbar of the usual styles. A Word
 * file is drawn by docx-preview and a paragraph is typed into in place (`reading.ts`). Source shows
 * the file as it is, for anything the page does not draw.
 *
 * Every edit reaches the file within a frame, where the file is: its history and the changes
 * waiting for review are kept apart, in the deck's `docs/`. What other writers do (an agent with its own tools, any program)
 * arrives the same way and is highlighted on the words it touched until it is accepted or
 * rejected, one at a time from the highlight or the Changes panel, or all at once. History shows
 * any kept version as it read, with what differs from now highlighted, and restores it.
 *
 * It needs a way to send a message and a way to hear one, and nothing else: in Decks that is the
 * app's socket, relayed into the board by `postMessage`.
 */

export interface DocPageOptions {
	path: string;
	send(message: DocClientMessage): void;
	/** Call `listener` with every message from the server; answers what stops it. */
	listen(listener: (message: DocServerMessage) => void): () => void;
	/** Draw markdown into an element; without it a markdown page reads as its plain source. */
	markdown?(into: HTMLElement, source: string): Promise<void> | void;
	/** Set the maths in an element, for LaTeX and markdown pages (KaTeX's auto-render). */
	math?(into: HTMLElement): Promise<void> | void;
	/** The bytes of a file by the path the server calls it: a Word page is drawn from the whole `.docx`, a picture from its file. */
	file?(path: string): Promise<ArrayBuffer>;
	/** Draw a PDF's pages into an element at a width, answering how many there were: a LaTeX page's preview. */
	pdf?(into: HTMLElement, bytes: ArrayBuffer, width: number): Promise<number>;
	/** The server's API (`/api`, or under a connection's prefix), for a Google Doc's sign-in. */
	api?: string;
}

export interface DocPage {
	sync: DocSync;
	destroy(): void;
}


/** A comment on a Google Doc, as Drive answers it. */
interface GComment {
	id: string;
	content: string;
	author?: { displayName?: string; me?: boolean };
	createdTime?: string;
	quotedFileContent?: { value?: string };
	replies?: Array<{ id: string; content?: string; author?: { displayName?: string }; createdTime?: string }>;
}


export function mountDocPage(host: HTMLElement, options: DocPageOptions): DocPage {
	if (!document.getElementById("dp-style")) document.head.append(el("style", { id: "dp-style" }, STYLE));
	host.classList.add("dp");
	host.replaceChildren();
	const { name, status, iconButton, sourceButton, historyButton, pdfButton, changesButton, commentsButton, gitBox, gitButton, gitMenu, googleBox, googleButton, googleMenu, tools, main, scroll, text, panel, banner, old, pill, divider, pdfPane, pdfBar, pdfState, errButton, errList, pdfBody } = buildPage(host, options);

	let marks: Mark[] = [];
	let composing = false;
	let view: "none" | "changes" | "history" | "comments" = "none";
	/** A Google Doc's open comments, from Drive, or why they cannot be shown. */
	let comments: GComment[] = [];
	let commentsError = "";
	let versions: DocVersion[] = [];
	/** The kept version being looked at, instead of the page as it is now. */
	let viewing: { sha: string; at?: number; text: string; editor?: LiveEditor } | undefined;
	/** The History row last pressed: one text kept twice has one id, so the row says which time is meant. */
	let picked: { sha: string; at: number } | undefined;
	let mode: "page" | "source" = "page";
	const urls = new Map<string, Promise<string | undefined>>();
	const pictures = new Map<string, Promise<string | undefined>>();
	const near = (src: string) => (src.startsWith("/") ? src : `${dir(sync.path)}/${decodeURI(src)}`);

	const sync = new DocSync({
		path: options.path,
		send: options.send,
		onUpdate: (_sync, why, applied) => updated(why, applied),
	});
	const recent = () => sync.changes;
	const live = new LiveEditor(sync, {
		...(options.math ? { math: options.math } : {}),
		asset: (src) => {
			if (!options.file) return Promise.resolve(undefined);
			const from = dir(sync.path);
			const path = src.startsWith("/") ? src : `${from}/${decodeURI(src)}`;
			let url = urls.get(path);
			if (!url) {
				url = options
					.file(path)
					.then((bytes) => URL.createObjectURL(new Blob([bytes])))
					.catch(() => undefined);
				urls.set(path, url);
			}
			return url;
		},
		pdfPicture: (src) => {
			if (!options.file || !options.pdf) return Promise.resolve(undefined);
			const path = near(src);
			let url = pictures.get(path);
			if (!url) {
				const into = document.createElement("div");
				url = options
					.file(path)
					.then((bytes) => options.pdf!(into, bytes, 1200))
					.then(() => into.querySelector("img")?.src ?? into.querySelector("canvas")?.toDataURL("image/png"))
					.catch(() => undefined);
				pictures.set(path, url);
			}
			return url;
		},
		marks: () => marks,
		changes: recent,
		onState: (state) => pressed(state),
	});
	const reading = new Reading(sync, {
		...(options.markdown ? { markdown: options.markdown } : {}),
		...(options.math ? { math: options.math } : {}),
		...(options.file ? { file: options.file } : {}),
		marks: () => marks,
	});
	// A Google Doc, drawn from Google's own document as it lays it out (`gview.ts`); its styles go to Google once the typing before them has.
	const gview = new GoogleView(sync, {
		marks: () => marks,
		style: (requests) => sendStyle(requests),
		...(options.api ? { api: options.api } : {}),
		selection: () => gpressed(),
		command: (name) => (name === "link" ? askLink() : newComment()),
	});
	scroll.append(live.root, reading.root, gview.root, old);
	reading.root.hidden = true;
	gview.root.hidden = true;
	/**
	 * Styles for Google, each with the text the page had when it was made, sent in order once the
	 * typing before it has reached the server: the server brings the Doc to that text, applies the
	 * style, and only then what was typed after, so a list item made after a bullet is in the list.
	 */
	const styleQueue: Array<{ requests: DocsRequest[]; text: string; mark: number; hold?: number }> = [];
	/** A keystroke's style is held this long for the next keystroke to join, so a run of bold typing is one request to Google, not one a key. */
	const HOLD_MS = 400;
	let pumping: ReturnType<typeof setTimeout> | undefined;
	function sendStyle(requests: DocsRequest[]): void {
		// A keystroke's style that carries on the one before it, not yet sent, goes out as one request.
		const last = styleQueue[styleQueue.length - 1];
		const [a] = last?.requests ?? [];
		const [b] = requests;
		if (last?.requests.length === 1 && requests.length === 1 && a && b && "updateTextStyle" in a && "updateTextStyle" in b && a.updateTextStyle.range.endIndex === b.updateTextStyle.range.startIndex && JSON.stringify([a.updateTextStyle.textStyle, a.updateTextStyle.fields]) === JSON.stringify([b.updateTextStyle.textStyle, b.updateTextStyle.fields])) {
			last.requests = [{ updateTextStyle: { ...a.updateTextStyle, range: { startIndex: a.updateTextStyle.range.startIndex, endIndex: b.updateTextStyle.range.endIndex } } }];
			last.text = sync.text;
			last.mark = sync.mark();
			last.hold = Date.now() + HOLD_MS;
		} else styleQueue.push({ requests, text: sync.text, mark: sync.mark(), ...(requests.length === 1 && b && "updateTextStyle" in b ? { hold: Date.now() + HOLD_MS } : {}) });
		pump();
	}
	function pump(): void {
		clearTimeout(pumping);
		pumping = undefined;
		sync.flush();
		while (styleQueue.length && sync.landed(styleQueue[0]!.mark) && (styleQueue.length > 1 || (styleQueue[0]!.hold ?? 0) <= Date.now())) {
			const next = styleQueue.shift()!;
			options.send({ type: "doc.gstyle", path: sync.path, client: sync.client, requests: next.requests, text: next.text });
		}
		if (styleQueue.length) pumping = setTimeout(pump, 30);
	}

	const isGoogle = () => !!sync.remote;
	const isWord = () => sync.format === "docx";
	const isTex = () => /\.(tex|sty|cls|ltx)$/i.test(sync.path);

	// --- the styling tools -------------------------------------------------------------------

	const buttons = new Map<string, HTMLButtonElement>();
	// The paragraph style: a button naming it, and a menu drawing each style as it reads.
	const styleBox = el("div", { class: "dp-style" });
	const styleButton = el("button", { type: "button", class: "dp-btn", title: "Paragraph style", "aria-haspopup": "menu", "aria-expanded": "false" });
	const styleMenu = el("div", { class: "dp-menu", role: "menu", hidden: "" });
	styleBox.append(styleButton, styleMenu);
	let styles: Array<[string, string]> = [];
	let styleNow = "p";
	const styleLabel = () => {
		styleButton.innerHTML = "";
		styleButton.append(el("span", {}, styles.find(([v]) => v === styleNow)?.[1] ?? "Body"));
		styleButton.insertAdjacentHTML("beforeend", svg("chevron"));
	};
	const closeMenu = () => {
		styleMenu.hidden = true;
		styleButton.setAttribute("aria-expanded", "false");
	};
	styleButton.addEventListener("mousedown", (event) => event.preventDefault());
	styleButton.onclick = () => {
		const open = styleMenu.hidden;
		styleMenu.replaceChildren(
			...styles.map(([value, label]) => {
				const item = el("button", { type: "button", role: "menuitemradio", class: `m-${value}`, "aria-checked": String(value === styleNow) }, label);
				item.addEventListener("mousedown", (event) => event.preventDefault());
				item.onclick = () => {
					closeMenu();
					if (isGoogle()) gview.setParagraph({ namedStyleType: value }, "namedStyleType");
					else live.setBlock(value as BlockStyle);
				};
				return item;
			}),
		);
		styleMenu.hidden = !open;
		styleButton.setAttribute("aria-expanded", String(open));
	};
	document.addEventListener("mousedown", (event) => {
		if (!styleBox.contains(event.target as Node)) closeMenu();
	});
	function buildTools(): void {
		tools.replaceChildren();
		buttons.clear();
		if (isGoogle()) return buildGoogleTools();
		const tex = isTex();
		const button = (key: string, title: string, run: () => void, icon = key) => {
			const b = el("button", { type: "button", class: "dp-ib", title, "aria-label": title, "aria-pressed": "false" });
			b.innerHTML = svg(icon);
			// Pressing a tool keeps the caret where it is in the page.
			b.addEventListener("mousedown", (event) => event.preventDefault());
			b.addEventListener("click", () => run());
			buttons.set(key, b);
			group.append(b);
		};
		// Tools come in bordered groups, one per kind: marks, inline objects, blocks, inserts, history.
		let group = el("div", { class: "dp-group" });
		const sep = () => {
			if (group.childElementCount) tools.append(group);
			group = el("div", { class: "dp-group" });
		};
		styles = tex
			? [["p", "Body text"], ["h1", "Section"], ["h2", "Subsection"], ["h3", "Subsubsection"], ["h4", "Paragraph heading"]]
			: [["p", "Body text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["h4", "Heading 4"], ["h5", "Heading 5"], ["h6", "Heading 6"]];
		styleLabel();
		tools.append(styleBox);
		const inline = (key: InlineStyle, title: string) => button(key, title, () => live.toggle(key));
		inline("bold", `Bold (${keyName("Mod+B")})`);
		inline("italic", `Italic (${keyName("Mod+I")})`);
		inline("underline", `Underline (${keyName("Mod+U")})`);
		if (!tex) inline("strike", `Strikethrough (${keyName("Mod+Shift+X")})`);
		sep();
		inline("code", `Code (${keyName("Mod+E")})`);
		if (!tex) inline("mark", `Highlight (${keyName("Mod+Shift+H")})`);
		button("link", `Link (${keyName("Mod+K")})`, () => live.link());
		inline("math", `Inline maths (${keyName("Mod+Shift+M")})`);
		sep();
		button("ul", `Bulleted list (${keyName("Mod+Shift+8")})`, () => live.setBlock("ul"));
		if (!tex) {
			button("ol", `Numbered list (${keyName("Mod+Shift+7")})`, () => live.setBlock("ol"));
			button("task", "Task list", () => live.setBlock("task"));
			button("quote", "Quote", () => live.setBlock("quote"));
			button("codeblock", "Code block", () => live.setBlock("code"));
			sep();
			button("table", "Table", () => live.insertBlock("table"));
			button("hr", "Horizontal rule", () => live.insertBlock("hr"));
		} else {
			button("ol", "Numbered list", () => live.setBlock("ol"));
			button("display", "Equation", () => live.insertBlock("math"));
		}
		sep();
		button("undo", `Undo (${keyName("Mod+Z")})`, () => live.undo());
		button("redo", `Redo (${keyName("Mod+Shift+Z")})`, () => live.redo());
		sep();
	}

	// --- a Google Doc's own tools: what Google's toolbar has, sent to Google as Docs requests ---------

	const FONTS = ["Arial", "Roboto", "Times New Roman", "Georgia", "Lato", "Merriweather", "Montserrat", "Open Sans", "Playfair Display", "Source Sans 3", "Courier New", "Verdana", "Comic Sans MS"];
	const gcontrols: { font?: HTMLSelectElement; size?: HTMLInputElement } = {};

	function buildGoogleTools(): void {
		let group = el("div", { class: "dp-group" });
		const sep = () => {
			if (group.childElementCount) tools.append(group);
			group = el("div", { class: "dp-group" });
		};
		const button = (key: string, title: string, run: () => void, icon = key) => {
			const b = el("button", { type: "button", class: "dp-ib", title, "aria-label": title, "aria-pressed": "false" });
			b.innerHTML = svg(icon);
			b.addEventListener("mousedown", (event) => event.preventDefault());
			b.addEventListener("click", () => run());
			buttons.set(key, b);
			group.append(b);
			return b;
		};
		button("undo", `Undo (${keyName("Mod+Z")})`, () => gview.undo());
		button("redo", `Redo (${keyName("Mod+Shift+Z")})`, () => gview.redo());
		sep();
		styles = [["NORMAL_TEXT", "Normal text"], ["TITLE", "Title"], ["SUBTITLE", "Subtitle"], ["HEADING_1", "Heading 1"], ["HEADING_2", "Heading 2"], ["HEADING_3", "Heading 3"], ["HEADING_4", "Heading 4"]];
		styleNow = "NORMAL_TEXT";
		styleLabel();
		tools.append(styleBox);
		const font = el("select", { class: "dp-select", title: "Font", "aria-label": "Font" });
		for (const f of FONTS) font.append(el("option", { value: f, style: `font-family: "${f}"` }, f));
		font.onchange = () => {
			gview.setText("weightedFontFamily", { fontFamily: font.value });
			gview.focus();
		};
		gcontrols.font = font;
		group.append(font);
		sep();
		const size = el("input", { class: "dp-size", type: "text", inputmode: "numeric", title: "Font size", "aria-label": "Font size" });
		const setSize = (value: number) => {
			const v = Math.max(1, Math.min(400, Math.round(value)));
			size.value = String(v);
			gview.setText("fontSize", { magnitude: v, unit: "PT" });
		};
		button("smaller", "Decrease font size", () => setSize(Number(size.value || 11) - 1), "minus");
		group.append(size);
		button("bigger", "Increase font size", () => setSize(Number(size.value || 11) + 1), "plus");
		size.onchange = () => {
			setSize(Number(size.value) || 11);
			gview.focus();
		};
		gcontrols.size = size;
		sep();
		button("bold", `Bold (${keyName("Mod+B")})`, () => gview.toggle("bold"));
		button("italic", `Italic (${keyName("Mod+I")})`, () => gview.toggle("italic"));
		button("underline", `Underline (${keyName("Mod+U")})`, () => gview.toggle("underline"));
		button("strike", `Strikethrough (${keyName("Mod+Shift+X")})`, () => gview.toggle("strikethrough"));
		const colour = (key: string, title: string, field: "foregroundColor" | "backgroundColor") => {
			const input = el("input", { type: "color", class: "dp-colour", "aria-label": title, value: field === "foregroundColor" ? "#000000" : "#ffff00" });
			const b = button(key, title, () => input.click(), field === "foregroundColor" ? "textcolour" : "mark");
			b.append(input);
			input.onchange = () => {
				const hex = input.value;
				const c = (k: number) => Number.parseInt(hex.slice(k, k + 2), 16) / 255;
				gview.setText(field, { color: { rgbColor: { red: c(1), green: c(3), blue: c(5) } } });
				gview.focus();
			};
		};
		colour("colour", "Text colour", "foregroundColor");
		colour("highlight", "Highlight colour", "backgroundColor");
		sep();
		button("link", `Link (${keyName("Mod+K")})`, () => askLink());
		sep();
		const align = (key: string, title: string, value: string) => button(key, title, () => gview.setParagraph({ alignment: value }, "alignment"));
		align("alignleft", "Left align", "START");
		align("aligncenter", "Centre align", "CENTER");
		align("alignright", "Right align", "END");
		align("justify", "Justify", "JUSTIFIED");
		sep();
		button("ul", `Bulleted list (${keyName("Mod+Shift+8")})`, () => gview.list(false));
		button("ol", `Numbered list (${keyName("Mod+Shift+7")})`, () => gview.list(true));
		button("outdent", `Decrease indent (${keyName("Mod+[")})`, () => gview.indent(-1));
		button("indent", `Increase indent (${keyName("Mod+]")})`, () => gview.indent(1));
		sep();
		button("table", "Insert a table (3 by 3)", () => gview.table("insert"));
		// Rows and columns, for the cell the caret is in.
		button("rowabove", "Insert row above", () => gview.table("rowAbove"));
		button("rowbelow", "Insert row below", () => gview.table("rowBelow"));
		button("colleft", "Insert column left", () => gview.table("colLeft"));
		button("colright", "Insert column right", () => gview.table("colRight"));
		button("rowdelete", "Delete row", () => gview.table("deleteRow"));
		button("coldelete", "Delete column", () => gview.table("deleteCol"));
		sep();
		button("comment", "Comment on the selected words", () => newComment());
		button("clear", `Clear formatting (${keyName("Mod+\\")})`, () => gview.clearFormatting());
		sep();
		gpressed();
	}

	function askLink(): void {
		const url = window.prompt("Link to", "https://");
		if (url !== null) gview.link(url.trim() && url.trim() !== "https://" ? url.trim() : undefined);
		gview.focus();
	}

	function gpressed(): void {
		if (!isGoogle() || !gview.loaded) return;
		const state = gview.state();
		for (const key of ["bold", "italic", "underline", "strike"] as const) buttons.get(key)?.setAttribute("aria-pressed", String(state[key]));
		const align = { START: "alignleft", CENTER: "aligncenter", END: "alignright", JUSTIFIED: "justify" }[state.align] ?? "alignleft";
		for (const key of ["alignleft", "aligncenter", "alignright", "justify"]) buttons.get(key)?.setAttribute("aria-pressed", String(key === align));
		buttons.get("ul")?.setAttribute("aria-pressed", String(state.bullet));
		const inCell = !!gview.cellAt();
		for (const key of ["rowabove", "rowbelow", "colleft", "colright", "rowdelete", "coldelete"]) {
			const b = buttons.get(key);
			if (b) b.hidden = !inCell;
		}
		buttons.get("ol")?.setAttribute("aria-pressed", String(state.numbered));
		if (gcontrols.font && document.activeElement !== gcontrols.font) {
			if (![...gcontrols.font.options].some((o) => o.value === state.font)) gcontrols.font.append(el("option", { value: state.font }, state.font));
			gcontrols.font.value = state.font;
		}
		if (gcontrols.size && document.activeElement !== gcontrols.size) gcontrols.size.value = String(Math.round(state.size * 10) / 10);
		const type = state.type === "TITLE" || state.type === "SUBTITLE" || state.type.startsWith("HEADING_") ? state.type : "NORMAL_TEXT";
		if (type !== styleNow) {
			styleNow = type;
			if (!styles.some(([v]) => v === type)) styles.push([type, type.replace("HEADING_", "Heading ")]);
			styleLabel();
		}
	}

	function pressed(state: FormatState): void {
		for (const key of ["bold", "italic", "strike", "underline", "code", "mark", "link", "math"] as const) buttons.get(key)?.setAttribute("aria-pressed", String(state[key]));
		for (const key of ["ul", "ol", "task", "quote"] as const) buttons.get(key)?.setAttribute("aria-pressed", String(state.block === key));
		buttons.get("codeblock")?.setAttribute("aria-pressed", String(state.block === "code"));
		const block = /^h[1-6]$/.test(state.block) ? state.block : "p";
		if (styles.some(([v]) => v === block) && block !== styleNow) {
			styleNow = block;
			styleLabel();
		}
	}

	function setMode(next: typeof mode): void {
		if (viewing) closeVersion();
		mode = next;
		sourceButton.setAttribute("aria-pressed", String(mode === "source"));
		text.hidden = mode !== "source";
		const word = isWord();
		const google = isGoogle();
		live.root.hidden = mode !== "page" || word || google;
		reading.root.hidden = mode !== "page" || !word;
		gview.root.hidden = mode !== "page" || !google;
		tools.hidden = mode !== "page" || word || sync.readOnly || !sync.ready;
		if (mode === "source") draw(false);
		else if (word) reading.render();
		else if (google) gview.render();
		else live.render();
	}

	// --- Source: the file's text as it is -------------------------------------------------------

	function texts(): Text[] {
		const out: Text[] = [];
		const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
		return out;
	}

	function offsetOf(node: Node, offset: number): number {
		let total = 0;
		if (node.nodeType !== Node.TEXT_NODE) {
			const range = document.createRange();
			range.setStart(text, 0);
			range.setEnd(node, offset);
			return range.toString().length;
		}
		for (const t of texts()) {
			if (t === node) return total + offset;
			total += t.data.length;
		}
		return total;
	}

	function caret(): { start: number; end: number } | undefined {
		const selection = getSelection();
		if (!selection || selection.rangeCount === 0 || !text.contains(selection.anchorNode)) return undefined;
		return { start: offsetOf(selection.anchorNode!, selection.anchorOffset), end: offsetOf(selection.focusNode!, selection.focusOffset) };
	}

	function place(at: { start: number; end: number }): void {
		const find = (offset: number): [Node, number] => {
			let total = 0;
			const all = texts();
			for (const t of all) {
				if (offset <= total + t.data.length) return [t, offset - total];
				total += t.data.length;
			}
			const last = all.at(-1);
			return last ? [last, last.data.length] : [text, 0];
		};
		const [an, ao] = find(at.start);
		const [fn, fo] = find(at.end);
		getSelection()?.setBaseAndExtent(an, ao, fn, fo);
	}

	function draw(keepCaret = true): void {
		const where = keepCaret ? caret() : undefined;
		const frag = document.createDocumentFragment();
		for (const segment of segments(sync.text, marks.filter((m) => m.kind === "ins"))) {
			if (!("mark" in segment)) frag.append(document.createTextNode(segment.text));
			else frag.append(el("span", { class: "dp-ins" }, segment.text));
		}
		frag.append(el("br"));
		text.replaceChildren(frag);
		if (where) place(where);
	}

	const shiftCaret = (at: { start: number; end: number }, applied: readonly Splice[]) => {
		const move = (p: number) => applied.reduce((q, s) => (q <= s.at ? q : q >= s.at + s.before.length ? q + s.text.length - s.before.length : s.at + s.text.length), p);
		return { start: move(at.start), end: move(at.end) };
	};

	text.addEventListener("compositionstart", () => (composing = true));
	text.addEventListener("compositionend", () => {
		composing = false;
		typed();
	});
	text.addEventListener("input", () => {
		if (!composing) typed();
	});

	function typed(): void {
		const now = text.textContent ?? "";
		const at = caret();
		const splice = spliceBetween(sync.text, now, at?.end ?? now.length);
		if (splice) sync.edit(splice);
	}

	// --- what changed ---------------------------------------------------------------------

	function updated(why: "open" | "remote" | "local" | "outside" | "review", applied?: readonly Splice[]): void {
		if (why === "open") {
			marks = recent().flatMap((change) => findMarks(change, sync.text));
			text.setAttribute("contenteditable", sync.readOnly ? "false" : "plaintext-only");
			// A Google Doc goes by its own title; its mirror's file name is this server's business.
			name.textContent = sync.remote?.title ?? base(sync.path);
			name.title = sync.remote ? `${sync.remote.title}, a Google Doc` : sync.path;
			reading.root.dataset.format = sync.format;
			live.root.toggleAttribute("data-tex", isTex());
			pdfButton.hidden = !isTex() || sync.format === "docx";
			if (!sync.readOnly && !sync.remote) sync.git("status");
			remote.drawGoogle();
			// A Doc's text is its indices, not something to read as source.
			sourceButton.hidden = isGoogle();
			drawCommentsButton();
			if (isGoogle() && mode === "source") mode = "page";
			buildTools();
			live.reset();
			setMode(mode);
		} else if (why === "local") {
			for (const splice of applied ?? []) marks = shiftMarks(marks, splice);
			if (mode === "source") {
				if (marks.length) draw();
			} else if (isWord()) reading.update(applied ?? []);
			else if (isGoogle()) gview.update(applied ?? [], true);
			else live.local();
		} else {
			const where = mode === "source" ? caret() : undefined;
			for (const splice of applied ?? []) marks = shiftMarks(marks, splice);
			const change = why === "outside" ? sync.changes.at(-1) : undefined;
			if (change) marks.push(...marksOf(change.id, applied ?? []));
			// Accepted or rejected: its highlight goes.
			const waiting = new Set(sync.changes.map((c) => c.id));
			marks = marks.filter((m) => waiting.has(m.change));
			if (mode === "source") {
				draw(false);
				if (where) place(shiftCaret(where, applied ?? []));
			} else if (isWord()) reading.update(applied ?? []);
			else if (isGoogle()) gview.update(applied ?? []);
			else live.remote(applied ?? []);
		}
		if (why !== "open") pdf.compileSoon();
		refresh();
	}

	// --- the bar and the history -------------------------------------------------------------

	function refresh(): void {
		if (sync.error && !sync.ready) {
			status.dataset.state = "error";
			status.textContent = sync.error;
		} else if (sync.readOnly) {
			status.dataset.state = "idle";
			status.textContent = "Read-only";
		} else if (!sync.ready) {
			status.dataset.state = "idle";
			status.textContent = "Opening…";
		} else {
			status.dataset.state = sync.settled ? "" : "saving";
			status.textContent = sync.settled ? "Saved" : "Saving…";
		}
		const n = sync.changes.length;
		changesButton.hidden = n === 0 && view !== "changes";
		changesButton.innerHTML = `${svg("changes")}<span>Changes</span>${n ? `<span class="dp-count">${n}</span>` : ""}`;
		// Only when the list changed: redrawing it every tick replaced the button under the pointer, and its hover flickered.
		if (view === "changes" && changesDrawn !== changesKey()) drawChanges();
	}

	function show(next: typeof view): void {
		view = view === next ? "none" : next;
		changesButton.setAttribute("aria-pressed", String(view === "changes"));
		historyButton.setAttribute("aria-pressed", String(view === "history"));
		commentsButton.setAttribute("aria-pressed", String(view === "comments"));
		panel.hidden = view === "none";
		if (view !== "history" && viewing) closeVersion();
		if (view === "changes") drawChanges();
		if (view === "comments") drawComments();
		if (view === "history") {
			panel.replaceChildren(header("History"), el("p", { class: "dp-empty" }, "Reading…"));
			sync.versions();
		}
		refresh();
	}

	const whoOf = (by: string) => (by === "outside" ? "Another program" : by);

	function header(title: string, ...extra: HTMLElement[]): HTMLElement {
		const head = el("div", { class: "dp-head" });
		const close = iconButton("x", "Close", "dp-ib dp-sm");
		close.onclick = () => show(view);
		head.append(el("h3", {}, title), ...extra, close);
		return head;
	}

	const initial = (by: string) => (by === "outside" ? "?" : by.trim().charAt(0).toUpperCase() || "?");

	let changesDrawn = "";
	const changesKey = () => `${sync.readOnly}|${sync.changes.map((c) => c.id).join(",")}`;

	function drawChanges(): void {
		changesDrawn = changesKey();
		const extra: HTMLElement[] = [];
		if (sync.changes.length > 0 && !sync.readOnly) {
			const all = el("button", { type: "button", class: "dp-btn dp-sm dp-primary", title: "Keep every edit" }, "Accept all");
			const none = el("button", { type: "button", class: "dp-btn dp-sm dp-outline", title: "Take every edit back" }, "Reject all");
			all.onclick = () => sync.accept("*");
			none.onclick = () => sync.reject("*");
			extra.push(all, none);
		}
		panel.replaceChildren(header("Changes", ...extra));
		if (sync.changes.length === 0) panel.append(el("p", { class: "dp-empty" }, "Nothing to review."));
		for (const change of [...sync.changes].reverse()) {
			const item = el("div", { class: "dp-change", "data-change": change.id });
			const who = el("div", { class: "dp-who" });
			who.append(el("span", { class: "dp-av" }, initial(change.by)), el("b", {}, whoOf(change.by)), new Date(change.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
			if (!sync.readOnly) {
				const acts = el("div", { class: "dp-acts" });
				const yes = iconButton("check", "Accept", "dp-ib dp-sm dp-yes");
				const no = iconButton("x", "Reject", "dp-ib dp-sm dp-no");
				yes.onclick = (event) => (event.stopPropagation(), sync.accept(change.id));
				no.onclick = (event) => (event.stopPropagation(), sync.reject(change.id));
				acts.append(yes, no);
				who.append(acts);
			}
			const snip = el("div", { class: "dp-snip" });
			for (const splice of change.splices.slice(0, 4)) {
				if (splice.before) snip.append(el("del", {}, clip(splice.before, 60)));
				if (splice.text) snip.append(el("ins", {}, clip(splice.text, 60)));
				snip.append(" ");
			}
			if (change.splices.length > 4) snip.append(`+${change.splices.length - 4}`);
			item.append(who, snip);
			item.onmouseenter = () => hot(change.id, true);
			item.onmouseleave = () => hot(change.id, false);
			item.onclick = () => (isGoogle() ? gview.page : live.root).querySelector(`[data-change="${change.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
			panel.append(item);
		}
	}

	// --- a Google Doc's comments, kept by Drive ---------------------------------------------------

	function drawCommentsButton(): void {
		commentsButton.hidden = !isGoogle();
		const n = comments.length;
		commentsButton.innerHTML = `${svg("comment")}<span>Comments</span>${n ? `<span class="dp-count dp-count-soft">${n}</span>` : ""}`;
	}

	function sendComment(action: "create" | "reply" | "resolve", fields: { comment?: string; content?: string; quote?: string }): void {
		options.send({ type: "doc.gcomment", path: sync.path, client: sync.client, action, ...fields });
	}

	/** A new comment on the selected words: the panel opens with a box for it at the top. */
	let drafting: string | undefined;
	function newComment(): void {
		const quote = gview.quote();
		if (!quote) return;
		drafting = quote;
		if (view !== "comments") show("comments");
		else drawComments();
	}

	function drawComments(): void {
		const parts: HTMLElement[] = [header("Comments")];
		if (commentsError) {
			parts.push(el("p", { class: "dp-empty" }, commentsError));
			if (remote.status?.paste !== undefined || options.api) parts.push(...remote.signInParts());
		}
		if (drafting !== undefined) {
			const box = el("div", { class: "dp-comment dp-comment-new" });
			box.append(el("div", { class: "dp-quote" }, clip(drafting, 120)));
			const input = el("textarea", { class: "dp-reply", rows: "3", placeholder: "Comment" });
			const post = el("button", { type: "button", class: "dp-btn dp-sm dp-primary" }, "Comment");
			const cancel = el("button", { type: "button", class: "dp-btn dp-sm" }, "Cancel");
			post.onclick = () => {
				if (!input.value.trim()) return;
				sendComment("create", { content: input.value.trim(), quote: drafting });
				drafting = undefined;
				drawComments();
			};
			cancel.onclick = () => {
				drafting = undefined;
				drawComments();
			};
			const acts = el("div", { class: "dp-comment-acts" });
			acts.append(cancel, post);
			box.append(input, acts);
			parts.push(box);
			setTimeout(() => input.focus(), 0);
		}
		if (!commentsError && comments.length === 0 && drafting === undefined) parts.push(el("p", { class: "dp-empty" }, "No open comments. Select words and press the comment button to add one."));
		for (const c of comments) {
			const card = el("div", { class: "dp-comment", "data-comment": c.id });
			const who = (a: GComment["author"], at?: string) => {
				const row = el("div", { class: "dp-who" });
				row.append(el("span", { class: "dp-av" }, initial(a?.displayName ?? "?")), el("b", {}, a?.displayName ?? "Someone"), at ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
				return row;
			};
			const head = who(c.author, c.createdTime);
			const resolve = iconButton("check", "Resolve", "dp-ib dp-sm dp-yes");
			resolve.onclick = (event) => {
				event.stopPropagation();
				sendComment("resolve", { comment: c.id, content: "" });
			};
			const acts = el("div", { class: "dp-acts" });
			acts.append(resolve);
			head.append(acts);
			card.append(head);
			if (c.quotedFileContent?.value) card.append(el("div", { class: "dp-quote" }, clip(c.quotedFileContent.value, 120)));
			card.append(el("div", { class: "dp-comment-body" }, c.content));
			for (const r of c.replies ?? []) {
				if (!r.content) continue;
				card.append(who(r.author, r.createdTime), el("div", { class: "dp-comment-body" }, r.content));
			}
			const form = el("form", { class: "dp-reply-row" });
			const input = el("input", { class: "dp-reply", placeholder: "Reply" });
			form.append(input);
			form.onsubmit = (event) => {
				event.preventDefault();
				if (input.value.trim()) sendComment("reply", { comment: c.id, content: input.value.trim() });
				input.value = "";
			};
			card.append(form);
			card.onmouseenter = () => hotComment(c.id, true);
			card.onmouseleave = () => hotComment(c.id, false);
			card.onclick = (event) => {
				if ((event.target as HTMLElement).closest("input, button, textarea")) return;
				gview.page.querySelector(`[data-comment="${c.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
			};
			parts.push(card);
		}
		panel.replaceChildren(...parts);
	}

	function hotComment(id: string, on: boolean): void {
		for (const node of gview.page.querySelectorAll<HTMLElement>(`[data-comment="${id}"]`)) node.toggleAttribute("data-hot", on);
	}

	// A click on commented words opens the comment.
	gview.page.addEventListener("click", (event) => {
		const id = (event.target as HTMLElement).closest<HTMLElement>("[data-comment]")?.dataset.comment;
		if (!id) return;
		if (view !== "comments") show("comments");
		panel.querySelector(`[data-comment="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});

	function hot(change: string, on: boolean): void {
		for (const node of (isGoogle() ? gview.page : live.root).querySelectorAll<HTMLElement>(`[data-change="${change}"]`)) node.toggleAttribute("data-hot", on);
	}

	// --- one change, from its highlight ------------------------------------------------------

	let pillFor: string | undefined;
	let pillTimer: ReturnType<typeof setTimeout> | undefined;
	function showPill(target: HTMLElement): void {
		const id = target.dataset.change!;
		const change = sync.changes.find((c) => c.id === id);
		if (!change || sync.readOnly || viewing) return;
		clearTimeout(pillTimer);
		if (pillFor !== id) {
			pillFor = id;
			const yes = iconButton("check", "Accept", "dp-ib dp-sm dp-yes");
			const no = iconButton("x", "Reject", "dp-ib dp-sm dp-no");
			yes.onclick = () => (sync.accept(id), hidePill(true));
			no.onclick = () => (sync.reject(id), hidePill(true));
			const who = el("span", { class: "p-who" });
			who.append(el("span", { class: "dp-av" }, initial(change.by)), el("b", {}, whoOf(change.by)), new Date(change.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
			pill.replaceChildren(who, yes, no);
		}
		pill.hidden = false;
		const box = target.getBoundingClientRect();
		const frame = main.getBoundingClientRect();
		const left = Math.max(8, Math.min(box.left - frame.left, frame.width - pill.offsetWidth - 8));
		const above = box.top - frame.top - pill.offsetHeight - 6;
		pill.style.left = `${left}px`;
		pill.style.top = `${above < 4 ? box.bottom - frame.top + 6 : above}px`;
		hot(id, true);
	}
	function hidePill(now = false): void {
		clearTimeout(pillTimer);
		const go = () => {
			if (pillFor) hot(pillFor, false);
			pill.hidden = true;
			pillFor = undefined;
		};
		if (now) go();
		else pillTimer = setTimeout(go, 350);
	}
	for (const surface of [live.root, gview.page]) {
		surface.addEventListener("mouseover", (event) => {
			const target = (event.target as HTMLElement).closest<HTMLElement>("[data-change]");
			if (target && surface.contains(target)) showPill(target);
			else if (pillFor) hidePill();
		});
		surface.addEventListener("mouseleave", () => hidePill());
	}
	pill.addEventListener("mouseenter", () => clearTimeout(pillTimer));
	pill.addEventListener("mouseleave", () => hidePill());
	scroll.addEventListener("scroll", () => hidePill(true));

	// --- history: looking at a kept version ------------------------------------------------------

	function drawHistory(): void {
		panel.replaceChildren(header("History"));
		if (versions.length === 0) panel.append(el("p", { class: "dp-empty" }, "No versions yet."));
		const today = new Date().toDateString();
		for (const [i, version] of [...versions].reverse().entries()) {
			const date = new Date(version.at);
			const item = el("div", { class: i === 0 ? "dp-time t-latest" : "dp-time", "aria-current": String(viewing?.sha === version.sha && viewing.at === version.at), title: "Show this version" });
			const label = el("span", { class: "t-when" }, date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
			if (date.toDateString() !== today) label.append(el("small", {}, date.toLocaleDateString([], { month: "short", day: "numeric" })));
			item.append(label);
			if (!sync.readOnly) {
				const restore = iconButton("restore", "Restore this version", "dp-ib dp-sm");
				restore.onclick = (event) => (event.stopPropagation(), restoreTo(version.sha));
				item.append(restore);
			}
			item.onclick = () => {
				if (viewing?.sha === version.sha && viewing.at === version.at) return closeVersion();
				picked = { sha: version.sha, at: version.at };
				sync.version(version.sha);
			};
			panel.append(item);
		}
	}

	function restoreTo(sha: string): void {
		sync.restore(sha);
		closeVersion();
	}

	function openVersion(sha: string, at: number | undefined, source: string): void {
		closeVersion(false);
		viewing = { sha, ...(at ? { at } : {}), text: source };
		const word = isWord();
		live.root.hidden = true;
		reading.root.hidden = true;
		gview.root.hidden = true;
		text.hidden = true;
		tools.hidden = true;
		if (isGoogle()) {
			// A Doc's version reads as its words; its styles are Google's, in Google's own version history.
			old.replaceChildren(...GoogleView.plain(source).split("\n").map((line) => el("p", {}, line)));
			old.hidden = false;
		} else if (word) {
			// A Word version reads as its paragraphs' words.
			old.replaceChildren(...docxBlocks(source).filter((b) => b.kind === "text").map((b) => el("p", {}, readParagraph(source.slice(b.start, b.end)).text)));
			old.hidden = false;
		} else {
			// What differs from now is highlighted: the words Restore would bring back.
			const diff = spliceDiff(sync.text, source);
			const marks2: Mark[] = [];
			// Splices in source order: each one's place holds in the version's text.
			for (const s of diff) {
				if (s.text) marks2.push({ change: "then", kind: "ins", start: s.at, end: s.at + s.text.length });
				else marks2.push({ change: "then", kind: "del", at: s.at, text: s.before });
			}
			const stub = { text: source, readOnly: true, ready: true, path: sync.path, format: sync.format } as unknown as Sync;
			const editor = new LiveEditor(stub, { ...(options.math ? { math: options.math } : {}), marks: () => marks2, changes: () => [] });
			editor.root.dataset.preview = "";
			editor.root.toggleAttribute("data-tex", isTex());
			editor.reset();
			viewing.editor = editor;
			live.root.after(editor.root);
		}
		const restore = el("button", { type: "button", class: "dp-btn dp-sm dp-primary" }, "Restore");
		const back = iconButton("x", "Back to now", "dp-ib dp-sm");
		restore.onclick = () => restoreTo(sha);
		back.onclick = () => closeVersion();
		const icon = el("span");
		icon.innerHTML = svg("clock");
		banner.replaceChildren(icon.firstElementChild!, el("b", {}, at ? when(at) : "Earlier version"), el("span", { class: "dp-spacer" }), ...(sync.readOnly ? [] : [restore]), back);
		banner.hidden = false;
		scroll.scrollTop = 0;
		if (view === "history") drawHistory();
	}

	function closeVersion(redraw = true): void {
		if (!viewing) return;
		viewing.editor?.destroy();
		viewing.editor?.root.remove();
		viewing = undefined;
		banner.hidden = true;
		old.hidden = true;
		if (redraw) {
			const word = isWord();
			const google = isGoogle();
			live.root.hidden = mode !== "page" || word || google;
			reading.root.hidden = mode !== "page" || !word;
			gview.root.hidden = mode !== "page" || !google;
			text.hidden = mode !== "source";
			tools.hidden = mode !== "page" || word || sync.readOnly || !sync.ready;
			if (view === "history") drawHistory();
		}
	}

	// --- the PDF, for a LaTeX page, and where the file lives besides the deck (page/pdf.ts, page/remote.ts) -------------
	const pdf = new PdfPane({ sync, live, options, pdfBar, pdfState, errButton, errList, pdfBody, pdfButton, pdfPane, divider, main, panel, iconButton });
	const remote = new Remotes({ sync, options, gitBox, gitButton, gitMenu, googleBox, googleButton, googleMenu, pdf, drawComments, view: () => view });

	sourceButton.onclick = () => setMode(mode === "source" ? "page" : "source");
	historyButton.onclick = () => show("history");
	commentsButton.onclick = () => show("comments");
	changesButton.onclick = () => show("changes");

	const stop = options.listen((message) => {
		sync.receive(message);
		if (message.type === "doc.versions" && message.path === sync.path) {
			versions = message.versions;
			if (view === "history") drawHistory();
		}
		if (message.type === "doc.compiled" && message.path === sync.path) pdf.compiled(message);
		if (message.type === "doc.repo" && message.path === sync.path) remote.repoAnswered(message);
		if (message.type === "doc.gdoc" && message.path === sync.path) {
			gview.load(message.document as never, message.text);
			gview.setComments(comments);
		}
		if (message.type === "doc.gcomments" && message.path === sync.path) {
			comments = message.comments as GComment[];
			commentsError = message.error ?? "";
			gview.setComments(comments);
			drawCommentsButton();
			if (view === "comments") drawComments();
		}
		if (message.type === "doc.remote" && message.path === sync.path) {
			remote.status = message.status;
			remote.drawGoogle();
		}
		if (message.type === "doc.version" && message.path === sync.path) {
			if (message.text !== undefined) openVersion(message.sha, picked?.sha === message.sha ? picked.at : message.at, message.text);
			else if (message.error) {
				status.dataset.state = "error";
				status.textContent = message.error;
			}
		}
		// A restore or someone's edit while looking at a version: the History list grows.
		if (message.type === "doc.changed" && view === "history" && !message.client && message.path === sync.path) sync.versions();
		if (message.type === "doc.patched") refresh();
	});
	/*
	 * Asked again until answered: the board's script runs before the app has wired the frame, so
	 * the first `doc.open` can go out before anyone is listening for it. Opening twice is harmless.
	 */
	const ticker = setInterval(() => {
		if (!sync.ready && !sync.error) sync.open();
		refresh();
	}, 400);
	sync.open();

	return {
		sync,
		destroy() {
			clearInterval(ticker);
			reading.destroy();
			live.destroy();
			viewing?.editor?.destroy();
			sync.close();
			stop();
			for (const url of urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
		},
	};
}
