import type { DocClientMessage, DocServerMessage, DocVersion, Splice } from "../index.ts";
import { DocSync } from "../client.ts";
import { findMarks, marksOf, segments, shiftMarks, spliceBetween, type Mark } from "./marks.ts";
import { Reading } from "./reading.ts";

/**
 * `@decks/docs/page`: a document drawn as a page you type into, in plain DOM.
 *
 * The page shows the file's source as text — every character on screen is a character of the
 * file, so a caret position is an offset into it and a keystroke is one splice. Suggestions from
 * other writers sit inline: their new words tinted, the words they took out as a struck ghost,
 * and each is accepted or rejected from the panel. The bar says whether everything typed has
 * reached the file, keeps the history, and writes a working copy back to its original.
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
}

export interface DocPage {
	sync: DocSync;
	destroy(): void;
}

const STYLE = `
.dp { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--b-bg, #fff); color: var(--b-fg, #111); font-family: var(--b-font, system-ui, sans-serif); }
.dp-bar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--b-border, #e5e5e5); font-size: 14px; flex: none; }
.dp-name { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-from { color: var(--b-muted, #666); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dp-status { color: var(--b-muted, #666); margin-left: auto; white-space: nowrap; }
.dp-status[data-state="saving"] { color: var(--b-warn, #b45309); }
.dp-status[data-state="error"] { color: var(--b-danger, #b91c1c); }
.dp-bar button { font: inherit; font-size: 14px; padding: 5px 10px; border-radius: 7px; border: 1px solid var(--b-border-strong, #ccc); background: var(--b-bg, #fff); color: var(--b-fg, #111); cursor: pointer; white-space: nowrap; }
.dp-bar button[aria-pressed="true"] { background: var(--b-fg, #111); color: var(--b-bg, #fff); border-color: var(--b-fg, #111); }
.dp-bar button:disabled { opacity: .45; cursor: default; }
.dp-main { position: relative; flex: 1; min-height: 0; display: flex; }
.dp-scroll { flex: 1; min-width: 0; overflow: auto; }
.dp-text { box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 28px 40px 80px; min-height: 100%; outline: none; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; line-height: 1.65; tab-size: 4; }
.dp-text[data-format="docx"] { font-family: var(--b-mono, ui-monospace, monospace); font-size: 13px; line-height: 1.5; }
.dp-ins { background: color-mix(in srgb, var(--b-accent, #2563eb) 16%, transparent); border-bottom: 2px solid var(--b-accent, #2563eb); border-radius: 2px; }
.dp-ins[data-hot] { background: color-mix(in srgb, var(--b-accent, #2563eb) 32%, transparent); }
.dp-del::before { content: attr(data-text); text-decoration: line-through; color: var(--b-danger, #b91c1c); opacity: .75; }
.dp-panel { flex: none; width: 300px; border-left: 1px solid var(--b-border, #e5e5e5); overflow: auto; padding: 12px 14px; font-size: 14px; background: var(--b-bg-deep, #fafafa); }
.dp-panel[hidden] { display: none; }
.dp-panel h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: var(--b-muted, #666); margin: 4px 0 10px; }
.dp-item { border: 1px solid var(--b-border, #e5e5e5); background: var(--b-bg, #fff); border-radius: 9px; padding: 9px 10px; margin-bottom: 8px; cursor: pointer; }
.dp-item b { font-weight: 600; }
.dp-item .dp-snip { margin: 4px 0 8px; overflow-wrap: anywhere; }
.dp-item .dp-snip ins { text-decoration: none; background: color-mix(in srgb, var(--b-accent, #2563eb) 16%, transparent); }
.dp-item .dp-snip del { color: var(--b-danger, #b91c1c); }
.dp-item button { font: inherit; font-size: 13px; padding: 3px 9px; border-radius: 6px; border: 1px solid var(--b-border-strong, #ccc); background: var(--b-bg, #fff); color: var(--b-fg, #111); cursor: pointer; margin-right: 6px; }
.dp-empty { color: var(--b-muted, #666); }
.dp-page { box-sizing: border-box; max-width: 820px; margin: 0 auto; padding: 28px 40px 80px; font-size: 17px; line-height: 1.6; }
.dp-page[hidden], .dp-text[hidden] { display: none; }
.dp-block { position: relative; border-radius: 6px; padding: 2px 10px; margin: 0 -10px 8px; cursor: text; }
.dp-block:hover { background: color-mix(in srgb, var(--b-fg, #111) 4%, transparent); }
.dp-block > :first-child { margin-top: 0; }
.dp-block > :last-child { margin-bottom: 0; }
.dp-block p, .dp-block ul, .dp-block ol, .dp-block pre, .dp-block blockquote, .dp-block table { margin: 0 0 14px; }
.dp-block h1 { font-size: 28px; line-height: 1.25; margin: 6px 0 14px; }
.dp-block h2 { font-size: 22px; line-height: 1.3; margin: 14px 0 10px; }
.dp-block h3 { font-size: 18px; margin: 12px 0 8px; }
.dp-block h4, .dp-block h5 { font-size: 16px; margin: 10px 0 6px; }
.dp-block code { font-family: var(--b-mono, ui-monospace, monospace); font-size: .9em; background: var(--b-bg-layer, #f3f3f3); padding: 0 4px; border-radius: 4px; }
.dp-block .katex-display { margin: 8px 0 14px; }
.dp-changed { box-shadow: inset 3px 0 0 var(--b-accent, #2563eb); background: color-mix(in srgb, var(--b-accent, #2563eb) 6%, transparent); }
.dp-editing { white-space: pre-wrap; overflow-wrap: anywhere; outline: none; background: var(--b-bg-deep, #fafafa); box-shadow: inset 0 0 0 1px var(--b-border-strong, #ccc); padding: 8px 10px; margin: 0 -10px 14px; font-size: 15px; line-height: 1.55; }
.dp-page[data-format="text"] .dp-editing { font-family: var(--b-mono, ui-monospace, monospace); }
.dp-preamble, .dp-chip { display: inline-block; font-size: 13px; color: var(--b-muted, #666); border: 1px dashed var(--b-border-strong, #ccc); border-radius: 6px; padding: 2px 8px; margin: 0 0 14px; }
.dp-box, .dp-abstract { border: 1px solid var(--b-border, #e5e5e5); border-radius: 8px; padding: 8px 12px; margin: 0 0 14px; }
.dp-box { color: var(--b-muted, #666); font-size: 15px; }
.dp-cite, .dp-link { color: var(--b-accent, #2563eb); }
.dp-empty-doc { color: var(--b-muted, #666); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
	if (text !== undefined) node.textContent = text;
	return node;
}

const base = (path: string) => path.split(/[\\/]/).pop() ?? path;
const clip = (text: string, n = 90) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function mountDocPage(host: HTMLElement, options: DocPageOptions): DocPage {
	if (!document.getElementById("dp-style")) document.head.append(el("style", { id: "dp-style" }, STYLE));
	host.classList.add("dp");
	host.replaceChildren();
	const bar = el("div", { class: "dp-bar" });
	const name = el("span", { class: "dp-name" }, base(options.path));
	const from = el("span", { class: "dp-from" });
	const status = el("span", { class: "dp-status" }, "Opening…");
	const sourceButton = el("button", { type: "button", "aria-pressed": "false", title: "Show the file as its source" }, "Source");
	const suggestionsButton = el("button", { type: "button", "aria-pressed": "false" }, "Suggestions");
	const historyButton = el("button", { type: "button", "aria-pressed": "false" }, "History");
	const writeButton = el("button", { type: "button", hidden: "" }, "Write back");
	bar.append(name, from, status, sourceButton, suggestionsButton, historyButton, writeButton);
	const main = el("div", { class: "dp-main" });
	const scroll = el("div", { class: "dp-scroll" });
	const text = el("div", { class: "dp-text", spellcheck: "false" });
	const panel = el("div", { class: "dp-panel", hidden: "" });
	scroll.append(text);
	main.append(scroll, panel);
	host.append(bar, main);

	let marks: Mark[] = [];
	let composing = false;
	let view: "none" | "suggestions" | "history" = "none";
	let versions: DocVersion[] = [];
	let written = "";
	let mode: "page" | "source" = "page";

	const sync = new DocSync({
		path: options.path,
		send: options.send,
		onUpdate: (_sync, why, applied) => updated(why, applied),
	});
	const reading = new Reading(sync, {
		...(options.markdown ? { markdown: options.markdown } : {}),
		...(options.math ? { math: options.math } : {}),
		marks: () => marks,
	});
	scroll.append(reading.root);
	text.hidden = true;

	function setMode(next: typeof mode): void {
		mode = next;
		sourceButton.setAttribute("aria-pressed", String(mode === "source"));
		text.hidden = mode !== "source";
		reading.root.hidden = mode !== "page";
		if (mode === "source") draw(false);
		else reading.render();
	}

	// --- the text, and the caret in it ----------------------------------------------------

	/** Every text node of the page in order: the ghosts of taken-out words have none. */
	function texts(): Text[] {
		const out: Text[] = [];
		const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node as Text);
		return out;
	}

	function offsetOf(node: Node, offset: number): number {
		let total = 0;
		if (node.nodeType !== Node.TEXT_NODE) {
			// A position between children: everything before that child counts.
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
		const a = offsetOf(selection.anchorNode!, selection.anchorOffset);
		const f = offsetOf(selection.focusNode!, selection.focusOffset);
		return { start: a, end: f };
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
		for (const segment of segments(sync.text, marks)) {
			if (!("mark" in segment)) frag.append(document.createTextNode(segment.text));
			else if (segment.mark.kind === "ins") frag.append(el("span", { class: "dp-ins", "data-change": segment.mark.change }, segment.text));
			else frag.append(el("span", { class: "dp-del", contenteditable: "false", "data-change": segment.mark.change, "data-text": segment.mark.text }));
		}
		// A trailing newline only shows its empty last line with something after it.
		frag.append(el("br"));
		text.replaceChildren(frag);
		if (where) place(where);
	}

	function shiftCaret(at: { start: number; end: number }, applied: readonly Splice[]) {
		const move = (p: number) => applied.reduce((q, s) => (q <= s.at ? q : q >= s.at + s.before.length ? q + s.text.length - s.before.length : s.at + s.text.length), p);
		return { start: move(at.start), end: move(at.end) };
	}

	// --- what changed ---------------------------------------------------------------------

	function updated(why: "open" | "remote" | "local" | "review", applied?: readonly Splice[]): void {
		if (why === "open") {
			marks = sync.changes.flatMap((change) => findMarks(change, sync.text));
			text.setAttribute("data-format", sync.format);
			text.setAttribute("contenteditable", sync.readOnly ? "false" : "plaintext-only");
			name.textContent = base(sync.source ?? sync.path);
			from.textContent = sync.source ? `copy in ${sync.path.replace(/\/[^/]*$/, "/")}` : "";
			writeButton.hidden = !sync.source;
			reading.root.dataset.format = sync.format;
			if (mode === "source") draw(false);
			else reading.update(undefined);
		} else if (why === "local") {
			const before = marks.length;
			for (const splice of applied ?? []) marks = shiftMarks(marks, splice);
			// The browser already shows the keystroke; redraw only when a mark had to move.
			if (before > 0 && mode === "source") draw();
		} else {
			const where = caret();
			const known = new Set(marks.map((m) => m.change));
			for (const splice of applied ?? []) marks = shiftMarks(marks, splice);
			const live = new Set(sync.changes.map((c) => c.id));
			marks = marks.filter((m) => live.has(m.change));
			for (const change of sync.changes) if (!known.has(change.id)) marks.push(...marksOf(change.id, applied ?? []));
			if (mode === "page") reading.update(applied ?? []);
			else {
				draw(false);
				if (where) place(shiftCaret(where, applied ?? []));
			}
		}
		refresh();
	}

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

	// --- the bar and the panel ------------------------------------------------------------

	function refresh(): void {
		const n = sync.changes.length;
		suggestionsButton.textContent = n ? `Suggestions ${n}` : "Suggestions";
		if (sync.error && !sync.ready) {
			status.dataset.state = "error";
			status.textContent = sync.error;
		} else if (sync.readOnly) {
			status.dataset.state = "";
			status.textContent = "Read-only";
		} else if (!sync.ready) {
			status.dataset.state = "";
			status.textContent = "Opening…";
		} else {
			status.dataset.state = sync.settled ? "" : "saving";
			status.textContent = sync.settled ? (written || "Saved") : "Saving…";
		}
		if (view === "suggestions") drawSuggestions();
	}

	function show(next: typeof view): void {
		view = view === next ? "none" : next;
		suggestionsButton.setAttribute("aria-pressed", String(view === "suggestions"));
		historyButton.setAttribute("aria-pressed", String(view === "history"));
		panel.hidden = view === "none";
		if (view === "suggestions") drawSuggestions();
		if (view === "history") {
			panel.replaceChildren(el("h3", {}, "History"), el("p", { class: "dp-empty" }, "Reading…"));
			sync.versions();
		}
	}

	function drawSuggestions(): void {
		panel.replaceChildren(el("h3", {}, "Suggestions"));
		if (sync.changes.length === 0) panel.append(el("p", { class: "dp-empty" }, "Nothing waiting. A write to this file from an agent or another program shows here."));
		for (const change of [...sync.changes].reverse()) {
			const item = el("div", { class: "dp-item", "data-change": change.id });
			const snip = el("div", { class: "dp-snip" });
			for (const splice of change.splices.slice(0, 3)) {
				if (splice.before) snip.append(el("del", {}, clip(splice.before, 60)));
				if (splice.text) snip.append(el("ins", {}, clip(splice.text, 60)));
				snip.append(" ");
			}
			if (change.splices.length > 3) snip.append(`and ${change.splices.length - 3} more`);
			const accept = el("button", { type: "button" }, "Accept");
			const reject = el("button", { type: "button" }, "Reject");
			accept.onclick = (event) => (event.stopPropagation(), sync.accept(change.id));
			reject.onclick = (event) => (event.stopPropagation(), sync.reject(change.id));
			item.append(el("b", {}, change.by === "outside" ? "Another program" : change.by), document.createTextNode(` · ${new Date(change.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`), snip, accept, reject);
			item.onmouseenter = () => hot(change.id, true);
			item.onmouseleave = () => hot(change.id, false);
			item.onclick = () => {
				const mark = marks.find((m) => m.change === change.id && m.kind === "ins") as Extract<Mark, { kind: "ins" }> | undefined;
				const target =
					mode === "source"
						? text.querySelector(`[data-change="${change.id}"]`)
						: [...reading.root.querySelectorAll<HTMLElement>(".dp-block")].find((b) => mark && Number(b.dataset.start) <= mark.start && mark.start < Number(b.dataset.end));
				target?.scrollIntoView({ block: "center", behavior: "smooth" });
			};
			panel.append(item);
		}
	}

	function hot(change: string, on: boolean): void {
		for (const node of text.querySelectorAll<HTMLElement>(`.dp-ins[data-change="${change}"]`)) node.toggleAttribute("data-hot", on);
	}

	function drawHistory(): void {
		panel.replaceChildren(el("h3", {}, "History"));
		if (versions.length === 0) panel.append(el("p", { class: "dp-empty" }, "No versions kept yet."));
		for (const version of [...versions].reverse()) {
			const item = el("div", { class: "dp-item" });
			const restore = el("button", { type: "button" }, "Restore");
			restore.onclick = () => sync.restore(version.sha);
			item.append(el("b", {}, new Date(version.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })), el("div", { class: "dp-snip" }), restore);
			panel.append(item);
		}
	}

	sourceButton.onclick = () => setMode(mode === "source" ? "page" : "source");
	suggestionsButton.onclick = () => show("suggestions");
	historyButton.onclick = () => show("history");
	writeButton.onclick = () => {
		writeButton.disabled = true;
		sync.writeBack();
	};

	const stop = options.listen((message) => {
		sync.receive(message);
		if (message.type === "doc.versions" && message.path === sync.path) {
			versions = message.versions;
			if (view === "history") drawHistory();
		}
		if (message.type === "doc.written" && message.path === sync.path) {
			writeButton.disabled = false;
			written = message.error ? "" : `Written to ${base(message.source ?? "")} at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
			if (message.error) {
				status.dataset.state = "error";
				status.textContent = message.error;
				return;
			}
		}
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
			sync.close();
			stop();
		},
	};
}
