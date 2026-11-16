// The editor's page written back as the card's markdown, block by block, and the
// selection helpers that find a block and put the caret after a node.
import { EMOJI_OF, FACE_ALIAS, type Colour } from "../card-syntax.ts";
import { ZW, h } from "./model.ts";
import type { EditorCtx } from "./ctx.ts";

// The page written back as markdown
export function serialise(cx: EditorCtx): string {
	let s = cx.lead;
	const kids = [...cx.ed.childNodes];
	kids.forEach((n, i) => {
		let el: HTMLElement;
		if (n instanceof HTMLElement) el = n;
		else if (n.nodeType === 3 && n.textContent?.replace(/​/g, "").trim()) el = Object.assign(h("p"), { textContent: n.textContent });
		else return;
		const text = el.dataset.raw !== undefined && !el.dataset.dirty ? el.dataset.raw : outBlock(el);
		if (!text.trim() && el.tagName === "P") return;
		s += text + (i < kids.length - 1 ? el.dataset.sep || "\n\n" : "");
	});
	return s.replace(/\s+$/, "") + cx.trail;
}

export function outBlock(el: HTMLElement): string {
	switch (el.tagName) {
		case "H1":
		case "H2":
		case "H3":
		case "H4":
		case "H5":
		case "H6":
			return `${"#".repeat(Number(el.tagName[1]))} ${out(el).trim()}`;
		case "UL":
		case "OL":
			return outList(el, "");
		case "BLOCKQUOTE": {
			const body = [...el.children].filter((c) => !c.classList.contains("pce-chead")).map((c) => outBlock(c as HTMLElement)).join("\n\n");
			const lines = body ? body.split("\n").map((l) => (l ? `> ${l}` : ">")) : [];
			// The title is written only when it says something the type does not: Obsidian shows the type's name.
			const chead = el.querySelector(":scope > .pce-chead");
			const type = el.dataset.callout ?? "";
			const title = chead ? out(chead).replace(/\s+/g, " ").trim() : "";
			const named = title && (el.hasAttribute("data-titled") || title !== type.charAt(0).toUpperCase() + type.slice(1));
			const head = el.dataset.mark ? [`> ${el.dataset.mark}${named ? ` ${title}` : ""}`] : [];
			return [...head, ...lines].join("\n") || ">";
		}
		case "TABLE": {
			const rows = [...el.querySelectorAll("tr")];
			const cells = (row: Element) => [...row.children].map((cell) => out(cell).replace(/\n/g, " ").replace(/\|/g, "\\|").trim());
			const header = cells(rows[0] ?? el);
			const align = (el.dataset.align ?? "").split(",");
			const rule = header.map((_, i) => ({ left: ":--", right: "--:", center: ":-:" })[align[i] as "left"] ?? "---");
			return [header, rule, ...rows.slice(1).map(cells)].map((row) => `| ${row.join(" | ")} |`).join("\n");
		}
		case "PRE":
			return "```" + (el.dataset.lang ?? "") + "\n" + (el.textContent ?? "").replace(/\n$/, "") + "\n```";
		default:
			if (el.classList.contains("pce-rawedit")) return el.textContent ?? "";
			if (el.dataset.raw !== undefined && el.getAttribute("contenteditable") === "false") return el.dataset.raw;
			return out(el);
	}
}

