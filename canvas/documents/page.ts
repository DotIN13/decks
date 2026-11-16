import type { DocVersion, Splice } from "./model.ts";
import { DocSync } from "./client.ts";
import { findMarks, marksOf, segments, shiftMarks, spliceBetween, type Mark } from "./marks.ts";
import { LiveEditor, type BlockStyle, type FormatState, type InlineStyle } from "./live.ts";
import { Reading } from "./reading.ts";
import { GoogleView } from "./gview.ts";
import type { DocsRequest } from "./google/types.ts";
import { STYLE } from "./page/style.ts";
import { base, clip, dir, el, keyName, svg } from "./page/parts.ts";
import { PdfPane } from "./page/pdf.ts";
import { Remotes } from "./page/remote.ts";
import { buildPage } from "./page/dom.ts";
import { closeVersion, drawHistory, openVersion, restoreTo } from "./page/history.ts";
import type { DocPage, DocPageOptions, GComment } from "./page/types.ts";

export type { DocPage, DocPageOptions } from "./page/types.ts";

/**
 * A document drawn as a page you type into, in plain DOM.
 *
 * Markdown and LaTeX are typed into as they read (`live/editor.ts`): the file's own characters, styled,
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

export function mountDocPage(host: HTMLElement, options: DocPageOptions): DocPage {
	return new DocPageView(host, options).handle();
}

/** The element a page fills and the options it was given, set by super() before any field of the view is. */
class DocPageInput {
	constructor(
		readonly host: HTMLElement,
		readonly options: DocPageOptions,
	) {}
}

/**
 * One document page: its parts, the editors over its text, its state, and what each part does. Its
 * fields hold no work: start() does every step in the order the page was always built in.
 */
export class DocPageView extends DocPageInput {
	// --- what the page holds ---

	/** The elements the page is made of (page/dom.ts). */
	parts!: ReturnType<typeof buildPage>;
	readonly urls: Map<string, Promise<string | undefined>> = new Map<string, Promise<string | undefined>>();
	readonly pictures: Map<string, Promise<string | undefined>> = new Map<string, Promise<string | undefined>>();
	sync!: DocSync;
	live!: LiveEditor;
	reading!: Reading;

	// A Google Doc, drawn from Google's own document as it lays it out (`google/view.ts`); its styles go to Google once the typing before them has.
	gview!: GoogleView;

	/**
	 * Styles for Google, each with the text the page had when it was made, sent in order once the
	 * typing before it has reached the server: the server brings the Doc to that text, applies the
	 * style, and only then what was typed after, so a list item made after a bullet is in the list.
	 */
	readonly styleQueue: Array<{ requests: DocsRequest[]; text: string; mark: number; hold?: number }> = [];

	/** A keystroke's style is held this long for the next keystroke to join, so a run of bold typing is one request to Google, not one a key. */
	readonly HOLD_MS = 400;
	readonly buttons: Map<string, HTMLButtonElement> = new Map<string, HTMLButtonElement>();

	// The paragraph style: a button naming it, and a menu drawing each style as it reads.
	styleBox!: HTMLDivElement;
	styleButton!: HTMLButtonElement;
	styleMenu!: HTMLDivElement;
	readonly FONTS: string[] = ["Arial", "Roboto", "Times New Roman", "Georgia", "Lato", "Merriweather", "Montserrat", "Open Sans", "Playfair Display", "Source Sans 3", "Courier New", "Verdana", "Comic Sans MS"];
	readonly gcontrols: { font?: HTMLSelectElement; size?: HTMLInputElement } = {};
	pdf!: PdfPane;
	remote!: Remotes;
	stop!: () => void;
	/*
	 * Asked again until answered: the board's script runs before the app has wired the frame, so
	 * the first `doc.open` can go out before anyone is listening for it. Opening twice is harmless.
	 */
	ticker!: ReturnType<typeof setInterval>;

	// --- its state ---
	marks: Mark[] = [];
	composing: boolean = false;
	view: "none" | "changes" | "history" | "comments" = "none";

	/** A Google Doc's open comments, from Drive, or why they cannot be shown. */
	comments: GComment[] = [];
	commentsError: string = "";
	versions: DocVersion[] = [];

	/** The kept version being looked at, instead of the page as it is now. */
	viewing: { sha: string; at?: number; text: string; editor?: LiveEditor } | undefined;

	/** The History row last pressed: one text kept twice has one id, so the row says which time is meant. */
	picked: { sha: string; at: number } | undefined;
	mode: "page" | "source" = "page";
	pumping: ReturnType<typeof setTimeout> | undefined;
	styles: Array<[string, string]> = [];
	styleNow: string = "p";
	changesDrawn: string = "";

	/** A new comment on the selected words: the panel opens with a box for it at the top. */
	drafting: string | undefined;
	pillFor: string | undefined;
	pillTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(host: HTMLElement, options: DocPageOptions) {
		super(host, options);
		this.start();
	}

	/** Every step of building the page, in its order: the host, the editors, the tools, the listeners, then the outside. */
	start(): void {
		if (!document.getElementById("dp-style")) document.head.append(el("style", { id: "dp-style" }, STYLE));
		this.host.classList.add("dp");
		this.host.replaceChildren();
		this.placeEditors();
		this.wireStyleMenu();
		this.wireSource();
		this.wireCommentClicks();
		this.wireChangePill();
		this.startOutside();
	}

