/**
 * A document page's history: the History panel's list of kept versions, and looking at one of them
 * in place of the page, with Restore to bring it back. Each takes the page it acts on (page.ts).
 */
import type { DocSync as Sync } from "../client.ts";
import { docxBlocks, readParagraph } from "../blocks.ts";
import type { Mark } from "../marks.ts";
import { spliceDiff } from "../merge.ts";
import { LiveEditor } from "../live.ts";
import { GoogleView } from "../gview.ts";
import { el, svg, when } from "./parts.ts";
import type { DocPageView } from "../page.ts";

/** The History panel: every kept version, newest first, each opened by a press and restored by its button. */
export function drawHistory(page: DocPageView): void {
	page.parts.panel.replaceChildren(page.header("History"));
	if (page.versions.length === 0) page.parts.panel.append(el("p", { class: "dp-empty" }, "No versions yet."));
	const today = new Date().toDateString();
	for (const [i, version] of [...page.versions].reverse().entries()) {
		const date = new Date(version.at);
		const item = el("div", { class: i === 0 ? "dp-time t-latest" : "dp-time", "aria-current": String(page.viewing?.sha === version.sha && page.viewing.at === version.at), title: "Show this version" });
		const label = el("span", { class: "t-when" }, date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
		if (date.toDateString() !== today) label.append(el("small", {}, date.toLocaleDateString([], { month: "short", day: "numeric" })));
		item.append(label);
		if (!page.sync.readOnly) {
			const restore = page.parts.iconButton("restore", "Restore this version", "dp-ib dp-sm");
			restore.onclick = (event) => (event.stopPropagation(), restoreTo(page, version.sha));
			item.append(restore);
		}
		item.onclick = () => {
			if (page.viewing?.sha === version.sha && page.viewing.at === version.at) return closeVersion(page);
			page.picked = { sha: version.sha, at: version.at };
			page.sync.version(version.sha);
		};
		page.parts.panel.append(item);
	}
}

/** Bring a kept version back as the file's text, and return to now. */
export function restoreTo(page: DocPageView, sha: string): void {
	page.sync.restore(sha);
	closeVersion(page);
}

/** Show a kept version instead of the page, what differs from now highlighted, under a banner that restores it. */
export function openVersion(page: DocPageView, sha: string, at: number | undefined, source: string): void {
	closeVersion(page, false);
	page.viewing = { sha, ...(at ? { at } : {}), text: source };
	const word = page.isWord();
	page.live.root.hidden = true;
	page.reading.root.hidden = true;
	page.gview.root.hidden = true;
	page.parts.text.hidden = true;
	page.parts.tools.hidden = true;
	if (page.isGoogle()) {
		// A Doc's version reads as its words; its styles are Google's, in Google's own version history.
		page.parts.old.replaceChildren(...GoogleView.plain(source).split("\n").map((line) => el("p", {}, line)));
		page.parts.old.hidden = false;
	} else if (word) {
		// A Word version reads as its paragraphs' words.
		page.parts.old.replaceChildren(...docxBlocks(source).filter((b) => b.kind === "text").map((b) => el("p", {}, readParagraph(source.slice(b.start, b.end)).text)));
		page.parts.old.hidden = false;
	} else {
		// What differs from now is highlighted: the words Restore would bring back.
		const diff = spliceDiff(page.sync.text, source);
		const marks2: Mark[] = [];
		// Splices in source order: each one's place holds in the version's text.
		for (const s of diff) {
			if (s.text) marks2.push({ change: "then", kind: "ins", start: s.at, end: s.at + s.text.length });
			else marks2.push({ change: "then", kind: "del", at: s.at, text: s.before });
		}
		const stub = { text: source, readOnly: true, ready: true, path: page.sync.path, format: page.sync.format } as unknown as Sync;
		const editor = new LiveEditor(stub, { ...(page.options.math ? { math: page.options.math } : {}), marks: () => marks2, changes: () => [] });
		editor.root.dataset.preview = "";
		editor.root.toggleAttribute("data-tex", page.isTex());
		editor.reset();
		page.viewing.editor = editor;
		page.live.root.after(editor.root);
	}
	const restore = el("button", { type: "button", class: "dp-btn dp-sm dp-primary" }, "Restore");
	const back = page.parts.iconButton("x", "Back to now", "dp-ib dp-sm");
	restore.onclick = () => restoreTo(page, sha);
	back.onclick = () => closeVersion(page);
	const icon = el("span");
	icon.innerHTML = svg("clock");
	page.parts.banner.replaceChildren(icon.firstElementChild!, el("b", {}, at ? when(at) : "Earlier version"), el("span", { class: "dp-spacer" }), ...(page.sync.readOnly ? [] : [restore]), back);
	page.parts.banner.hidden = false;
	page.parts.scroll.scrollTop = 0;
	if (page.view === "history") drawHistory(page);
}

/** Back to the page as it is now; `redraw` false when another version opens at once. */
export function closeVersion(page: DocPageView, redraw = true): void {
	if (!page.viewing) return;
	page.viewing.editor?.destroy();
	page.viewing.editor?.root.remove();
	page.viewing = undefined;
	page.parts.banner.hidden = true;
	page.parts.old.hidden = true;
	if (redraw) {
		const word = page.isWord();
		const google = page.isGoogle();
		page.live.root.hidden = page.mode !== "page" || word || google;
		page.reading.root.hidden = page.mode !== "page" || !word;
		page.gview.root.hidden = page.mode !== "page" || !google;
		page.parts.text.hidden = page.mode !== "source";
		page.parts.tools.hidden = page.mode !== "page" || word || page.sync.readOnly || !page.sync.ready;
		if (page.view === "history") drawHistory(page);
	}
}
