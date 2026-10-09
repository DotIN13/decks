import type { CompileError, DocClientMessage, DocRemoteStatus, GitStatus, DocServerMessage, DocVersion, Splice } from "../index.ts";
import { DocSync } from "../client.ts";
import { spliceDiff } from "../merge.ts";
import type { DocSync as Sync } from "../client.ts";
import { docxBlocks, readParagraph } from "./blocks.ts";
import { findMarks, marksOf, segments, shiftMarks, spliceBetween, type Mark } from "./marks.ts";
import { LiveEditor, type BlockStyle, type FormatState, type InlineStyle } from "./live.ts";
import { Reading } from "./reading.ts";
import { GoogleView } from "./gview.ts";
import type { DocsRequest } from "../gdoc/types.ts";

/**
 * `@decks/docs/page`: a document drawn as a page you type into, in plain DOM.
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

const ICON: Record<string, string> = {
	bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
	italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
	strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>',
	underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
	code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
	mark: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
	link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
	math: '<path d="M18 7V4H6l6 8-6 8h12v-3"/>',
	ul: '<line x1="9" x2="21" y1="6" y2="6"/><line x1="9" x2="21" y1="12" y2="12"/><line x1="9" x2="21" y1="18" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
	ol: '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
	task: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
	quote: '<path d="M17 6H3"/><path d="M21 12H8"/><path d="M21 18H8"/><path d="M3 12v6"/>',
	codeblock: '<path d="m10 9-3 3 3 3"/><path d="m14 15 3-3-3-3"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
	hr: '<path d="M5 12h14"/>',
	table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/>',
	undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
	redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
	display: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M16 8.9V7H8l4 5-4 5h8v-1.9"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
	source: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
	changes: '<path d="M12 20h9"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	restore: '<path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
	chevron: '<path d="m6 9 6 6 6-6"/>',
	pdf: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14 3v18"/>',
	refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.8L21 8"/><path d="M21 3v5h-5"/>',
	external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
	alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
	branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
	pull: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
	push: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
	comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
	rowabove: '<rect x="3" y="12" width="18" height="9" rx="1"/><path d="M12 3v6"/><path d="M9 6h6"/>',
	rowbelow: '<rect x="3" y="3" width="18" height="9" rx="1"/><path d="M12 15v6"/><path d="M9 18h6"/>',
	colleft: '<rect x="12" y="3" width="9" height="18" rx="1"/><path d="M3 12h6"/><path d="M6 9v6"/>',
	colright: '<rect x="3" y="3" width="9" height="18" rx="1"/><path d="M15 12h6"/><path d="M18 9v6"/>',
	rowdelete: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="m9 10 6 4"/><path d="m15 10-6 4"/>',
	coldelete: '<rect x="8" y="3" width="8" height="18" rx="1"/><path d="m10 9 4 6"/><path d="m14 9-4 6"/>',
	alignleft: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>',
	aligncenter: '<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>',
	alignright: '<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>',
	justify: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
	textcolour: '<path d="M4 20h16" stroke-width="3"/><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/>',
	clear: '<path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5"/><path d="m20 15-5 5"/>',
	minus: '<path d="M5 12h14"/>',
	indent: '<path d="M21 6H11"/><path d="M21 12H11"/><path d="M21 18H11"/><path d="m3 8 4 4-4 4"/>',
	outdent: '<path d="M21 6H11"/><path d="M21 12H11"/><path d="M21 18H11"/><path d="m7 8-4 4 4 4"/>',
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
	cloudoff: '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.2 5.15"/>',
};
/** A comment on a Google Doc, as Drive answers it. */
interface GComment {
	id: string;
	content: string;
	author?: { displayName?: string; me?: boolean };
	createdTime?: string;
	quotedFileContent?: { value?: string };
	replies?: Array<{ id: string; content?: string; author?: { displayName?: string }; createdTime?: string }>;
}