	/** The page and its editors. */
	placeEditors(): void {
		this.parts = buildPage(this.host, this.options);
		this.sync = new DocSync({
			path: this.options.path,
			send: this.options.send,
			onUpdate: (_sync, why, applied) => this.updated(why, applied),
		});
		this.live = new LiveEditor(this.sync, {
			...(this.options.math ? { math: this.options.math } : {}),
			asset: (src) => {
				if (!this.options.file) return Promise.resolve(undefined);
				const from = dir(this.sync.path);
				const path = src.startsWith("/") ? src : `${from}/${decodeURI(src)}`;
				let url = this.urls.get(path);
				if (!url) {
					url = this.options
						.file(path)
						.then((bytes) => URL.createObjectURL(new Blob([bytes])))
						.catch(() => undefined);
					this.urls.set(path, url);
				}
				return url;
			},
			pdfPicture: (src) => {
				if (!this.options.file || !this.options.pdf) return Promise.resolve(undefined);
				const path = this.near(src);
				let url = this.pictures.get(path);
				if (!url) {
					const into = document.createElement("div");
					url = this.options
						.file(path)
						.then((bytes) => this.options.pdf!(into, bytes, 1200))
						.then(() => into.querySelector("img")?.src ?? into.querySelector("canvas")?.toDataURL("image/png"))
						.catch(() => undefined);
					this.pictures.set(path, url);
				}
				return url;
			},
			marks: () => this.marks,
			changes: this.recent.bind(this),
			onState: (state) => this.pressed(state),
		});
		this.reading = new Reading(this.sync, {
			...(this.options.markdown ? { markdown: this.options.markdown } : {}),
			...(this.options.math ? { math: this.options.math } : {}),
			...(this.options.file ? { file: this.options.file } : {}),
			marks: () => this.marks,
		});
		this.gview = new GoogleView(this.sync, {
			marks: () => this.marks,
			style: (requests) => this.sendStyle(requests),
			...(this.options.api ? { api: this.options.api } : {}),
			selection: () => this.gpressed(),
			command: (name) => (name === "link" ? this.askLink() : this.newComment()),
		});
		this.parts.scroll.append(this.live.root, this.reading.root, this.gview.root, this.parts.old);
		this.reading.root.hidden = true;
		this.gview.root.hidden = true;
	}

	/** The styling tools. */
	wireStyleMenu(): void {
		this.styleBox = el("div", { class: "dp-style" });
		this.styleButton = el("button", { type: "button", class: "dp-btn", title: "Paragraph style", "aria-haspopup": "menu", "aria-expanded": "false" });
		this.styleMenu = el("div", { class: "dp-menu", role: "menu", hidden: "" });
		this.styleBox.append(this.styleButton, this.styleMenu);
		this.styleButton.addEventListener("mousedown", (event) => event.preventDefault());
		this.styleButton.onclick = () => {
			const open = this.styleMenu.hidden;
			this.styleMenu.replaceChildren(
				...this.styles.map(([value, label]) => {
					const item = el("button", { type: "button", role: "menuitemradio", class: `m-${value}`, "aria-checked": String(value === this.styleNow) }, label);
					item.addEventListener("mousedown", (event) => event.preventDefault());
					item.onclick = () => {
						this.closeMenu();
						if (this.isGoogle()) this.gview.setParagraph({ namedStyleType: value }, "namedStyleType");
						else this.live.setBlock(value as BlockStyle);
					};
					return item;
				}),
			);
			this.styleMenu.hidden = !open;
			this.styleButton.setAttribute("aria-expanded", String(open));
		};
		document.addEventListener("mousedown", (event) => {
			if (!this.styleBox.contains(event.target as Node)) this.closeMenu();
		});
	}

	/** Source: the file's text as it is. */
	wireSource(): void {
		this.parts.text.addEventListener("compositionstart", () => (this.composing = true));
		this.parts.text.addEventListener("compositionend", () => {
			this.composing = false;
			this.typed();
		});
		this.parts.text.addEventListener("input", () => {
			if (!this.composing) this.typed();
		});
	}

