import type { DocRemoteStatus, DocServerMessage, Splice } from "../index.ts";
import type { DocSync } from "../client.ts";
import type { DocsRequest } from "../gdoc/types.ts";
import type { Mark } from "./marks.ts";
import type { FormatState, LiveEditor } from "./live.ts";
import type { Reading } from "./reading.ts";
import type { GoogleView } from "./gview.ts";
import type { DocPageOptions } from "./page.ts";
import { m } from "@decks/i18n";
import { base, el, svg } from "./ui.ts";

/**
 * What the panels of a document page share: the file's sync, the three ways of drawing it, the
 * page's frame of elements, the little state more than one panel reads, and the calls one panel
 * makes on another.
 *
 * Each panel (`tools.ts`, `source.ts`, `pdf.ts`, …) is mounted with this and fills in its own calls
 * in `hooks`; `page.ts` mounts them all, so a panel reaches another only through here.
 */

/** Which panel is open at the side: none, the changes waiting for review, the history, or a Doc's comments. */
export type View = "none" | "changes" | "history" | "comments";
/** The page as it reads, or the file's text as it is. */
export type Mode = "page" | "source";
/** Why the text moved, as the sync says it. */
type Why = "open" | "remote" | "local" | "outside" | "review";

type Message<T extends DocServerMessage["type"]> = Extract<DocServerMessage, { type: T }>;

export interface PageContext {
	options: DocPageOptions;
	sync: DocSync;
	/** Markdown and LaTeX, typed into as they read. */
	live: LiveEditor;
	/** A Word file, drawn by docx-preview. */
	reading: Reading;
	/** A Google Doc, as Google lays it out. */
	gview: GoogleView;
	dom: PageDom;
	/** The words each waiting change touched, kept in step with the text: every view highlights them. */
	marks: Mark[];
	mode: Mode;
	view: View;
	isGoogle(): boolean;
	isWord(): boolean;
	isTex(): boolean;
	/** Call `fn` with every message of this type about this page's file, after the sync has taken it. */
	on<T extends DocServerMessage["type"]>(type: T, fn: (message: Message<T>) => void): void;
	hooks: PageHooks;
}

/** The calls one panel makes on another, each filled in by the panel named beside it. */
export interface PageHooks {
	/** `page.ts`: the text moved; every view follows it. */
	updated(why: Why, applied?: readonly Splice[]): void;
	/** `page.ts`: the status and the Changes count, as they stand. */
	refresh(): void;
	/** `page.ts`: open a side panel, or close it when it is the one open. */
	show(view: View): void;
	/** `page.ts`: a side panel's header, with its title, any buttons, and a close. */
	header(title: string, ...extra: HTMLElement[]): HTMLElement;
	/** `tools.ts`: the toolbar for the kind of file this is. */
	buildTools(): void;
	/** `tools.ts`: the markdown or LaTeX tools show the styles at the caret. */
	pressed(state: FormatState): void;
	/** `tools.ts`: a Google Doc's tools show the styles at the caret. */
	gpressed(): void;
	/** `tools.ts`: ask for a link and put it on a Doc's selected words. */
	askLink(): void;
	/** `source.ts`: show the page or the file's text. */
	setMode(next: Mode): void;
	/** `source.ts`: draw the file's text again, keeping the caret where it was unless told not to. */
	draw(keepCaret?: boolean): void;
	/** `source.ts`: draw the file's text again after others' splices, the caret moved past them. */
	drawShifted(applied: readonly Splice[]): void;
	/** `page.ts`: draw the Changes panel, or only when the list in it changed. */
	drawChanges(onlyIfChanged?: boolean): void;
	/** `page.ts`: draw a Doc's comments panel. */
	drawComments(): void;
	/** `page.ts`: the Comments button, shown for a Doc, with its count. */
	drawCommentsButton(): void;
	/** `page.ts`: start a comment on the selected words. */
	newComment(): void;
	/** `history.ts`: whether a kept version is shown instead of the page. */
	isViewing(): boolean;
	/** `history.ts`: back from a kept version to the page as it is now. */
	closeVersion(): void;
	/** `pdf.ts`: typeset again once typing has paused, when the PDF is open. */
	compileSoon(): void;
	/** `google.ts`: send a Doc's styles to Google once the typing before them has gone. */
	sendStyle(requests: DocsRequest[]): void;
	/** `google.ts`: the Google Docs button and its popover. */
	drawGoogle(): void;
	/** `google.ts`: signing in to Google. */
	signInParts(): HTMLElement[];
	/** `google.ts`: how the Doc's link stands, as the server last said. */
	remoteStatus(): DocRemoteStatus | undefined;
}

