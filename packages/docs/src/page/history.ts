import type { DocVersion } from "../index.ts";
import type { DocSync } from "../client.ts";
import { spliceDiff } from "../merge.ts";
import { getLocale, m } from "@decks/i18n";
import { docxBlocks, readParagraph } from "./blocks.ts";
import type { PageContext } from "./context.ts";
import { GoogleView } from "./gview.ts";
import { LiveEditor } from "./live.ts";
import type { Mark } from "./marks.ts";
import { el, iconButton, svg, when } from "./ui.ts";

/**
 * History: every pause is a kept version, listed in the History panel; one pressed is shown in
 * place of the page as it read, with what differs from now highlighted, and can be restored.
 */

export function mountHistory(ctx: PageContext): () => void {
	const { sync, live, reading, gview, options } = ctx;
	const { panel, banner, old, scroll, text, tools, status } = ctx.dom;
	let versions: DocVersion[] = [];
	/** The kept version being looked at, instead of the page as it is now. */
	let viewing: { sha: string; at?: number; text: string; editor?: LiveEditor } | undefined;
	/** The History row last pressed: one text kept twice has one id, so the row says which time is meant. */
	let picked: { sha: string; at: number } | undefined;

	function drawHistory(): void {
		panel.replaceChildren(ctx.hooks.header(m.docs_history()));
		if (versions.length === 0) panel.append(el("p", { class: "dp-empty" }, m.docs_no_versions()));
		const today = new Date().toDateString();
		for (const [i, version] of [...versions].reverse().entries()) {
			const date = new Date(version.at);
			const item = el("div", { class: i === 0 ? "dp-time t-latest" : "dp-time", "aria-current": String(viewing?.sha === version.sha && viewing.at === version.at), title: m.docs_show_version() });
			const label = el("span", { class: "t-when" }, date.toLocaleTimeString(getLocale(), { hour: "numeric", minute: "2-digit", second: "2-digit" }));
			if (date.toDateString() !== today) label.append(el("small", {}, date.toLocaleDateString(getLocale(), { month: "short", day: "numeric" })));
			item.append(label);
			if (!sync.readOnly) {
				const restore = iconButton("restore", m.docs_restore_version(), "dp-ib dp-sm");
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
		const word = ctx.isWord();
		live.root.hidden = true;
		reading.root.hidden = true;
		gview.root.hidden = true;
		text.hidden = true;
		tools.hidden = true;
		if (ctx.isGoogle()) {
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
			const stub = { text: source, readOnly: true, ready: true, path: sync.path, format: sync.format } as unknown as DocSync;
			const editor = new LiveEditor(stub, { ...(options.math ? { math: options.math } : {}), marks: () => marks2, changes: () => [] });
			editor.root.dataset.preview = "";
			editor.root.toggleAttribute("data-tex", ctx.isTex());
			editor.reset();
			viewing.editor = editor;
			live.root.after(editor.root);
		}
		const restore = el("button", { type: "button", class: "dp-btn dp-sm dp-primary" }, m.docs_restore());
		const back = iconButton("x", m.docs_back_to_now(), "dp-ib dp-sm");
		restore.onclick = () => restoreTo(sha);
		back.onclick = () => closeVersion();
		const icon = el("span");
		icon.innerHTML = svg("clock");
		banner.replaceChildren(icon.firstElementChild!, el("b", {}, at ? when(at) : m.docs_earlier_version()), el("span", { class: "dp-spacer" }), ...(sync.readOnly ? [] : [restore]), back);
		banner.hidden = false;
		scroll.scrollTop = 0;
		if (ctx.view === "history") drawHistory();
	}

	function closeVersion(redraw = true): void {
		if (!viewing) return;
		viewing.editor?.destroy();
		viewing.editor?.root.remove();
		viewing = undefined;
		banner.hidden = true;
		old.hidden = true;
		if (redraw) {
			const word = ctx.isWord();
			const google = ctx.isGoogle();
			live.root.hidden = ctx.mode !== "page" || word || google;
			reading.root.hidden = ctx.mode !== "page" || !word;
			gview.root.hidden = ctx.mode !== "page" || !google;
			text.hidden = ctx.mode !== "source";
			tools.hidden = ctx.mode !== "page" || word || sync.readOnly || !sync.ready;
			if (ctx.view === "history") drawHistory();
		}
	}

	ctx.on("doc.versions", (message) => {
		versions = message.versions;
		if (ctx.view === "history") drawHistory();
	});
	ctx.on("doc.version", (message) => {
		if (message.text !== undefined) openVersion(message.sha, picked?.sha === message.sha ? picked.at : message.at, message.text);
		else if (message.error) {
			status.dataset.state = "error";
			status.textContent = message.error;
		}
	});
	// A restore or someone's edit while looking at a version: the History list grows.
	ctx.on("doc.changed", (message) => {
		if (ctx.view === "history" && !message.client) sync.versions();
	});
	ctx.hooks.isViewing = () => !!viewing;
	ctx.hooks.closeVersion = () => closeVersion();
	return () => viewing?.editor?.destroy();
}