	/** A Google Doc's comments, kept by Drive. */
	wireCommentClicks(): void {
		// A click on commented words opens the comment.
		this.gview.page.addEventListener("click", (event) => {
			const id = (event.target as HTMLElement).closest<HTMLElement>("[data-comment]")?.dataset.comment;
			if (!id) return;
			if (this.view !== "comments") this.show("comments");
			this.parts.panel.querySelector(`[data-comment="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
	}

	/** One change, from its highlight. */
	wireChangePill(): void {
		for (const surface of [this.live.root, this.gview.page]) {
			surface.addEventListener("mouseover", (event) => {
				const target = (event.target as HTMLElement).closest<HTMLElement>("[data-change]");
				if (target && surface.contains(target)) this.showPill(target);
				else if (this.pillFor) this.hidePill();
			});
			surface.addEventListener("mouseleave", () => this.hidePill());
		}
		this.parts.pill.addEventListener("mouseenter", () => clearTimeout(this.pillTimer));
		this.parts.pill.addEventListener("mouseleave", () => this.hidePill());
		this.parts.scroll.addEventListener("scroll", () => this.hidePill(true));
	}

	/** The PDF, for a LaTeX page, and where the file lives besides the deck (page/pdf.ts, page/remote.ts). */
	startOutside(): void {
		this.pdf = new PdfPane({ sync: this.sync, live: this.live, options: this.options, pdfBar: this.parts.pdfBar, pdfState: this.parts.pdfState, errButton: this.parts.errButton, errList: this.parts.errList, pdfBody: this.parts.pdfBody, pdfButton: this.parts.pdfButton, pdfPane: this.parts.pdfPane, divider: this.parts.divider, main: this.parts.main, panel: this.parts.panel, iconButton: this.parts.iconButton });
		this.remote = new Remotes({ sync: this.sync, options: this.options, gitBox: this.parts.gitBox, gitButton: this.parts.gitButton, gitMenu: this.parts.gitMenu, googleBox: this.parts.googleBox, googleButton: this.parts.googleButton, googleMenu: this.parts.googleMenu, pdf: this.pdf, drawComments: this.drawComments.bind(this), view: () => this.view });
		this.parts.sourceButton.onclick = () => this.setMode(this.mode === "source" ? "page" : "source");
		this.parts.historyButton.onclick = () => this.show("history");
		this.parts.commentsButton.onclick = () => this.show("comments");
		this.parts.changesButton.onclick = () => this.show("changes");
		this.stop = this.options.listen((message) => {
			this.sync.receive(message);
			if (message.type === "doc.versions" && message.path === this.sync.path) {
				this.versions = message.versions;
				if (this.view === "history") this.drawHistory();
			}
			if (message.type === "doc.compiled" && message.path === this.sync.path) this.pdf.compiled(message);
			if (message.type === "doc.repo" && message.path === this.sync.path) this.remote.repoAnswered(message);
			if (message.type === "doc.gdoc" && message.path === this.sync.path) {
				this.gview.load(message.document as never, message.text);
				this.gview.setComments(this.comments);
			}
			if (message.type === "doc.gcomments" && message.path === this.sync.path) {
				this.comments = message.comments as GComment[];
				this.commentsError = message.error ?? "";
				this.gview.setComments(this.comments);
				this.drawCommentsButton();
				if (this.view === "comments") this.drawComments();
			}
			if (message.type === "doc.remote" && message.path === this.sync.path) {
				this.remote.status = message.status;
				this.remote.drawGoogle();
			}
			if (message.type === "doc.version" && message.path === this.sync.path) {
				if (message.text !== undefined) this.openVersion(message.sha, this.picked?.sha === message.sha ? this.picked.at : message.at, message.text);
				else if (message.error) {
					this.parts.status.dataset.state = "error";
					this.parts.status.textContent = message.error;
				}
			}
			// A restore or someone's edit while looking at a version: the History list grows.
			if (message.type === "doc.changed" && this.view === "history" && !message.client && message.path === this.sync.path) this.sync.versions();
			if (message.type === "doc.patched") this.refresh();
		});
		this.ticker = setInterval(() => {
			if (!this.sync.ready && !this.sync.error) this.sync.open();
			this.refresh();
		}, 400);
		this.sync.open();
	}

	// --- sending styles to Google, and what kind of file this is ---

	near(src: string) {
		return (src.startsWith("/") ? src : `${dir(this.sync.path)}/${decodeURI(src)}`);
	}

	recent() {
		return this.sync.changes;
	}

	sendStyle(requests: DocsRequest[]): void {
		// A keystroke's style that carries on the one before it, not yet sent, goes out as one request.
		const last = this.styleQueue[this.styleQueue.length - 1];
		const [a] = last?.requests ?? [];
		const [b] = requests;
		if (last?.requests.length === 1 && requests.length === 1 && a && b && "updateTextStyle" in a && "updateTextStyle" in b && a.updateTextStyle.range.endIndex === b.updateTextStyle.range.startIndex && JSON.stringify([a.updateTextStyle.textStyle, a.updateTextStyle.fields]) === JSON.stringify([b.updateTextStyle.textStyle, b.updateTextStyle.fields])) {
			last.requests = [{ updateTextStyle: { ...a.updateTextStyle, range: { startIndex: a.updateTextStyle.range.startIndex, endIndex: b.updateTextStyle.range.endIndex } } }];
			last.text = this.sync.text;
			last.mark = this.sync.mark();
			last.hold = Date.now() + this.HOLD_MS;
		} else this.styleQueue.push({ requests, text: this.sync.text, mark: this.sync.mark(), ...(requests.length === 1 && b && "updateTextStyle" in b ? { hold: Date.now() + this.HOLD_MS } : {}) });
		this.pump();
	}

	pump(): void {
		clearTimeout(this.pumping);
		this.pumping = undefined;
		this.sync.flush();
		while (this.styleQueue.length && this.sync.landed(this.styleQueue[0]!.mark) && (this.styleQueue.length > 1 || (this.styleQueue[0]!.hold ?? 0) <= Date.now())) {
			const next = this.styleQueue.shift()!;
			this.options.send({ type: "doc.gstyle", path: this.sync.path, client: this.sync.client, requests: next.requests, text: next.text });
		}
		if (this.styleQueue.length) this.pumping = setTimeout(this.pump.bind(this), 30);
	}

	isGoogle() {
		return !!this.sync.remote;
	}

	isWord() {
		return this.sync.format === "docx";
	}

	isTex() {
		return /\.(tex|sty|cls|ltx)$/i.test(this.sync.path);
	}

	// --- the styling tools ---

	styleLabel() {
		this.styleButton.innerHTML = "";
		this.styleButton.append(el("span", {}, this.styles.find(([v]) => v === this.styleNow)?.[1] ?? "Body"));
		this.styleButton.insertAdjacentHTML("beforeend", svg("chevron"));
	}

	closeMenu() {
		this.styleMenu.hidden = true;
		this.styleButton.setAttribute("aria-expanded", "false");
	}

	buildTools(): void {
		this.parts.tools.replaceChildren();
		this.buttons.clear();
		if (this.isGoogle()) return this.buildGoogleTools();
		const tex = this.isTex();
		const button = (key: string, title: string, run: () => void, icon = key) => {
			const b = el("button", { type: "button", class: "dp-ib", title, "aria-label": title, "aria-pressed": "false" });
			b.innerHTML = svg(icon);
			// Pressing a tool keeps the caret where it is in the page.
			b.addEventListener("mousedown", (event) => event.preventDefault());
			b.addEventListener("click", () => run());
			this.buttons.set(key, b);
			group.append(b);
		};
		// Tools come in bordered groups, one per kind: marks, inline objects, blocks, inserts, history.
		let group = el("div", { class: "dp-group" });
		const sep = () => {
			if (group.childElementCount) this.parts.tools.append(group);
			group = el("div", { class: "dp-group" });
		};
		this.styles = tex
			? [["p", "Body text"], ["h1", "Section"], ["h2", "Subsection"], ["h3", "Subsubsection"], ["h4", "Paragraph heading"]]
			: [["p", "Body text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["h4", "Heading 4"], ["h5", "Heading 5"], ["h6", "Heading 6"]];
		this.styleLabel();
		this.parts.tools.append(this.styleBox);
		const inline = (key: InlineStyle, title: string) => button(key, title, () => this.live.toggle(key));
		inline("bold", `Bold (${keyName("Mod+B")})`);
		inline("italic", `Italic (${keyName("Mod+I")})`);
		inline("underline", `Underline (${keyName("Mod+U")})`);
		if (!tex) inline("strike", `Strikethrough (${keyName("Mod+Shift+X")})`);
		sep();
		inline("code", `Code (${keyName("Mod+E")})`);
		if (!tex) inline("mark", `Highlight (${keyName("Mod+Shift+H")})`);
		button("link", `Link (${keyName("Mod+K")})`, () => this.live.link());
		inline("math", `Inline maths (${keyName("Mod+Shift+M")})`);
		sep();
		button("ul", `Bulleted list (${keyName("Mod+Shift+8")})`, () => this.live.setBlock("ul"));
		if (!tex) {
			button("ol", `Numbered list (${keyName("Mod+Shift+7")})`, () => this.live.setBlock("ol"));
			button("task", "Task list", () => this.live.setBlock("task"));
			button("quote", "Quote", () => this.live.setBlock("quote"));
			button("codeblock", "Code block", () => this.live.setBlock("code"));
			sep();
			button("table", "Table", () => this.live.insertBlock("table"));
			button("hr", "Horizontal rule", () => this.live.insertBlock("hr"));
		} else {
			button("ol", "Numbered list", () => this.live.setBlock("ol"));
			button("display", "Equation", () => this.live.insertBlock("math"));
		}
		sep();
		button("undo", `Undo (${keyName("Mod+Z")})`, () => this.live.undo());
		button("redo", `Redo (${keyName("Mod+Shift+Z")})`, () => this.live.redo());
		sep();
	}

	// --- a Google Doc's own tools: what Google's toolbar has, sent to Google as Docs requests ---

	buildGoogleTools(): void {
		const bar = this.toolGroups();
		const { sep, button } = bar;
		button("undo", `Undo (${keyName("Mod+Z")})`, () => this.gview.undo());
		button("redo", `Redo (${keyName("Mod+Shift+Z")})`, () => this.gview.redo());
		sep();
		this.styles = [["NORMAL_TEXT", "Normal text"], ["TITLE", "Title"], ["SUBTITLE", "Subtitle"], ["HEADING_1", "Heading 1"], ["HEADING_2", "Heading 2"], ["HEADING_3", "Heading 3"], ["HEADING_4", "Heading 4"]];
		this.styleNow = "NORMAL_TEXT";
		this.styleLabel();
		this.parts.tools.append(this.styleBox);
		this.fontTools(bar);
		sep();
		button("bold", `Bold (${keyName("Mod+B")})`, () => this.gview.toggle("bold"));
		button("italic", `Italic (${keyName("Mod+I")})`, () => this.gview.toggle("italic"));
		button("underline", `Underline (${keyName("Mod+U")})`, () => this.gview.toggle("underline"));
		button("strike", `Strikethrough (${keyName("Mod+Shift+X")})`, () => this.gview.toggle("strikethrough"));
		this.colourTool(bar, "colour", "Text colour", "foregroundColor");
		this.colourTool(bar, "highlight", "Highlight colour", "backgroundColor");
		sep();
		button("link", `Link (${keyName("Mod+K")})`, () => this.askLink());
		sep();
		const align = (key: string, title: string, value: string) => button(key, title, () => this.gview.setParagraph({ alignment: value }, "alignment"));
		align("alignleft", "Left align", "START");
		align("aligncenter", "Centre align", "CENTER");
		align("alignright", "Right align", "END");
		align("justify", "Justify", "JUSTIFIED");
		sep();
		button("ul", `Bulleted list (${keyName("Mod+Shift+8")})`, () => this.gview.list(false));
		button("ol", `Numbered list (${keyName("Mod+Shift+7")})`, () => this.gview.list(true));
		button("outdent", `Decrease indent (${keyName("Mod+[")})`, () => this.gview.indent(-1));
		button("indent", `Increase indent (${keyName("Mod+]")})`, () => this.gview.indent(1));
		sep();
		button("table", "Insert a table (3 by 3)", () => this.gview.table("insert"));
		// Rows and columns, for the cell the caret is in.
		button("rowabove", "Insert row above", () => this.gview.table("rowAbove"));
		button("rowbelow", "Insert row below", () => this.gview.table("rowBelow"));
		button("colleft", "Insert column left", () => this.gview.table("colLeft"));
		button("colright", "Insert column right", () => this.gview.table("colRight"));
		button("rowdelete", "Delete row", () => this.gview.table("deleteRow"));
		button("coldelete", "Delete column", () => this.gview.table("deleteCol"));
		sep();
		button("comment", "Comment on the selected words", () => this.newComment());
		button("clear", `Clear formatting (${keyName("Mod+\\")})`, () => this.gview.clearFormatting());
		sep();
		this.gpressed();
	}

	/** The toolbar's groups as they fill: a button in the current group, a separator that starts the next. */
	toolGroups() {
		let group = el("div", { class: "dp-group" });
		const sep = () => {
			if (group.childElementCount) this.parts.tools.append(group);
			group = el("div", { class: "dp-group" });
		};
		const button = (key: string, title: string, run: () => void, icon = key) => {
			const b = el("button", { type: "button", class: "dp-ib", title, "aria-label": title, "aria-pressed": "false" });
			b.innerHTML = svg(icon);
			b.addEventListener("mousedown", (event) => event.preventDefault());
			b.addEventListener("click", () => run());
			this.buttons.set(key, b);
			group.append(b);
			return b;
		};
		return { sep, button, add: (node: HTMLElement) => group.append(node) };
	}

	/** The font list and the size box with its two buttons. */
	fontTools({ sep, button, add }: ReturnType<DocPageView["toolGroups"]>): void {
		const font = el("select", { class: "dp-select", title: "Font", "aria-label": "Font" });
		for (const f of this.FONTS) font.append(el("option", { value: f, style: `font-family: "${f}"` }, f));
		font.onchange = () => {
			this.gview.setText("weightedFontFamily", { fontFamily: font.value });
			this.gview.focus();
		};
		this.gcontrols.font = font;
		add(font);
		sep();
		const size = el("input", { class: "dp-size", type: "text", inputmode: "numeric", title: "Font size", "aria-label": "Font size" });
		const setSize = (value: number) => {
			const v = Math.max(1, Math.min(400, Math.round(value)));
			size.value = String(v);
			this.gview.setText("fontSize", { magnitude: v, unit: "PT" });
		};
		button("smaller", "Decrease font size", () => setSize(Number(size.value || 11) - 1), "minus");
		add(size);
		button("bigger", "Increase font size", () => setSize(Number(size.value || 11) + 1), "plus");
		size.onchange = () => {
			setSize(Number(size.value) || 11);
			this.gview.focus();
		};
		this.gcontrols.size = size;
	}

	/** A colour button for the text or its highlight, with the colour picker inside it. */
	colourTool({ button }: ReturnType<DocPageView["toolGroups"]>, key: string, title: string, field: "foregroundColor" | "backgroundColor"): void {
		const input = el("input", { type: "color", class: "dp-colour", "aria-label": title, value: field === "foregroundColor" ? "#000000" : "#ffff00" });
		const b = button(key, title, () => input.click(), field === "foregroundColor" ? "textcolour" : "mark");
		b.append(input);
		input.onchange = () => {
			const hex = input.value;
			const c = (k: number) => Number.parseInt(hex.slice(k, k + 2), 16) / 255;
			this.gview.setText(field, { color: { rgbColor: { red: c(1), green: c(3), blue: c(5) } } });
			this.gview.focus();
		};
	}

	askLink(): void {
		const url = window.prompt("Link to", "https://");
		if (url !== null) this.gview.link(url.trim() && url.trim() !== "https://" ? url.trim() : undefined);
		this.gview.focus();
	}

	gpressed(): void {
		if (!this.isGoogle() || !this.gview.loaded) return;
		const state = this.gview.state();
		for (const key of ["bold", "italic", "underline", "strike"] as const) this.buttons.get(key)?.setAttribute("aria-pressed", String(state[key]));
		const align = { START: "alignleft", CENTER: "aligncenter", END: "alignright", JUSTIFIED: "justify" }[state.align] ?? "alignleft";
		for (const key of ["alignleft", "aligncenter", "alignright", "justify"]) this.buttons.get(key)?.setAttribute("aria-pressed", String(key === align));
		this.buttons.get("ul")?.setAttribute("aria-pressed", String(state.bullet));
		const inCell = !!this.gview.cellAt();
		for (const key of ["rowabove", "rowbelow", "colleft", "colright", "rowdelete", "coldelete"]) {
			const b = this.buttons.get(key);
			if (b) b.hidden = !inCell;
		}
		this.buttons.get("ol")?.setAttribute("aria-pressed", String(state.numbered));
		if (this.gcontrols.font && document.activeElement !== this.gcontrols.font) {
			if (![...this.gcontrols.font.options].some((o) => o.value === state.font)) this.gcontrols.font.append(el("option", { value: state.font }, state.font));
			this.gcontrols.font.value = state.font;
		}
		if (this.gcontrols.size && document.activeElement !== this.gcontrols.size) this.gcontrols.size.value = String(Math.round(state.size * 10) / 10);
		const type = state.type === "TITLE" || state.type === "SUBTITLE" || state.type.startsWith("HEADING_") ? state.type : "NORMAL_TEXT";
		if (type !== this.styleNow) {
			this.styleNow = type;
			if (!this.styles.some(([v]) => v === type)) this.styles.push([type, type.replace("HEADING_", "Heading ")]);
			this.styleLabel();
		}
	}

	pressed(state: FormatState): void {
		for (const key of ["bold", "italic", "strike", "underline", "code", "mark", "link", "math"] as const) this.buttons.get(key)?.setAttribute("aria-pressed", String(state[key]));
		for (const key of ["ul", "ol", "task", "quote"] as const) this.buttons.get(key)?.setAttribute("aria-pressed", String(state.block === key));
		this.buttons.get("codeblock")?.setAttribute("aria-pressed", String(state.block === "code"));
		const block = /^h[1-6]$/.test(state.block) ? state.block : "p";
		if (this.styles.some(([v]) => v === block) && block !== this.styleNow) {
			this.styleNow = block;
			this.styleLabel();
		}
	}

	setMode(next: DocPageView["mode"]): void {
		if (this.viewing) this.closeVersion();
		this.mode = next;
		this.parts.sourceButton.setAttribute("aria-pressed", String(this.mode === "source"));
		this.parts.text.hidden = this.mode !== "source";
		const word = this.isWord();
		const google = this.isGoogle();
		this.live.root.hidden = this.mode !== "page" || word || google;
		this.reading.root.hidden = this.mode !== "page" || !word;
		this.gview.root.hidden = this.mode !== "page" || !google;
		this.parts.tools.hidden = this.mode !== "page" || word || this.sync.readOnly || !this.sync.ready;
		if (this.mode === "source") this.draw(false);
		else if (word) this.reading.render();
		else if (google) this.gview.render();
		else this.live.render();
	}

	// --- Source: the file's text as it is ---

	texts(): Text[] {
		const out: Text[] = [];
		const walker = document.createTreeWalker(this.parts.text, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
		return out;
	}

	offsetOf(node: Node, offset: number): number {
		let total = 0;
		if (node.nodeType !== Node.TEXT_NODE) {
			const range = document.createRange();
			range.setStart(this.parts.text, 0);
			range.setEnd(node, offset);
			return range.toString().length;
		}
		for (const t of this.texts()) {
			if (t === node) return total + offset;
			total += t.data.length;
		}
		return total;
	}

	caret(): { start: number; end: number } | undefined {
		const selection = getSelection();
		if (!selection || selection.rangeCount === 0 || !this.parts.text.contains(selection.anchorNode)) return undefined;
		return { start: this.offsetOf(selection.anchorNode!, selection.anchorOffset), end: this.offsetOf(selection.focusNode!, selection.focusOffset) };
	}

	place(at: { start: number; end: number }): void {
		const find = (offset: number): [Node, number] => {
			let total = 0;
			const all = this.texts();
			for (const t of all) {
				if (offset <= total + t.data.length) return [t, offset - total];
				total += t.data.length;
			}
			const last = all.at(-1);
			return last ? [last, last.data.length] : [this.parts.text, 0];
		};
		const [an, ao] = find(at.start);
		const [fn, fo] = find(at.end);
		getSelection()?.setBaseAndExtent(an, ao, fn, fo);
	}

	draw(keepCaret = true): void {
		const where = keepCaret ? this.caret() : undefined;
		const frag = document.createDocumentFragment();
		for (const segment of segments(this.sync.text, this.marks.filter((m) => m.kind === "ins"))) {
			if (!("mark" in segment)) frag.append(document.createTextNode(segment.text));
			else frag.append(el("span", { class: "dp-ins" }, segment.text));
		}
		frag.append(el("br"));
		this.parts.text.replaceChildren(frag);
		if (where) this.place(where);
	}

	shiftCaret(at: { start: number; end: number }, applied: readonly Splice[]) {
		const move = (p: number) => applied.reduce((q, s) => (q <= s.at ? q : q >= s.at + s.before.length ? q + s.text.length - s.before.length : s.at + s.text.length), p);
		return { start: move(at.start), end: move(at.end) };
	}

	typed(): void {
		const now = this.parts.text.textContent ?? "";
		const at = this.caret();
		const splice = spliceBetween(this.sync.text, now, at?.end ?? now.length);
		if (splice) this.sync.edit(splice);
	}

	// --- what changed ---

	updated(why: "open" | "remote" | "local" | "outside" | "review", applied?: readonly Splice[]): void {
		if (why === "open") {
			this.marks = this.recent().flatMap((change) => findMarks(change, this.sync.text));
			this.parts.text.setAttribute("contenteditable", this.sync.readOnly ? "false" : "plaintext-only");
			// A Google Doc goes by its own title; its mirror's file name is this server's business.
			this.parts.name.textContent = this.sync.remote?.title ?? base(this.sync.path);
			this.parts.name.title = this.sync.remote ? `${this.sync.remote.title}, a Google Doc` : this.sync.path;
			this.reading.root.dataset.format = this.sync.format;
			this.live.root.toggleAttribute("data-tex", this.isTex());
			this.parts.pdfButton.hidden = !this.isTex() || this.sync.format === "docx";
			if (!this.sync.readOnly && !this.sync.remote) this.sync.git("status");
			this.remote.drawGoogle();
			// A Doc's text is its indices, not something to read as source.
			this.parts.sourceButton.hidden = this.isGoogle();
			this.drawCommentsButton();
			if (this.isGoogle() && this.mode === "source") this.mode = "page";
			this.buildTools();
			this.live.reset();
			this.setMode(this.mode);
		} else if (why === "local") {
			for (const splice of applied ?? []) this.marks = shiftMarks(this.marks, splice);
			if (this.mode === "source") {
				if (this.marks.length) this.draw();
			} else if (this.isWord()) this.reading.update(applied ?? []);
			else if (this.isGoogle()) this.gview.update(applied ?? [], true);
			else this.live.local();
		} else {
			const where = this.mode === "source" ? this.caret() : undefined;
			for (const splice of applied ?? []) this.marks = shiftMarks(this.marks, splice);
			const change = why === "outside" ? this.sync.changes.at(-1) : undefined;
			if (change) this.marks.push(...marksOf(change.id, applied ?? []));
			// Accepted or rejected: its highlight goes.
			const waiting = new Set(this.sync.changes.map((c) => c.id));
			this.marks = this.marks.filter((m) => waiting.has(m.change));
			if (this.mode === "source") {
				this.draw(false);
				if (where) this.place(this.shiftCaret(where, applied ?? []));
			} else if (this.isWord()) this.reading.update(applied ?? []);
			else if (this.isGoogle()) this.gview.update(applied ?? []);
			else this.live.remote(applied ?? []);
		}
		if (why !== "open") this.pdf.compileSoon();
		this.refresh();
	}

	// --- the bar and the history ---

	refresh(): void {
		if (this.sync.error && !this.sync.ready) {
			this.parts.status.dataset.state = "error";
			this.parts.status.textContent = this.sync.error;
		} else if (this.sync.readOnly) {
			this.parts.status.dataset.state = "idle";
			this.parts.status.textContent = "Read-only";
		} else if (!this.sync.ready) {
			this.parts.status.dataset.state = "idle";
			this.parts.status.textContent = "Opening…";
		} else {
			this.parts.status.dataset.state = this.sync.settled ? "" : "saving";
			this.parts.status.textContent = this.sync.settled ? "Saved" : "Saving…";
		}
		const n = this.sync.changes.length;
		this.parts.changesButton.hidden = n === 0 && this.view !== "changes";
		this.parts.changesButton.innerHTML = `${svg("changes")}<span>Changes</span>${n ? `<span class="dp-count">${n}</span>` : ""}`;
		// Only when the list changed: redrawing it every tick replaced the button under the pointer, and its hover flickered.
		if (this.view === "changes" && this.changesDrawn !== this.changesKey()) this.drawChanges();
	}

	show(next: DocPageView["view"]): void {
		this.view = this.view === next ? "none" : next;
		this.parts.changesButton.setAttribute("aria-pressed", String(this.view === "changes"));
		this.parts.historyButton.setAttribute("aria-pressed", String(this.view === "history"));
		this.parts.commentsButton.setAttribute("aria-pressed", String(this.view === "comments"));
		this.parts.panel.hidden = this.view === "none";
		if (this.view !== "history" && this.viewing) this.closeVersion();
		if (this.view === "changes") this.drawChanges();
		if (this.view === "comments") this.drawComments();
		if (this.view === "history") {
			this.parts.panel.replaceChildren(this.header("History"), el("p", { class: "dp-empty" }, "Reading…"));
			this.sync.versions();
		}
		this.refresh();
	}

	whoOf(by: string) {
		return (by === "outside" ? "Another program" : by);
	}

	header(title: string, ...extra: HTMLElement[]): HTMLElement {
		const head = el("div", { class: "dp-head" });
		const close = this.parts.iconButton("x", "Close", "dp-ib dp-sm");
		close.onclick = () => this.show(this.view);
		head.append(el("h3", {}, title), ...extra, close);
		return head;
	}

	initial(by: string) {
		return (by === "outside" ? "?" : by.trim().charAt(0).toUpperCase() || "?");
	}

	changesKey() {
		return `${this.sync.readOnly}|${this.sync.changes.map((c) => c.id).join(",")}`;
	}

	drawChanges(): void {
		this.changesDrawn = this.changesKey();
		const extra: HTMLElement[] = [];
		if (this.sync.changes.length > 0 && !this.sync.readOnly) {
			const all = el("button", { type: "button", class: "dp-btn dp-sm dp-primary", title: "Keep every edit" }, "Accept all");
			const none = el("button", { type: "button", class: "dp-btn dp-sm dp-outline", title: "Take every edit back" }, "Reject all");
			all.onclick = () => this.sync.accept("*");
			none.onclick = () => this.sync.reject("*");
			extra.push(all, none);
		}
		this.parts.panel.replaceChildren(this.header("Changes", ...extra));
		if (this.sync.changes.length === 0) this.parts.panel.append(el("p", { class: "dp-empty" }, "Nothing to review."));
		for (const change of [...this.sync.changes].reverse()) {
			const item = el("div", { class: "dp-change", "data-change": change.id });
			const who = el("div", { class: "dp-who" });
			who.append(el("span", { class: "dp-av" }, this.initial(change.by)), el("b", {}, this.whoOf(change.by)), new Date(change.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
			if (!this.sync.readOnly) {
				const acts = el("div", { class: "dp-acts" });
				const yes = this.parts.iconButton("check", "Accept", "dp-ib dp-sm dp-yes");
				const no = this.parts.iconButton("x", "Reject", "dp-ib dp-sm dp-no");
				yes.onclick = (event) => (event.stopPropagation(), this.sync.accept(change.id));
				no.onclick = (event) => (event.stopPropagation(), this.sync.reject(change.id));
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
			item.onmouseenter = () => this.hot(change.id, true);
			item.onmouseleave = () => this.hot(change.id, false);
			item.onclick = () => (this.isGoogle() ? this.gview.page : this.live.root).querySelector(`[data-change="${change.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
			this.parts.panel.append(item);
		}
	}

	// --- a Google Doc's comments, kept by Drive ---

	drawCommentsButton(): void {
		this.parts.commentsButton.hidden = !this.isGoogle();
		const n = this.comments.length;
		this.parts.commentsButton.innerHTML = `${svg("comment")}<span>Comments</span>${n ? `<span class="dp-count dp-count-soft">${n}</span>` : ""}`;
	}

	sendComment(action: "create" | "reply" | "resolve", fields: { comment?: string; content?: string; quote?: string }): void {
		this.options.send({ type: "doc.gcomment", path: this.sync.path, client: this.sync.client, action, ...fields });
	}

	newComment(): void {
		const quote = this.gview.quote();
		if (!quote) return;
		this.drafting = quote;
		if (this.view !== "comments") this.show("comments");
		else this.drawComments();
	}

	drawComments(): void {
		const parts: HTMLElement[] = [this.header("Comments")];
		if (this.commentsError) {
			parts.push(el("p", { class: "dp-empty" }, this.commentsError));
			if (this.remote.status?.paste !== undefined || this.options.api) parts.push(...this.remote.signInParts());
		}
		if (this.drafting !== undefined) {
			const box = el("div", { class: "dp-comment dp-comment-new" });
			box.append(el("div", { class: "dp-quote" }, clip(this.drafting, 120)));
			const input = el("textarea", { class: "dp-reply", rows: "3", placeholder: "Comment" });
			const post = el("button", { type: "button", class: "dp-btn dp-sm dp-primary" }, "Comment");
			const cancel = el("button", { type: "button", class: "dp-btn dp-sm" }, "Cancel");
			post.onclick = () => {
				if (!input.value.trim()) return;
				this.sendComment("create", { content: input.value.trim(), quote: this.drafting });
				this.drafting = undefined;
				this.drawComments();
			};
			cancel.onclick = () => {
				this.drafting = undefined;
				this.drawComments();
			};
			const acts = el("div", { class: "dp-comment-acts" });
			acts.append(cancel, post);
			box.append(input, acts);
			parts.push(box);
			setTimeout(() => input.focus(), 0);
		}
		if (!this.commentsError && this.comments.length === 0 && this.drafting === undefined) parts.push(el("p", { class: "dp-empty" }, "No open comments. Select words and press the comment button to add one."));
		for (const c of this.comments) {
			const card = el("div", { class: "dp-comment", "data-comment": c.id });
			const who = (a: GComment["author"], at?: string) => {
				const row = el("div", { class: "dp-who" });
				row.append(el("span", { class: "dp-av" }, this.initial(a?.displayName ?? "?")), el("b", {}, a?.displayName ?? "Someone"), at ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
				return row;
			};
			const head = who(c.author, c.createdTime);
			const resolve = this.parts.iconButton("check", "Resolve", "dp-ib dp-sm dp-yes");
			resolve.onclick = (event) => {
				event.stopPropagation();
				this.sendComment("resolve", { comment: c.id, content: "" });
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
				if (input.value.trim()) this.sendComment("reply", { comment: c.id, content: input.value.trim() });
				input.value = "";
			};
			card.append(form);
			card.onmouseenter = () => this.hotComment(c.id, true);
			card.onmouseleave = () => this.hotComment(c.id, false);
			card.onclick = (event) => {
				if ((event.target as HTMLElement).closest("input, button, textarea")) return;
				this.gview.page.querySelector(`[data-comment="${c.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
			};
			parts.push(card);
		}
		this.parts.panel.replaceChildren(...parts);
	}

	hotComment(id: string, on: boolean): void {
		for (const node of this.gview.page.querySelectorAll<HTMLElement>(`[data-comment="${id}"]`)) node.toggleAttribute("data-hot", on);
	}

	hot(change: string, on: boolean): void {
		for (const node of (this.isGoogle() ? this.gview.page : this.live.root).querySelectorAll<HTMLElement>(`[data-change="${change}"]`)) node.toggleAttribute("data-hot", on);
	}

	// --- one change, from its highlight ---

	showPill(target: HTMLElement): void {
		const id = target.dataset.change!;
		const change = this.sync.changes.find((c) => c.id === id);
		if (!change || this.sync.readOnly || this.viewing) return;
		clearTimeout(this.pillTimer);
		if (this.pillFor !== id) {
			this.pillFor = id;
			const yes = this.parts.iconButton("check", "Accept", "dp-ib dp-sm dp-yes");
			const no = this.parts.iconButton("x", "Reject", "dp-ib dp-sm dp-no");
			yes.onclick = () => (this.sync.accept(id), this.hidePill(true));
			no.onclick = () => (this.sync.reject(id), this.hidePill(true));
			const who = el("span", { class: "p-who" });
			who.append(el("span", { class: "dp-av" }, this.initial(change.by)), el("b", {}, this.whoOf(change.by)), new Date(change.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
			this.parts.pill.replaceChildren(who, yes, no);
		}
		this.parts.pill.hidden = false;
		const box = target.getBoundingClientRect();
		const frame = this.parts.main.getBoundingClientRect();
		const left = Math.max(8, Math.min(box.left - frame.left, frame.width - this.parts.pill.offsetWidth - 8));
		const above = box.top - frame.top - this.parts.pill.offsetHeight - 6;
		this.parts.pill.style.left = `${left}px`;
		this.parts.pill.style.top = `${above < 4 ? box.bottom - frame.top + 6 : above}px`;
		this.hot(id, true);
	}

	hidePill(now = false): void {
		clearTimeout(this.pillTimer);
		const go = () => {
			if (this.pillFor) this.hot(this.pillFor, false);
			this.parts.pill.hidden = true;
			this.pillFor = undefined;
		};
		if (now) go();
		else this.pillTimer = setTimeout(go, 350);
	}

	// --- history: looking at a kept version (page/history.ts) ---

	drawHistory(): void {
		drawHistory(this);
	}

	restoreTo(sha: string): void {
		restoreTo(this, sha);
	}

	openVersion(sha: string, at: number | undefined, source: string): void {
		openVersion(this, sha, at, source);
	}

	closeVersion(redraw = true): void {
		closeVersion(this, redraw);
	}

	/** What the caller holds: the sync, and a way to take the page down. */
	handle(): DocPage {
		return {
			sync: this.sync,
			destroy: () => {
				clearInterval(this.ticker);
				this.reading.destroy();
				this.live.destroy();
				this.viewing?.editor?.destroy();
				this.sync.close();
				this.stop();
				for (const url of this.urls.values()) void url.then((u) => u && URL.revokeObjectURL(u));
			},
		};
	}
}