const svg = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name] ?? ""}</svg>`;

const STYLE = `
.dp { --dp-r: 6px; --dp-h: 30px; /* The panel header and the old-version strip sit side by side, so they share one height. */ --dp-strip: 48px; --dp-ink: var(--b-fg, #111); --dp-line: var(--b-border-strong, #d4d4d4); --dp-hair: var(--b-border, #e6e6e6); --dp-hover: color-mix(in srgb, var(--b-fg, #111) 7%, transparent); --dp-shadow: 0 2px 4px rgba(0,0,0,.08), 0 10px 28px rgba(0,0,0,.16);
	position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--b-bg, #fff); color: var(--dp-ink); font-family: var(--b-font, system-ui, sans-serif); -webkit-font-smoothing: antialiased; }
.dp button { font: inherit; color: inherit; -webkit-tap-highlight-color: transparent; }
.dp svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }

/* One button system, drawn in ink: a square icon button, a labelled button, a solid primary. */
.dp-ib, .dp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: var(--dp-h); border: 1px solid var(--dp-line); border-radius: var(--dp-r); background: var(--b-bg, #fff); color: var(--dp-ink); cursor: pointer; white-space: nowrap; transition: background .1s, color .1s, border-color .1s; }
.dp-ib { width: var(--dp-h); padding: 0; }
.dp-btn { padding: 0 11px; font-size: 13px; font-weight: 600; letter-spacing: -.005em; }
.dp-ib:hover, .dp-btn:hover { background: var(--dp-hover); }
.dp-ib:active, .dp-btn:active { background: color-mix(in srgb, var(--dp-ink) 12%, transparent); }
.dp-ib:hover, .dp-btn:hover { border-color: color-mix(in srgb, var(--dp-ink) 32%, transparent); }
.dp-ib[aria-pressed="true"], .dp-btn[aria-pressed="true"] { background: var(--b-accent, #2563eb); border-color: var(--b-accent, #2563eb); color: #fff; }
/* In the styling row the tools are bare: no border, solid accent when on. */
.dp-tools .dp-ib, .dp-tools .dp-btn { border-color: transparent; background: transparent; }
.dp-tools .dp-ib:hover { background: var(--dp-hover); }
.dp-tools .dp-ib[aria-pressed="true"] { background: var(--b-accent, #2563eb); color: #fff; }
.dp-ib:focus-visible, .dp-btn:focus-visible { outline: 2px solid var(--b-accent, #2563eb); outline-offset: 1px; }
.dp-ib[hidden], .dp-btn[hidden] { display: none; }
.dp-btn.dp-primary { background: var(--b-accent, #2563eb); border-color: var(--b-accent, #2563eb); color: #fff; }
.dp-btn.dp-primary:hover { background: color-mix(in srgb, var(--b-accent, #2563eb) 86%, #000); }
.dp-btn.dp-outline { color: var(--b-accent, #2563eb); border-color: color-mix(in srgb, var(--b-accent, #2563eb) 45%, transparent); }
.dp-btn.dp-outline:hover { background: color-mix(in srgb, var(--b-accent, #2563eb) 10%, var(--b-bg, #fff)); border-color: var(--b-accent, #2563eb); }
.dp-btn.dp-sm { height: 26px; padding: 0 9px; font-size: 12.5px; }
.dp-ib.dp-sm { width: 26px; height: 26px; }
.dp-ib.dp-sm svg { width: 14px; height: 14px; }
.dp-ib.dp-yes { color: var(--b-ok, #15803d); }
.dp-ib.dp-no { color: var(--b-danger, #b91c1c); }
.dp-ib.dp-yes:hover { background: color-mix(in srgb, var(--b-ok, #15803d) 12%, var(--b-bg, #fff)); border-color: var(--b-ok, #15803d); }
.dp-ib.dp-no:hover { background: color-mix(in srgb, var(--b-danger, #b91c1c) 11%, var(--b-bg, #fff)); border-color: var(--b-danger, #b91c1c); }
.dp-count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 4px; background: var(--b-bg, #fff); color: var(--dp-ink); font-size: 11px; font-weight: 700; display: inline-grid; place-items: center; font-variant-numeric: tabular-nums; }

/* The bar: the file's name and state, and the three views. */
.dp-bar { display: flex; align-items: center; gap: 6px; height: 46px; padding: 0 10px 0 16px; flex: none; min-width: 0; border-bottom: 1px solid var(--dp-hair); }
.dp-name { font-weight: 700; font-size: 14px; letter-spacing: -.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; }
.dp-status { margin-left: 8px; color: var(--b-muted, #666); white-space: nowrap; font-size: 12.5px; font-weight: 500; }
.dp-status[data-state="saving"] { color: var(--b-warn, #b45309); }
.dp-status[data-state="error"] { color: var(--b-danger, #b91c1c); }
.dp-bar:has(+ .dp-tools[hidden]) { border-bottom-color: var(--dp-line); }
.dp-spacer { flex: 1; }
.dp-btn .dp-count { background: var(--b-accent, #2563eb); color: #fff; }
/* The bar's buttons are quiet: no border, ink icons, an accent tint when open; Changes is tinted while edits wait. */
.dp-bar .dp-btn { border-color: transparent; background: transparent; }
.dp-bar .dp-btn:hover { background: var(--dp-hover); border-color: transparent; }
.dp-bar .dp-btn[aria-pressed="true"] { background: color-mix(in srgb, var(--b-accent, #2563eb) 12%, transparent); border-color: transparent; color: var(--b-accent, #2563eb); }
.dp-bar .dp-btn.dp-changes { color: var(--b-accent, #2563eb); background: color-mix(in srgb, var(--b-accent, #2563eb) 10%, transparent); }
.dp-bar .dp-btn.dp-changes:hover { background: color-mix(in srgb, var(--b-accent, #2563eb) 16%, transparent); }
.dp-bar .dp-btn.dp-changes[aria-pressed="true"] { background: color-mix(in srgb, var(--b-accent, #2563eb) 20%, transparent); }

/* The styles: a band of bordered groups. */
.dp-tools { display: flex; align-items: center; gap: 8px; padding: 6px 12px; flex: none; flex-wrap: wrap; background: var(--b-bg-deep, #f6f6f6); border-bottom: 1px solid var(--dp-line); }
.dp-tools[hidden] { display: none; }
.dp-group { display: inline-flex; gap: 2px; padding-right: 9px; margin-right: 1px; border-right: 1px solid var(--dp-line); }
.dp-group:last-child { border-right: 0; padding-right: 0; }
.dp-style { position: relative; }
.dp-git { position: relative; display: flex; }
.dp-git[hidden] { display: none; }
.dp-git .dp-ahead { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
.dp-gitmenu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 10; background: var(--b-bg, #fff); border: 1px solid var(--dp-line); border-radius: 8px; box-shadow: var(--dp-shadow); width: 300px; padding: 14px; display: grid; gap: 10px; cursor: default; }
.dp-gitmenu .g-where { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 6px; }
.dp-gitmenu .g-where svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.dp-gitmenu .g-remote { font-family: var(--b-mono, monospace); font-size: 11.5px; color: var(--b-muted, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-gitmenu .g-state { font-size: 13px; color: var(--b-muted, #666); line-height: 1.4; }
.dp-gitmenu .g-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dp-gitmenu .g-acts .dp-btn { justify-content: center; height: 32px; }
.dp-bar .dp-gitmenu .dp-btn.dp-primary { background: var(--b-accent, #2563eb); border-color: var(--b-accent, #2563eb); color: #fff; }
.dp-bar .dp-gitmenu .dp-btn.dp-primary:hover { background: color-mix(in srgb, var(--b-accent, #2563eb) 86%, #000); }
.dp-bar .dp-gitmenu .dp-btn.dp-outline { color: var(--b-accent, #2563eb); border-color: color-mix(in srgb, var(--b-accent, #2563eb) 45%, transparent); background: transparent; }
.dp-bar .dp-gitmenu .dp-btn.dp-outline:hover { background: color-mix(in srgb, var(--b-accent, #2563eb) 10%, var(--b-bg, #fff)); border-color: var(--b-accent, #2563eb); }
.dp-gitmenu .g-acts .dp-btn:disabled { opacity: .55; cursor: progress; }
.dp-gitmenu .g-said { font-size: 13px; line-height: 1.4; padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--b-ok, #16a34a) 10%, transparent); }
.dp-gitmenu .g-said[data-ok="false"] { background: color-mix(in srgb, var(--b-danger, #dc2626) 10%, transparent); color: var(--b-danger, #dc2626); }
.dp-gitmenu .g-said[hidden], .dp-gitmenu[hidden] { display: none; }
.dp-gitmenu .g-note { font-size: 12px; color: var(--b-faint, #999); line-height: 1.4; }
.dp-gitmenu a.g-open { color: var(--b-accent, #2563eb); font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
.dp-gitmenu a.g-open:hover { text-decoration: underline; }
.dp-gitmenu a.g-open svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.dp-gitmenu .g-paste { display: grid; grid-template-columns: 1fr auto; gap: 6px; }
.dp-gitmenu .g-paste input { min-width: 0; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--dp-line); border-radius: 6px; background: var(--b-bg, #fff); color: inherit; }
.gd { background: #f0f2f5; min-height: 100%; padding: 22px 16px 60px; display: flex; justify-content: center; box-sizing: border-box; }
.gd[data-pageless] { background: #fff; padding: 0; }
/* Pages are the paper drawn every page-height with a gap (gview's paginate); the shadow follows each page's edge. */
.gd-page { box-sizing: border-box; flex: none; max-width: 100%; background: #fff; filter: drop-shadow(0 1px 1.5px rgba(60, 64, 67, .28)); color: #000; font-family: Arial, sans-serif; font-size: 14.67px; line-height: 1.15; white-space: pre-wrap; overflow-wrap: break-word; outline: none; caret-color: #000; }
.gd[data-pageless] .gd-page { min-height: 0; filter: none; width: auto; flex: 1; }
.gd-page .gd-p { margin: 0; font-weight: inherit; font-size: inherit; letter-spacing: normal; }
.gd-page h1.gd-p, .gd-page h2.gd-p, .gd-page h3.gd-p, .gd-page h4.gd-p, .gd-page h5.gd-p, .gd-page h6.gd-p { font-weight: 400; }
.gd-page a { color: rgb(17, 85, 204); }
.gd-page .gd-marker { display: inline-block; text-indent: 0; white-space: nowrap; user-select: none; }
.gd-page .gd-table { border-collapse: collapse; margin: 0; table-layout: fixed; width: 100%; }
.gd-page .gd-cell { border: 1px solid #000; vertical-align: top; }
.gd-page img[data-obj] { vertical-align: bottom; max-width: 100%; }
.gd-page .gd-hr { display: inline-block; width: 100%; border-top: 1px solid #a0a0a0; vertical-align: middle; }
.gd-page .gd-break { display: block; border-top: 1px dashed #c0c0c0; margin: 10px 0; }
.gd-page .gd-chip { background: #f1f3f4; border-radius: 12px; padding: 0 6px; }
.gd-page .lv-hl { background: color-mix(in srgb, var(--b-accent, #2563eb) 18%, transparent); box-shadow: 0 1.5px 0 color-mix(in srgb, var(--b-accent, #2563eb) 55%, transparent); border-radius: 2px; }
.gd-page .lv-hl[data-hot] { background: color-mix(in srgb, var(--b-accent, #2563eb) 30%, transparent); }
.gd-page .gd-sug-ins { color: rgb(20, 120, 60); text-decoration: underline; text-decoration-color: rgb(20, 120, 60); }
.gd-page .gd-sug-del { color: rgb(180, 40, 40); text-decoration: line-through; }
.gd-page .gd-commented { background: rgba(255, 212, 0, .32); border-bottom: 2px solid rgba(230, 180, 0, .9); cursor: pointer; }
.gd-page .gd-commented[data-hot] { background: rgba(255, 196, 0, .55); }
.dp-count-soft { background: color-mix(in srgb, var(--b-fg, #000) 10%, transparent) !important; color: inherit !important; }
.dp-comment { padding: 12px 14px; border-bottom: 1px solid var(--dp-hair); display: grid; gap: 6px; cursor: default; }
.dp-comment:hover { background: color-mix(in srgb, var(--b-accent, #2563eb) 4%, transparent); }
.dp-comment .dp-quote { font-size: 12.5px; color: var(--b-muted, #666); border-left: 3px solid rgba(230, 180, 0, .9); padding-left: 8px; white-space: pre-wrap; }
.dp-comment .dp-comment-body { font-size: 14px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
.dp-comment .dp-reply-row { display: flex; }
.dp-comment .dp-reply, .dp-comment-new .dp-reply { flex: 1; min-width: 0; font: inherit; font-size: 13px; padding: 6px 8px; border: 1px solid var(--dp-line); border-radius: 6px; background: var(--b-bg, #fff); color: inherit; resize: vertical; }
.dp-comment-acts { display: flex; gap: 6px; justify-content: flex-end; }
.dp-panel .g-paste { display: grid; grid-template-columns: 1fr auto; gap: 6px; margin: 8px 14px; }
.dp-panel .g-paste input { min-width: 0; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 1px solid var(--dp-line); border-radius: 6px; background: var(--b-bg, #fff); color: inherit; }
.dp-panel > .dp-btn.dp-primary { margin: 4px 14px; }
.dp-panel .g-note { margin: 4px 14px; font-size: 12px; color: var(--b-muted, #666); }
.gd-page .gd-gap { display: block; user-select: none; }
.gd-page .gd-sup { vertical-align: super; font-size: .66em; background: none; padding: 0; }
.dp-tools .dp-select { height: 30px; max-width: 130px; padding: 0 6px; font: inherit; font-size: 13px; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer; }
.dp-tools .dp-select:hover { background: var(--dp-hover); }
.dp-tools .dp-size { width: 34px; height: 26px; text-align: center; font: inherit; font-size: 13px; color: inherit; background: transparent; border: 1px solid var(--dp-line); border-radius: 4px; }
.dp-tools .dp-ib { position: relative; }
.dp-tools .dp-colour { position: absolute; inset: auto 0 0 0; width: 100%; height: 0; padding: 0; border: 0; opacity: 0; pointer-events: none; }
.dp-git .dp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--b-ok, #16a34a); flex: none; }
.dp-git .dp-dot[data-state="syncing"] { background: var(--b-accent, #2563eb); }
.dp-git .dp-dot[data-state="error"], .dp-git .dp-dot[data-state="signin"] { background: var(--b-warn, #d97706); }
.dp-style > .dp-btn { width: 136px; height: 30px; justify-content: space-between; padding: 0 8px 0 10px; }
.dp-style { padding-right: 9px; border-right: 1px solid var(--dp-line); }
.dp-style > .dp-btn svg { width: 14px; height: 14px; }
.dp-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 10; min-width: 210px; padding: 4px; background: var(--b-bg, #fff); border: 1px solid var(--dp-line); border-radius: 8px; box-shadow: var(--dp-shadow); }
.dp-menu[hidden] { display: none; }
.dp-menu button { display: flex; align-items: center; width: 100%; min-height: 32px; padding: 4px 10px; border: 0; border-radius: 4px; background: transparent; cursor: pointer; text-align: left; line-height: 1.2; }
.dp-menu button[aria-checked="true"] { color: var(--b-accent, #2563eb); }
.dp-menu button:hover { background: var(--b-accent, #2563eb); color: #fff; }
.dp-menu button[aria-checked="true"]::after { content: ""; margin-left: auto; width: 14px; height: 14px; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / contain no-repeat; }
.dp-menu .m-p { font-size: 14px; }
.dp-menu .m-h1 { font-size: 20px; font-weight: 700; }
.dp-menu .m-h2 { font-size: 17px; font-weight: 700; }
.dp-menu .m-h3 { font-size: 15px; font-weight: 700; }
.dp-menu .m-h4, .dp-menu .m-h5, .dp-menu .m-h6 { font-size: 13.5px; font-weight: 700; }

.dp-main { position: relative; flex: 1; min-height: 0; display: flex; }
.dp-scroll { flex: 1; min-width: 0; overflow: auto; }
.dp-text { box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 28px 40px 80px; min-height: 100%; outline: none; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--b-mono, ui-monospace, monospace); font-size: 14px; line-height: 1.6; tab-size: 4; }
.dp-text[hidden] { display: none; }
.dp-ins { background: color-mix(in srgb, var(--b-accent, #2563eb) 16%, transparent); border-radius: 2px; }

/* The PDF beside a LaTeX page: a divider to drag, a bar saying how the last typesetting went, and the pages. */
.dp-divider { flex: none; width: 7px; margin: 0 -3px; z-index: 2; cursor: col-resize; position: relative; }
.dp-divider::after { content: ""; position: absolute; inset: 0 3px; background: var(--dp-line); transition: background .1s; }
.dp-divider:hover::after, .dp-divider[data-drag]::after { background: var(--b-accent, #2563eb); inset: 0 2px; }
.dp-divider[hidden], .dp-pdf[hidden] { display: none; }
.dp-pdf { flex: none; width: var(--pdf-w, 46%); min-width: 260px; display: flex; flex-direction: column; background: var(--b-bg-deep, #f4f4f4); }
.dp-pdfbar { flex: none; display: flex; align-items: center; gap: 6px; height: var(--dp-strip); box-sizing: border-box; padding: 0 8px 0 14px; border-bottom: 1px solid var(--dp-line); background: var(--b-bg, #fff); font-size: 13px; white-space: nowrap; }
.dp-pdfstate { color: var(--b-muted, #666); overflow: hidden; text-overflow: ellipsis; flex: 1; font-variant-numeric: tabular-nums; }
.dp-pdfstate b { color: var(--dp-ink); font-weight: 700; margin-right: 6px; }
.dp-pdfstate[data-state="busy"]::before { content: ""; display: inline-block; width: 10px; height: 10px; margin-right: 7px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--b-accent, #2563eb) 30%, transparent); border-top-color: var(--b-accent, #2563eb); vertical-align: -1px; animation: dp-spin .8s linear infinite; }
@keyframes dp-spin { to { transform: rotate(360deg); } }
.dp-pdfbar .dp-btn.dp-errs { color: var(--b-danger, #b91c1c); border-color: color-mix(in srgb, var(--b-danger, #b91c1c) 45%, transparent); }
.dp-pdfbar .dp-btn.dp-errs[aria-pressed="true"] { background: var(--b-danger, #b91c1c); border-color: var(--b-danger, #b91c1c); color: #fff; }
.dp-errlist { flex: none; max-height: 40%; overflow: auto; background: var(--b-bg, #fff); border-bottom: 1px solid var(--dp-line); }
.dp-errlist[hidden] { display: none; }
.dp-err { display: flex; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--dp-hair); cursor: pointer; font-size: 13px; line-height: 1.45; }
.dp-err:hover { background: var(--b-bg-deep, #f6f6f6); box-shadow: inset 3px 0 0 var(--b-danger, #b91c1c); }
.dp-err .e-line { flex: none; color: var(--b-danger, #b91c1c); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 52px; }
.dp-err .e-msg { font-family: var(--b-mono, ui-monospace, monospace); font-size: 12.5px; overflow-wrap: anywhere; }
.dp-pdfbody { flex: 1; min-height: 0; overflow: auto; padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.dp-pdfbody .page { width: 100%; height: auto; display: block; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 4px 14px rgba(0,0,0,.08); }
.dp-pdfempty { margin: auto; text-align: center; color: var(--b-muted, #666); font-size: 14px; max-width: 280px; line-height: 1.5; }
.dp-pdfbody[data-stale] .page { opacity: .55; transition: opacity .2s; }

/* The side panel: changes to review, or kept versions. */
.dp-panel { flex: none; width: 310px; border-left: 1px solid var(--dp-line); overflow: auto; background: var(--b-bg, #fff); display: flex; flex-direction: column; }
.dp-panel[hidden] { display: none; }
.dp-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; height: var(--dp-strip); box-sizing: border-box; padding: 0 10px 0 16px; background: var(--b-bg, #fff); border-bottom: 1px solid var(--dp-line); flex: none; }
.dp-head h3 { margin: 0; flex: 1; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
.dp-empty { color: var(--b-muted, #666); font-size: 13px; line-height: 1.5; padding: 14px 16px; margin: 0; }
.dp-change { position: relative; flex: none; padding: 12px 12px 12px 16px; border-bottom: 1px solid var(--dp-hair); cursor: pointer; }
.dp-change:hover, .dp-change[data-hot] { background: var(--b-bg-deep, #f6f6f6); box-shadow: inset 3px 0 0 var(--b-accent, #2563eb); }
.dp-who { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--b-muted, #666); font-variant-numeric: tabular-nums; }
.dp-who b { color: var(--dp-ink); font-weight: 700; font-size: 13px; }
.dp-av { width: 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 10.5px; font-weight: 700; color: #fff; background: var(--b-accent, #2563eb); flex: none; }
.dp-who .dp-acts { margin-left: auto; display: flex; gap: 4px; }
.dp-snip { margin: 8px 0 0 28px; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; color: var(--dp-ink); }
.dp-snip ins { text-decoration: none; background: color-mix(in srgb, var(--b-accent, #2563eb) 16%, transparent); border-bottom: 1.5px solid var(--b-accent, #2563eb); padding: 0 1px; }
.dp-snip del { color: var(--b-danger, #b91c1c); }
.dp-time { position: relative; flex: none; display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--dp-hair); cursor: pointer; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; }
.dp-time::before { content: ""; width: 7px; height: 7px; border-radius: 1px; border: 1.5px solid var(--b-muted, #888); flex: none; }
.dp-time.t-latest::before { background: var(--b-accent, #2563eb); border-color: var(--b-accent, #2563eb); }
.dp-time:hover { background: var(--b-bg-deep, #f6f6f6); }
.dp-time[aria-current="true"] { background: color-mix(in srgb, var(--b-accent, #2563eb) 9%, transparent); box-shadow: inset 3px 0 0 var(--b-accent, #2563eb); font-weight: 700; }
.dp-time .t-when { flex: 1; }
.dp-time .t-when small { color: var(--b-muted, #777); margin-left: 6px; font-size: 12px; font-weight: 500; }
.dp-time .dp-ib { visibility: hidden; }
.dp-time:hover .dp-ib, .dp-time[aria-current="true"] .dp-ib { visibility: visible; }

/* Accept or reject, over the highlight: a small card in the page's own colours. */
.dp-pill { position: absolute; z-index: 5; display: flex; align-items: center; gap: 2px; padding: 3px 3px 3px 8px; background: var(--b-bg, #fff); color: var(--dp-ink); border: 1px solid var(--dp-line); border-radius: 8px; box-shadow: var(--dp-shadow); font-size: 12.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dp-pill[hidden] { display: none; }
.dp-pill .p-who { display: inline-flex; align-items: center; gap: 6px; margin-right: 6px; color: var(--b-muted, #666); }
.dp-pill .p-who b { color: var(--dp-ink); font-weight: 700; }
.dp-pill .dp-av { width: 18px; height: 18px; font-size: 10px; }

/* Looking at a kept version: a tinted strip in the page's colours, so it cannot pass for the page as it is. */
.dp-banner { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; gap: 8px; height: var(--dp-strip); box-sizing: border-box; padding: 0 10px 0 16px; background: color-mix(in srgb, var(--b-accent, #2563eb) 12%, var(--b-bg, #fff)); color: var(--dp-ink); border-bottom: 1px solid color-mix(in srgb, var(--b-accent, #2563eb) 35%, transparent); font-size: 13px; white-space: nowrap; }
.dp-banner[hidden] { display: none; }
.dp-banner > svg { color: var(--b-accent, #2563eb); }
.dp-banner b { font-weight: 700; font-variant-numeric: tabular-nums; }
.dp-old { box-sizing: border-box; max-width: 780px; margin: 0 auto; padding: 28px 48px 80px; white-space: pre-wrap; font-size: 16px; line-height: 1.65; }
.dp-old[hidden] { display: none; }
.lv[data-preview] .lv-hl { background: color-mix(in srgb, var(--b-warn, #d97706) 20%, transparent); box-shadow: 0 1.5px 0 color-mix(in srgb, var(--b-warn, #d97706) 60%, transparent); animation: none; }
.lv[data-preview] .lv-hl-line { background: color-mix(in srgb, var(--b-warn, #d97706) 9%, transparent); box-shadow: inset 3px 0 0 var(--b-warn, #d97706); animation: none; }
.lv .lv-hl[data-hot], .lv .lv-hl-line[data-hot] { background: color-mix(in srgb, var(--b-accent, #2563eb) 30%, transparent); }

/* The live page: the file's own text, drawn as it reads. */
.lv { box-sizing: border-box; max-width: 780px; margin: 0 auto; padding: 36px 48px 120px; min-height: 100%; outline: none; white-space: pre-wrap; overflow-wrap: break-word; font-size: 16.5px; line-height: 1.7; tab-size: 4; caret-color: var(--b-accent, #2563eb); font-family: var(--b-font, system-ui, sans-serif); }
.lv[hidden] { display: none; }
.lv[data-tex] { font-family: "Latin Modern Roman", "CMU Serif", Georgia, "Times New Roman", serif; font-size: 17.5px; }
.lv .lv-mk { display: none; color: var(--b-faint, #9a9a9a); font-weight: 400; font-style: normal; font-family: var(--b-mono, ui-monospace, monospace); font-size: .86em; text-decoration: none; }
.lv .open > .lv-mk { display: inline; }
.lv .lv-src { display: none; }
.lv .lv-chunk.open div.lv-src { display: block; }
.lv .lv-i.open > .lv-src { display: inline; color: var(--b-muted, #666); font-family: var(--b-mono, ui-monospace, monospace); font-size: .88em; }
.lv .lv-w { user-select: none; }
.lv .lv-line { min-height: 1.7em; }
.lv .lv-blank { min-height: 0; height: .9em; line-height: .9em; overflow: hidden; }
.lv .lv-blank.open { height: auto; min-height: 1.7em; line-height: 1.7; }
.lv .lv-end { min-height: 1.7em; }
.lv .lv-placeholder::before { content: attr(data-placeholder); color: var(--b-faint, #aaa); pointer-events: none; position: absolute; }
.lv .lv-h1, .lv .lv-h2, .lv .lv-h3, .lv .lv-h4, .lv .lv-h5, .lv .lv-h6 { font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
.lv .lv-h1 { font-size: 2em; margin: .3em 0 .15em; }
.lv .lv-h2 { font-size: 1.5em; margin: .5em 0 .1em; padding-bottom: .15em; border-bottom: 1px solid var(--b-border, #e8e8e8); }
.lv .lv-h3 { font-size: 1.25em; margin: .4em 0 .05em; }
.lv .lv-h4 { font-size: 1.08em; }
.lv .lv-h5, .lv .lv-h6 { font-size: 1em; color: var(--b-muted, #555); }
.lv .lv-h1 > .lv-mk, .lv .lv-h2 > .lv-mk, .lv .lv-h3 > .lv-mk { font-size: .6em; vertical-align: middle; }
.lv .lv-hr { height: 1.7em; background: linear-gradient(var(--b-border-strong, #ccc), var(--b-border-strong, #ccc)) center / 100% 1px no-repeat; }
.lv .lv-hr.open { background: none; }
.lv .lv-quote { padding-left: calc(var(--depth, 1) * 16px); box-shadow: inset 3px 0 0 var(--b-border-strong, #d4d4d4); color: var(--b-muted, #555); }
.lv .lv-quote.open { padding-left: 8px; }
.lv .lv-li { position: relative; padding-left: calc(var(--indent, 0) * 24px + 26px); }
.lv .lv-ul:not(.open)::before { content: "•"; position: absolute; left: calc(var(--indent, 0) * 24px + 8px); color: var(--b-muted, #555); }
.lv .lv-ul.open { padding-left: calc(var(--indent, 0) * 24px); }
.lv .lv-ol { padding-left: calc(var(--indent, 0) * 24px + 6px); }
.lv .lv-num { color: var(--b-muted, #555); font-variant-numeric: tabular-nums; }
.lv .lv-ol:not(.open) .lv-num { display: inline-block; min-width: 20px; margin-right: 6px; }
.lv .lv-ol.open { padding-left: calc(var(--indent, 0) * 24px); }
.lv .lv-task { padding-left: calc(var(--indent, 0) * 24px + 28px); }
.lv .lv-task.open { padding-left: calc(var(--indent, 0) * 24px); }
.lv .lv-check { position: absolute; left: calc(var(--indent, 0) * 24px + 3px); top: .38em; width: 15px; height: 15px; box-sizing: border-box; border: 1.5px solid var(--b-border-strong, #bbb); border-radius: 4px; cursor: pointer; background: var(--b-bg, #fff); }
.lv .lv-check[data-checked="true"] { background: var(--b-accent, #2563eb) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / 11px no-repeat; border-color: var(--b-accent, #2563eb); }
.lv .lv-task.open .lv-check { display: none; }
.lv .lv-done:not(.open) { color: var(--b-muted, #777); text-decoration: line-through; text-decoration-color: var(--b-faint, #aaa); }
.lv .lv-cont { padding-left: calc(var(--indent, 0) * 24px + 26px); }
.lv strong.lv-b { font-weight: 700; }
.lv code.lv-code { font-family: var(--b-mono, ui-monospace, monospace); font-size: .86em; background: var(--b-bg-layer, #f2f2f2); padding: .1em .35em; border-radius: 4px; }
.lv .lv-mark { background: #fde68a; color: inherit; border-radius: 2px; padding: 0 1px; }
.lv a.lv-a { color: var(--b-accent, #2563eb); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--b-accent, #2563eb) 40%, transparent); text-underline-offset: 2px; cursor: text; }
.lv .lv-tag, .lv .lv-cmd, .lv .lv-brace { color: var(--b-faint, #999); font-family: var(--b-mono, ui-monospace, monospace); font-size: .85em; }
.lv .lv-fn { color: var(--b-accent, #2563eb); font-size: .9em; }
.lv .lv-refw { color: var(--b-accent, #2563eb); cursor: text; }
.lv .lv-refw.lv-unresolved { color: var(--b-danger, #b91c1c); font-weight: 600; }
.lv .lv-ref.open > .lv-refw { display: none; }
.lv .lv-line:not(.open) .lv-tilde, .lv .lv-w .lv-tilde { display: inline-block; width: .27em; overflow: hidden; color: transparent; vertical-align: bottom; }
.lv .lv-line.open .lv-tilde { color: var(--b-faint, #999); }
/* LaTeX lines that only open or close something: gone until the caret comes to them. */
.lv .lv-tagline:not(.open):not(.lv-envhead):not(.lv-maketitle) { min-height: 0; height: 0; overflow: hidden; }
.lv .lv-tagline.open { color: var(--b-faint, #999); font-family: var(--b-mono, ui-monospace, monospace); font-size: 13px; }
.lv .lv-envhead:not(.open) > .lv-mk { display: none; }
.lv .lv-envlabel { font-weight: 700; color: var(--b-fg, #111); }
.lv .lv-tagline.open .lv-envlabel { font-family: var(--b-font, system-ui, sans-serif); }
.lv .lv-tagline.open .lv-envlabel { margin-left: 10px; font-size: 13px; }
.lv .lv-head-abstract { text-align: center; margin-top: .4em; }
.lv .lv-head-abstract .lv-envlabel { font-size: 15px; letter-spacing: .02em; }
.lv .lv-head-proof .lv-envlabel { font-style: italic; font-weight: 500; }
.lv .lv-qed { float: right; color: var(--b-fg, #111); }
.lv .lv-in-abstract { font-size: .94em; margin: 0 2.5em; }
.lv .lv-in-quote, .lv .lv-in-quotation, .lv .lv-in-verse { padding-left: 2em; padding-right: 2em; }
.lv .lv-in-center { text-align: center; }
.lv .lv-in-flushright { text-align: right; }
.lv .lv-in-theorem { font-style: italic; }
.lv .lv-titleblock { display: block; text-align: center; margin: .6em 0 1.2em; font-family: inherit; }
.lv .lv-titleblock.lv-notitle { color: var(--b-faint, #999); font-size: 14px; }
.lv .lv-t-title { font-size: 1.9em; font-weight: 700; line-height: 1.2; margin-bottom: .45em; }
.lv .lv-t-author { font-size: 1.12em; }
.lv .lv-t-date { color: var(--b-muted, #666); margin-top: .2em; }
.lv .lv-floatbox { margin: .4em 0; }
.lv .lv-floatbox > .lv-src { font-family: var(--b-mono, ui-monospace, monospace); font-size: 14px; line-height: 1.55; background: var(--b-bg-layer, #f6f6f6); border-radius: 8px; padding: 10px 14px; white-space: pre-wrap; margin-bottom: .5em; }
.lv .lv-floatbox > .lv-src .lv-line { min-height: 1.55em; }
.lv .lv-floatw { display: flex; flex-direction: column; align-items: center; gap: .6em; cursor: text; white-space: normal; }
.lv .lv-tabular { border-collapse: collapse; font-size: .95em; line-height: 1.45; }
.lv .lv-tabular td { padding: 4px 14px; }
.lv .lv-tabular tr.lv-rule-above td { border-top: 1px solid var(--b-fg, #111); }
.lv .lv-tabular tr.lv-rule-below td { border-bottom: 1px solid var(--b-fg, #111); }
.lv .lv-caption { font-size: .92em; max-width: 85%; text-align: center; }
.lv .lv-figimg { max-width: 100%; display: flex; justify-content: center; }
.lv .lv-figimg img { max-width: 100%; border-radius: 4px; }
.lv .lv-figimg.lv-missing img { display: none; }
.lv .lv-figimg.lv-missing::before { content: attr(data-name); display: grid; place-items: center; width: 320px; max-width: 100%; height: 140px; border: 1px dashed var(--b-border-strong, #ccc); border-radius: 6px; color: var(--b-muted, #666); font-size: 13px; font-family: var(--b-mono, ui-monospace, monospace); }
.lv .lv-label { color: var(--b-faint, #999); font-size: .8em; }
.lv .lv-comment { color: var(--b-faint, #9a9a9a); font-style: italic; }
.lv .lv-fnote { font-size: .85em; color: var(--b-muted, #555); }
.lv .lv-sc { font-variant: small-caps; }
.lv .lv-math.open .lv-mathw { display: none; }
.lv .lv-matherr { font-family: var(--b-mono, ui-monospace, monospace); font-size: .85em; color: var(--b-muted, #666); background: var(--b-bg-layer, #f3f3f3); border-radius: 4px; padding: 1px 5px; text-decoration: underline dotted color-mix(in srgb, var(--b-warn, #d97706) 70%, transparent); text-underline-offset: 3px; white-space: pre-wrap; cursor: help; }
.lv .lv-display .lv-matherr { display: inline-block; text-align: left; padding: 6px 10px; }
.lv .lv-img .lv-imgw { display: block; margin: .4em 0; }
.lv .lv-img .lv-imgw img { max-width: 100%; border-radius: 6px; display: block; }
.lv .lv-img .lv-imgw img:not([src]) { min-height: 40px; min-width: 120px; background: var(--b-bg-layer, #f2f2f2); }
.lv .lv-codebox { position: relative; background: var(--b-bg-layer, #f6f6f6); border: 1px solid var(--b-border, #e8e8e8); border-radius: 8px; padding: 12px 16px; margin: .2em 0; font-family: var(--b-mono, ui-monospace, monospace); font-size: 14px; line-height: 1.55; overflow-x: auto; white-space: pre; }
.lv .lv-codebox .lv-line { min-height: 1.55em; }
.lv .lv-chunk:not(.open) .lv-fence { display: none; }
.lv .lv-chunk.open .lv-fence > .lv-mk { display: inline; }
.lv .lv-lang { position: absolute; top: 6px; right: 10px; font-size: 12px; color: var(--b-faint, #999); font-family: var(--b-font, system-ui, sans-serif); }
.lv .lv-mathbox, .lv .lv-tablebox { margin: .2em 0; }
.lv .lv-mathbox > .lv-src, .lv .lv-tablebox > .lv-src, .lv .lv-frontbox, .lv .lv-htmlbox, .lv .lv-envbox { font-family: var(--b-mono, ui-monospace, monospace); font-size: 14px; line-height: 1.55; background: var(--b-bg-layer, #f6f6f6); border-radius: 8px; padding: 10px 14px; white-space: pre-wrap; }
.lv .lv-htmlbox, .lv .lv-envbox { color: var(--b-muted, #555); }
.lv .lv-htmlbox .lv-line, .lv .lv-envbox .lv-line, .lv .lv-src .lv-line { min-height: 1.55em; }
.lv .lv-display { display: block; text-align: center; padding: .4em 0; overflow-x: auto; cursor: text; }
.lv .lv-chunk.open .lv-display { border: 1px dashed var(--b-border, #e5e5e5); border-top: 0; border-radius: 0 0 8px 8px; }
.lv .lv-tablew { overflow-x: auto; }
.lv .lv-chunk.open .lv-tablew { display: none; }
.lv .lv-tablew table { border-collapse: collapse; width: 100%; font-size: .95em; line-height: 1.5; white-space: normal; cursor: text; }
.lv .lv-tablew th, .lv .lv-tablew td { border: 1px solid var(--b-border, #e2e2e2); padding: 6px 10px; }
.lv .lv-tablew th { background: var(--b-bg-layer, #f6f6f6); font-weight: 600; }
.lv .lv-tablew .lv-mk { display: none !important; }
.lv .lv-chip { display: inline-block; font-size: 13px; color: var(--b-muted, #666); border: 1px dashed var(--b-border-strong, #ccc); border-radius: 6px; padding: 2px 8px; cursor: text; }
.lv .lv-chunk[data-kind="front"].open > .lv-chip { display: none; }
.lv .lv-env { color: var(--b-faint, #999); font-family: var(--b-mono, ui-monospace, monospace); font-size: 13px; }
.lv .lv-hl { background: color-mix(in srgb, var(--b-accent, #2563eb) 18%, transparent); box-shadow: 0 1.5px 0 color-mix(in srgb, var(--b-accent, #2563eb) 55%, transparent); border-radius: 2px; animation: lv-in .8s ease-out; }
.lv .lv-hl-line { background: color-mix(in srgb, var(--b-accent, #2563eb) 9%, transparent); box-shadow: inset 3px 0 0 var(--b-accent, #2563eb); border-radius: 3px; animation: lv-in .8s ease-out; }
@keyframes lv-in { from { background: color-mix(in srgb, var(--b-accent, #2563eb) 42%, transparent); } }

/* A Word page, drawn by docx-preview. */
.dp-page { box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 28px 40px 80px; font-size: 17px; line-height: 1.6; }
.dp-page[hidden] { display: none; }
.dp-block { position: relative; border-radius: 6px; padding: 2px 10px; margin: 0 -10px 8px; cursor: text; }
.dp-block:hover { background: color-mix(in srgb, var(--b-fg, #111) 4%, transparent); }
.dp-changed { box-shadow: inset 3px 0 0 var(--b-accent, #2563eb); background: color-mix(in srgb, var(--b-accent, #2563eb) 9%, transparent); }
.dp-editing { white-space: pre-wrap; overflow-wrap: anywhere; outline: none; background: var(--b-bg-deep, #fafafa); box-shadow: inset 0 0 0 1px var(--b-border-strong, #ccc); padding: 8px 10px; margin: 0 -10px 14px; font-size: 15px; line-height: 1.55; }
.dp-chip { display: inline-block; font-size: 13px; color: var(--b-muted, #666); border: 1px dashed var(--b-border-strong, #ccc); border-radius: 6px; padding: 2px 8px; margin: 0 0 14px; }
.dp-word section.docx { padding: 0 !important; margin: 0 !important; width: auto !important; min-height: 0 !important; background: transparent !important; box-shadow: none !important; }
.dp-word .dp-para { margin-left: 0; margin-right: 0; cursor: text; border-radius: 4px; }
.dp-word .dp-para:hover { background: color-mix(in srgb, var(--b-fg, #111) 4%, transparent); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
	if (text !== undefined) node.textContent = text;
	return node;
}

const base = (path: string) => path.split(/[\\/]/).pop() ?? path;
const dir = (path: string) => path.replace(/[\\/][^\\/]*$/, "");
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const keyName = (k: string) => (mac ? k.replace("Mod+", "⌘").replace("Shift+", "⇧") : k.replace("Mod+", "Ctrl+"));

const when = (at: number) => new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const clip = (text: string, n = 70) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function mountDocPage(host: HTMLElement, options: DocPageOptions): DocPage {
	if (!document.getElementById("dp-style")) document.head.append(el("style", { id: "dp-style" }, STYLE));
	host.classList.add("dp");
	host.replaceChildren();
	const bar = el("div", { class: "dp-bar" });
	const name = el("span", { class: "dp-name" }, base(options.path));
	const status = el("span", { class: "dp-status" }, "Opening…");
	const spacer = el("span", { class: "dp-spacer" });
	const iconButton = (icon: string, label: string, cls = "dp-ib") => {
		const b = el("button", { type: "button", class: cls, title: label, "aria-label": label, "aria-pressed": "false" });
		b.innerHTML = svg(icon);
		return b;
	};
	const labelled = (icon: string, label: string, title: string) => {
		const b = el("button", { type: "button", class: "dp-btn", title, "aria-pressed": "false" });
		b.innerHTML = `${svg(icon)}<span>${label}</span>`;
		return b;
	};
	const sourceButton = labelled("source", "Source", "Show the file as its source");
	const historyButton = labelled("clock", "History", "Earlier versions of this file");
	const pdfButton = labelled("pdf", "PDF", "Typeset this file and show the PDF beside it");
	pdfButton.hidden = true;
	const changesButton = el("button", { type: "button", class: "dp-btn dp-changes", "aria-pressed": "false", title: "Edits from agents, to accept or reject", hidden: "" });
	const commentsButton = el("button", { type: "button", class: "dp-btn", "aria-pressed": "false", title: "The Doc's comments", hidden: "" });
	// Git: shown once the server says the file is in a repository, with Pull and Push in a popover.
	const gitBox = el("div", { class: "dp-git", hidden: "" });
	const gitButton = el("button", { type: "button", class: "dp-btn", "aria-pressed": "false", "aria-haspopup": "dialog", title: "Pull and push this file's git repository" });
	const gitMenu = el("div", { class: "dp-gitmenu", role: "dialog", hidden: "" });
	gitBox.append(gitButton, gitMenu);
	// A Google Doc: where it lives, how the link stands, and signing in; in place of Git, which a Doc has none of.
	const googleBox = el("div", { class: "dp-git", hidden: "" });
	const googleButton = el("button", { type: "button", class: "dp-btn", "aria-pressed": "false", "aria-haspopup": "dialog", title: "This page is a Google Doc" });
	const googleMenu = el("div", { class: "dp-gitmenu", role: "dialog", hidden: "" });
	googleBox.append(googleButton, googleMenu);
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
	const divider = el("div", { class: "dp-divider", hidden: "", role: "separator", "aria-orientation": "vertical", title: "Drag to resize" });
	const pdfPane = el("div", { class: "dp-pdf", hidden: "" });
	const pdfBar = el("div", { class: "dp-pdfbar" });
	const pdfState = el("span", { class: "dp-pdfstate" }, "Not typeset yet");
	const errButton = el("button", { type: "button", class: "dp-btn dp-sm dp-errs", hidden: "", "aria-pressed": "false" });
	const errList = el("div", { class: "dp-errlist", hidden: "" });
	const pdfBody = el("div", { class: "dp-pdfbody" });
	pdfPane.append(pdfBar, errList, pdfBody);
	main.append(scroll, divider, pdfPane, panel, pill);
	host.append(bar, tools, main);

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
			drawGoogle();
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
		if (why !== "open") compileSoon();
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
			if (remoteStatus?.paste !== undefined || options.api) parts.push(...signInParts());
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

	// --- the PDF, for a LaTeX page ------------------------------------------------------------

	let pdfOpen = false;
	let pdfTimer: ReturnType<typeof setTimeout> | undefined;
	let pdfBusy = false;
	let pdfAgain = false;
	let pdfPath: string | undefined;
	let pdfBytes: ArrayBuffer | undefined;
	let pdfDrawn = 0;
	const recompile = iconButton("refresh", "Typeset again", "dp-ib dp-sm");
	const openPdf = iconButton("external", "Open the PDF in a new tab", "dp-ib dp-sm");
	const closePdf = iconButton("x", "Close the PDF", "dp-ib dp-sm");
	pdfBar.append(pdfState, errButton, recompile, openPdf, closePdf);
	openPdf.disabled = true;

	const savedWidth = Number(localStorage.getItem("dp-pdf-width") ?? 0);
	if (savedWidth > 0) pdfPane.style.setProperty("--pdf-w", `${savedWidth}px`);

	function compileNow(): void {
		if (!pdfOpen) return;
		clearTimeout(pdfTimer);
		if (pdfBusy) {
			pdfAgain = true;
			return;
		}
		pdfBusy = true;
		pdfState.dataset.state = "busy";
		pdfState.textContent = "Typesetting…";
		pdfBody.toggleAttribute("data-stale", pdfDrawn > 0);
		sync.compile();
	}

	/** Typeset again once typing has paused, and everything typed has reached the file. */
	function compileSoon(): void {
		if (!pdfOpen) return;
		clearTimeout(pdfTimer);
		pdfTimer = setTimeout(() => (sync.settled ? compileNow() : compileSoon()), 1200);
	}

	function showPdf(open: boolean): void {
		pdfOpen = open;
		pdfButton.setAttribute("aria-pressed", String(open));
		pdfPane.hidden = !open;
		divider.hidden = !open;
		if (open) {
			if (!pdfDrawn) pdfBody.replaceChildren(el("div", { class: "dp-pdfempty" }, "Typesetting the paper for the first time can take a minute while LaTeX fetches its packages."));
			compileNow();
		} else clearTimeout(pdfTimer);
	}

	async function drawPdf(path: string): Promise<void> {
		if (!options.file) return;
		const bytes = await options.file(path);
		pdfBytes = bytes;
		await drawPages();
	}

	/** The pages, drawn off to the side and swapped in, so the reader keeps their place in the PDF. */
	async function drawPages(): Promise<void> {
		if (!pdfBytes) return;
		const width = Math.max(200, pdfBody.clientWidth - 36);
		const into = el("div", { style: "display: contents" });
		const ratio = pdfBody.scrollHeight > pdfBody.clientHeight ? pdfBody.scrollTop / (pdfBody.scrollHeight - pdfBody.clientHeight) : 0;
		if (options.pdf) {
			const shadow = el("div", { style: `position: absolute; visibility: hidden; width: ${width}px` });
			document.body.append(shadow);
			try {
				pdfDrawn = await options.pdf(shadow, pdfBytes.slice(0), width);
				into.append(...shadow.childNodes);
			} finally {
				shadow.remove();
			}
		} else {
			const frame = el("iframe", { style: "width: 100%; flex: 1; border: 0; min-height: 600px" });
			frame.src = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
			into.append(frame);
			pdfDrawn = 1;
		}
		pdfBody.replaceChildren(into);
		pdfBody.removeAttribute("data-stale");
		pdfBody.scrollTop = ratio * Math.max(0, pdfBody.scrollHeight - pdfBody.clientHeight);
	}

	function lineOffset(line: number): number {
		let at = 0;
		for (let n = 1; n < line; n++) {
			const next = sync.text.indexOf("\n", at);
			if (next === -1) return sync.text.length;
			at = next + 1;
		}
		return at;
	}

	function showErrors(errors: CompileError[]): void {
		errButton.hidden = errors.length === 0;
		errButton.textContent = `${errors.length} ${errors.length === 1 ? "error" : "errors"}`;
		errList.replaceChildren(
			...errors.map((error) => {
				const row = el("div", { class: "dp-err", title: error.line ? "Go to this line" : "" });
				row.append(el("span", { class: "e-line" }, error.line ? `Line ${error.line}` : "—"), el("span", { class: "e-msg" }, error.message));
				if (error.line) row.onclick = () => live.goto(lineOffset(error.line!));
				return row;
			}),
		);
		if (errors.length === 0) {
			errList.hidden = true;
			errButton.setAttribute("aria-pressed", "false");
		}
	}

	function compiled(message: Extract<DocServerMessage, { type: "doc.compiled" }>): void {
		pdfBusy = false;
		const when = new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
		pdfState.dataset.state = message.ok ? "ok" : "failed";
		pdfState.replaceChildren();
		if (message.error && !message.pdf) pdfState.textContent = message.error;
		else if (message.pdf) pdfState.append(el("b", {}, message.ok ? "Typeset" : "Typeset with errors"), `${when}, ${(message.ms / 1000).toFixed(1)} s`);
		else pdfState.append(el("b", {}, "Did not typeset"), when);
		showErrors(message.errors);
		openPdf.disabled = !message.pdf;
		if (message.pdf) {
			pdfPath = message.pdf;
			void drawPdf(message.pdf).catch(() => (pdfState.textContent = "The PDF was made but could not be read."));
		} else {
			pdfBody.removeAttribute("data-stale");
			if (!pdfDrawn) pdfBody.replaceChildren(el("div", { class: "dp-pdfempty" }, message.error ?? "LaTeX stopped before writing a page. The errors above say where."));
			if (message.errors.length) {
				errList.hidden = false;
				errButton.setAttribute("aria-pressed", "true");
			}
		}
		if (pdfAgain) {
			pdfAgain = false;
			compileSoon();
		}
	}

	// --- git ------------------------------------------------------------------------------------

	let repo: GitStatus | undefined;
	let gitBusy: "pull" | "push" | undefined;
	let gitSaid: { ok: boolean; message: string } | undefined;

	function drawGit(): void {
		gitBox.hidden = !repo;
		if (!repo) return;
		const name = repo.label ?? "Git";
		gitButton.innerHTML = `${svg("branch")}<span>${gitBusy ? (gitBusy === "pull" ? "Pulling…" : "Pushing…") : name}</span>${repo.ahead && !gitBusy ? `<span class="dp-ahead" title="Commits not pushed yet">↑${repo.ahead}</span>` : ""}`;
		gitButton.title = `${repo.branch}${repo.upstream ? ` ↔ ${repo.upstream}` : ""}: pull and push`;
		if (gitMenu.hidden) return;
		const where = el("div", { class: "g-where" });
		where.innerHTML = svg("branch");
		where.append(repo.branch, ...(repo.upstream ? [el("span", { style: "font-weight:400;color:var(--b-muted,#666)" }, `↔ ${repo.upstream}`)] : []));
		const parts: string[] = [];
		if (repo.changed) parts.push(`${repo.changed} file${repo.changed === 1 ? "" : "s"} edited since the last commit`);
		if (repo.ahead) parts.push(`${repo.ahead} commit${repo.ahead === 1 ? "" : "s"} to push`);
		if (repo.behind) parts.push(`${repo.behind} to pull`);
		const state = el("div", { class: "g-state" }, repo.upstream ? (parts.length ? `${parts.join(", ")}.` : `In step with ${name} as of the last pull.`) : "This branch has no remote branch to pull from or push to.");
		const pull = el("button", { type: "button", class: "dp-btn dp-outline" });
		pull.innerHTML = `${svg("pull")}<span>${gitBusy === "pull" ? "Pulling…" : "Pull"}</span>`;
		const push = el("button", { type: "button", class: "dp-btn dp-primary" });
		push.innerHTML = `${svg("push")}<span>${gitBusy === "push" ? "Pushing…" : "Push"}</span>`;
		pull.disabled = push.disabled = !!gitBusy || !repo.upstream;
		pull.title = `Commit what is edited here, and merge in what changed on ${name}`;
		push.title = `Pull, then send the commits made here to ${name}`;
		pull.onclick = () => runGit("pull");
		push.onclick = () => runGit("push");
		const acts = el("div", { class: "g-acts" });
		acts.append(pull, push);
		const said = el("div", { class: "g-said", "data-ok": String(gitSaid?.ok ?? true) }, gitSaid?.message ?? "");
		said.hidden = !gitSaid;
		const note = el("div", { class: "g-note" }, `Edits here are committed as "Edited in Decks" before each pull. What a pull brings in is highlighted as a change.`);
		gitMenu.replaceChildren(where, ...(repo.remote ? [el("div", { class: "g-remote", title: repo.remote }, repo.remote)] : []), state, acts, said, note);
	}

	function runGit(action: "pull" | "push"): void {
		if (gitBusy) return;
		gitBusy = action;
		gitSaid = undefined;
		drawGit();
		sync.git(action);
	}

	function repoAnswered(message: Extract<DocServerMessage, { type: "doc.repo" }>): void {
		if (message.action === "status") repo = message.status;
		else {
			gitBusy = undefined;
			if (message.status) repo = message.status;
			gitSaid = { ok: message.ok, message: message.message ?? (message.ok ? "Done." : "git stopped.") };
			// The PDF follows what the pull brought in.
			if (message.ok && pdfOpen) compileSoon();
		}
		drawGit();
	}

	const closeGit = () => {
		gitMenu.hidden = true;
		gitButton.setAttribute("aria-pressed", "false");
	};
	gitButton.onclick = () => {
		const open = gitMenu.hidden;
		gitMenu.hidden = !open;
		gitButton.setAttribute("aria-pressed", String(open));
		if (open) {
			if (!gitBusy) sync.git("status");
			drawGit();
		}
	};
	document.addEventListener("mousedown", (event) => {
		if (!gitBox.contains(event.target as Node)) closeGit();
	});

	// --- a Google Doc --------------------------------------------------------------------------

	let remoteStatus: DocRemoteStatus | undefined;
	let pasteSaid = "";

	/** Signing in to Google: a button, and for a Desktop client the box to paste the address back into. */
	function signInParts(): HTMLElement[] {
		if (!options.api) return [];
		const parts: HTMLElement[] = [];
		const signIn = el("button", { type: "button", class: "dp-btn dp-primary" }, "Sign in with Google");
		signIn.style.justifyContent = "center";
		signIn.onclick = () => window.open(`${options.api}/google/signin?origin=${encodeURIComponent(location.origin)}`, "_blank", "noopener");
		parts.push(signIn);
		if (remoteStatus?.paste !== false) {
			const form = el("form", { class: "g-paste" });
			const input = el("input", { type: "url", placeholder: "Paste the address Google sent you to", "aria-label": "Address after signing in" });
			const done = el("button", { type: "submit", class: "dp-btn dp-outline" }, "Done");
			form.append(input, done);
			form.onsubmit = (event) => {
				event.preventDefault();
				void fetch(`${options.api}/google/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: input.value }) })
					.then((r) => r.json() as Promise<{ ok: boolean; email?: string; message?: string }>)
					.then((answer) => {
						pasteSaid = answer.ok ? `Signed in as ${answer.email}.` : (answer.message ?? "That did not work.");
						drawGoogle();
						if (view === "comments") drawComments();
					});
			};
			parts.push(form);
		}
		if (pasteSaid) parts.push(el("div", { class: "g-note" }, pasteSaid));
		return parts;
	}

	function drawGoogle(): void {
		const remote = sync.remote;
		googleBox.hidden = !remote;
		if (!remote) return;
		const state = remoteStatus?.state ?? "syncing";
		const words = { synced: "Google Docs", syncing: "Syncing…", signin: "Sign in", error: "Not in step" }[state];
		googleButton.innerHTML = `${svg(state === "signin" || state === "error" ? "cloudoff" : "cloud")}<span>${words}</span><span class="dp-dot" data-state="${state}"></span>`;
		if (googleMenu.hidden) return;
		const head = el("div", { class: "g-where" });
		head.innerHTML = svg("cloud");
		head.append(remote.title);
		const open = el("a", { class: "g-open", href: remote.url, target: "_blank", rel: "noopener" }, "Open in Google Docs");
		open.insertAdjacentHTML("beforeend", svg("external"));
		const when = remoteStatus?.at ? new Date(remoteStatus.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
		const line =
			state === "synced" ? `In step with the Doc${when ? ` since ${when}` : ""}. Edits here reach Google in about two seconds; others' edits arrive highlighted.`
			: state === "syncing" ? "Sending your edits to Google…"
			: (remoteStatus?.message ?? "");
		const said = el("div", { class: "g-said", "data-ok": String(state === "synced" || state === "syncing") }, line);
		const parts: HTMLElement[] = [head, open, said];
		if (state === "signin" && options.api) parts.push(...signInParts());
		const who = remoteStatus?.mode === "fake" ? "A stand-in for Google on this server: no Google account is connected." : remoteStatus?.email ? `Signed in to Google as ${remoteStatus.email}.` : "";
		if (who) parts.push(el("div", { class: "g-note" }, who));
		googleMenu.replaceChildren(...parts);
	}

	googleButton.onclick = () => {
		const opening = googleMenu.hidden;
		googleMenu.hidden = !opening;
		googleButton.setAttribute("aria-pressed", String(opening));
		drawGoogle();
	};
	document.addEventListener("mousedown", (event) => {
		if (!googleBox.contains(event.target as Node)) {
			googleMenu.hidden = true;
			googleButton.setAttribute("aria-pressed", "false");
		}
	});

	pdfButton.onclick = () => showPdf(!pdfOpen);
	closePdf.onclick = () => showPdf(false);
	recompile.onclick = () => compileNow();
	errButton.onclick = () => {
		errList.hidden = !errList.hidden;
		errButton.setAttribute("aria-pressed", String(!errList.hidden));
	};
	openPdf.onclick = () => {
		if (pdfBytes) window.open(URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" })), "_blank");
	};
	divider.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		divider.setPointerCapture(event.pointerId);
		divider.dataset.drag = "";
		const right = main.getBoundingClientRect().right - (panel.hidden ? 0 : panel.getBoundingClientRect().width);
		const move = (e: PointerEvent) => {
			const width = Math.max(260, Math.min(right - e.clientX, main.clientWidth - 320));
			pdfPane.style.setProperty("--pdf-w", `${width}px`);
		};
		const up = () => {
			delete divider.dataset.drag;
			divider.removeEventListener("pointermove", move);
			localStorage.setItem("dp-pdf-width", String(Math.round(pdfPane.getBoundingClientRect().width)));
			void drawPages();
		};
		divider.addEventListener("pointermove", move);
		divider.addEventListener("pointerup", up, { once: true });
	});

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
		if (message.type === "doc.compiled" && message.path === sync.path) compiled(message);
		if (message.type === "doc.repo" && message.path === sync.path) repoAnswered(message);
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
			remoteStatus = message.status;
			drawGoogle();
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