export function out(node: Node): string {
	let s = "";
	for (const n of node.childNodes) {
		if (n.nodeType === 3) {
			s += (n.textContent ?? "").replace(/​/g, "");
			continue;
		}
		if (!(n instanceof HTMLElement)) continue;
		const inner = () => out(n);
		// Spaces at either end go outside the marks: `** bold**` is not bold, in Obsidian or anywhere.
		const wrapIn = (open: string, close = open) => {
			const text = inner();
			if (!text.trim()) return text;
			const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
			return lead + open + core + close + trail;
		};
		if (n.dataset.raw !== undefined && n.getAttribute("contenteditable") === "false") s += n.dataset.raw;
		else
			switch (n.tagName) {
				case "STRONG":
				case "B":
					s += wrapIn("**");
					break;
				case "EM":
				case "I":
					s += wrapIn("*");
					break;
				case "S":
				case "DEL":
				case "STRIKE":
					s += wrapIn("~~");
					break;
				case "CODE":
					s += wrapIn("`");
					break;
				case "MARK":
					s += wrapIn(`==${n.dataset.c ? EMOJI_OF[n.dataset.c as Colour] : ""}`, "==");
					break;
				case "A":
					s += `[${inner()}](${n.dataset.href ?? ""})`;
					break;
				case "BR":
					s += "  \n";
					break;
				case "SPAN": {
					// A chain of styled spans, one inside the next, is one span with all their classes.
					const classes = new Map<string, string>();
					let at: HTMLElement = n;
					for (;;) {
						if (at.dataset.fg) classes.set("fg", at.dataset.fg);
						if (at.dataset.size) classes.set("size", at.dataset.size);
						if (at.dataset.font) classes.set("font", at.dataset.font);
						const only = at.childNodes.length === 1 ? at.firstChild : null;
						if (only instanceof HTMLElement && only.tagName === "SPAN" && (only.dataset.fg || only.dataset.size || only.dataset.font)) at = only;
						else break;
					}
					if (!classes.size) {
						s += inner();
						break;
					}
					const text = out(at);
					if (!text.trim()) {
						s += text;
						break;
					}
					const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
					// A font is an attribute, `font="Lora"`; a colour and a size are classes.
					const attributes = [...classes].map(([kind, value]) => (kind === "font" ? (Object.entries(FACE_ALIAS).find(([, family]) => family === value)?.[0] ? `.${Object.entries(FACE_ALIAS).find(([, family]) => family === value)![0]}` : `font="${value}"`) : `.${value}`));
					s += `${lead}[${core}]{${attributes.join(" ")}}${trail}`;
					break;
				}
				case "U":
					s += wrapIn("<u>", "</u>");
					break;
				default:
					s += inner();
			}
	}
	return s;
}

export function outList(el: HTMLElement, indent: string): string {
	const ordered = el.tagName === "OL";
	const start = Number(el.getAttribute("start") ?? 1);
	const items = [...el.children].filter((c) => c.tagName === "LI") as HTMLElement[];
	return items
		.map((li, i) => {
			const check = li.querySelector(":scope > .pce-check");
			const marker = ordered ? `${start + i}. ` : "- ";
			const pad = indent + " ".repeat(marker.length);
			const parts: string[] = [];
			let run = "";
			for (const n of li.childNodes) {
				if (n instanceof HTMLElement && (n.tagName === "UL" || n.tagName === "OL")) {
					if (run) parts.push(run), (run = "");
					parts.push(outList(n, pad).replace(/^ +/, ""));
				} else if (n instanceof HTMLElement && (n.tagName === "P" || n.tagName === "DIV") && !n.classList.contains("pce-atom")) {
					if (run) parts.push(run), (run = "");
					parts.push(out(n));
				} else if (n instanceof HTMLElement && n.classList.contains("pce-check")) continue;
				else if (n instanceof HTMLElement && n.classList.contains("pce-raw")) {
					if (run) parts.push(run), (run = "");
					parts.push(n.dataset.raw ?? "");
				} else run += out(wrapNode(n));
			}
			if (run || !parts.length) parts.push(run);
			const body = parts.map((part, k) => (k === 0 ? part.trim() : part)).join(el.hasAttribute("data-loose") ? "\n\n" : "\n").replace(/\n/g, `\n${pad}`).replace(/\n +\n/g, "\n\n");
			return indent + marker + (check ? (check.hasAttribute("data-on") ? "[x] " : "[ ] ") : "") + body;
		})
		.join(el.hasAttribute("data-loose") ? "\n\n" : "\n");
}

/** One node, as the child of something, so `out` can be asked about it alone. */
export const wrapNode = (n: Node) => {
	const holder = document.createElement("span");
	holder.append(n.cloneNode(true));
	return holder;
};

// Finding a block and placing the caret
export const sel = () => getSelection()!;

export const topOf = (cx: EditorCtx, n: Node | null): HTMLElement | undefined => {
	while (n && n.parentNode !== cx.ed) n = n.parentNode;
	return n instanceof HTMLElement ? n : undefined;
};

export function placeAfter(node: Node) {
	const z = document.createTextNode(ZW);
	node.parentNode!.insertBefore(z, node.nextSibling);
	const r = document.createRange();
	r.setStart(z, 1);
	r.collapse(true);
	sel().removeAllRanges();
	sel().addRange(r);
}