/** The elements the page is built of that more than one panel touches. */
export interface PageDom {
	bar: HTMLElement;
	name: HTMLElement;
	status: HTMLElement;
	changesButton: HTMLButtonElement;
	commentsButton: HTMLButtonElement;
	/** Git: shown once the server says the file is in a repository, with Pull and Push in a popover. */
	gitBox: HTMLElement;
	/** A Google Doc: where it lives, how the link stands, and signing in; in place of Git, which a Doc has none of. */
	googleBox: HTMLElement;
	pdfButton: HTMLButtonElement;
	sourceButton: HTMLButtonElement;
	historyButton: HTMLButtonElement;
	tools: HTMLElement;
	main: HTMLElement;
	scroll: HTMLElement;
	/** The file's text, for Source. */
	text: HTMLElement;
	panel: HTMLElement;
	banner: HTMLElement;
	/** A kept version of a Doc or a Word file, read as its words. */
	old: HTMLElement;
	pill: HTMLElement;
	divider: HTMLElement;
	pdfPane: HTMLElement;
}

/** Build the page's frame into `host`: the bar, the tools' row, and the main area with its panes. */
export function pageDom(host: HTMLElement, path: string): PageDom {
	host.classList.add("dp");
	host.replaceChildren();
	const labelled = (icon: string, label: string, title: string) => {
		const b = el("button", { type: "button", class: "dp-btn", title, "aria-pressed": "false" });
		b.innerHTML = `${svg(icon)}<span>${label}</span>`;
		return b;
	};
	const bar = el("div", { class: "dp-bar" });
	const name = el("span", { class: "dp-name" }, base(path));
	const status = el("span", { class: "dp-status" }, m.docs_opening());
	const spacer = el("span", { class: "dp-spacer" });
	const sourceButton = labelled("source", m.docs_source(), m.docs_source_title());
	const historyButton = labelled("clock", m.docs_history(), m.docs_history_title());
	const pdfButton = labelled("pdf", "PDF", m.docs_pdf_title());
	pdfButton.hidden = true;
	const changesButton = el("button", { type: "button", class: "dp-btn dp-changes", "aria-pressed": "false", title: m.docs_changes_title(), hidden: "" });
	const commentsButton = el("button", { type: "button", class: "dp-btn", "aria-pressed": "false", title: m.docs_comments_title(), hidden: "" });
	const gitBox = el("div", { class: "dp-git", hidden: "" });
	const googleBox = el("div", { class: "dp-git", hidden: "" });
	bar.append(name, status, spacer, changesButton, commentsButton, gitBox, googleBox, pdfButton, sourceButton, historyButton);
	const tools = el("div", { class: "dp-tools", hidden: "" });
	const main = el("div", { class: "dp-main" });
	const scroll = el("div", { class: "dp-scroll" });
	const text = el("div", { class: "dp-text", spellcheck: "false", hidden: "" });
	const panel = el("div", { class: "dp-panel", hidden: "" });
	const banner = el("div", { class: "dp-banner", hidden: "" });
	const old = el("div", { class: "dp-old", hidden: "" });
	const pill = el("div", { class: "dp-pill", hidden: "" });
	scroll.append(banner, text);
	const divider = el("div", { class: "dp-divider", hidden: "", role: "separator", "aria-orientation": "vertical", title: m.docs_drag_resize() });
	const pdfPane = el("div", { class: "dp-pdf", hidden: "" });
	main.append(scroll, divider, pdfPane, panel, pill);
	host.append(bar, tools, main);
	return { bar, name, status, changesButton, commentsButton, gitBox, googleBox, pdfButton, sourceButton, historyButton, tools, main, scroll, text, panel, banner, old, pill, divider, pdfPane };
}
