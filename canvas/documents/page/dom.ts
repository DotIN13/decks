import type { DocPageOptions } from "../page.ts";
import { base, el, svg } from "./parts.ts";

/** The elements a document page is made of, built once and put in its host: the bar, the tools, the text, the panel and the PDF pane. */

export function buildPage(host: HTMLElement, options: DocPageOptions) {
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
	return { name, status, iconButton, sourceButton, historyButton, pdfButton, changesButton, commentsButton, gitBox, gitButton, gitMenu, googleBox, googleButton, googleMenu, tools, main, scroll, text, panel, banner, old, pill, divider, pdfPane, pdfBar, pdfState, errButton, errList, pdfBody };
}
