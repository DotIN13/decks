import { el } from "./ui.ts";

/** The document page's sheet, added to the page once however many documents are open on it. */
export function addStyle(): void {
	if (!document.getElementById("dp-style")) document.head.append(el("style", { id: "dp-style" }, STYLE));
}

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
/* In the app's focus view the bar is the view's header, with room at each end for the app's controls (\`lib/card.js\`, \`watchFocus\`). */
html[data-decks-focus] .dp-bar { height: 52px; padding-left: calc(var(--decks-focus-left, 0px) + 4px); padding-right: calc(var(--decks-focus-right, 0px) + 8px); border-bottom-color: var(--dp-hair); }
html[data-decks-focus] .dp-bar:has(+ .dp-tools[hidden]) { border-bottom-color: var(--dp-hair); }
html[data-decks-focus] .dp-tools { background: transparent; border-bottom-color: var(--dp-hair); }
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
/* A dark page (the host sets data-theme, as the canvas's document item does): the highlighter a dark board's sticky amber. */
.dp[data-theme="dark"] .lv .lv-mark { background: #4a3d1c; }
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
