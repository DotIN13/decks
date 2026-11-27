import { m } from "@decks/i18n";
import type { PageContext } from "./context.ts";
import type { BlockStyle, FormatState, InlineStyle } from "./live.ts";
import { askLink, buildGoogleTools, googlePressed } from "./gtools.ts";
import { el, keyName, svg } from "./ui.ts";

/**
 * The styling tools over a markdown or LaTeX page: the paragraph style, the marks, the blocks, undo.
 * A Google Doc has its own row, what Google's toolbar has (`gtools.ts`), built on the same pieces.
 */

/** What both rows are built on: the buttons by name, to show what is pressed, and the paragraph style menu. */
export interface Toolbar {
	buttons: Map<string, HTMLButtonElement>;
	styleBox: HTMLElement;
	/** The paragraph styles the menu offers, as value and label. */
	styles: Array<[string, string]>;
	/** The style at the caret. */
	styleNow: string;
	/** Write the style at the caret on the menu's button. */
	styleLabel(): void;
	/** A Google Doc's font and size, shown as they are at the caret. */
	font?: HTMLSelectElement;
	size?: HTMLInputElement;
}

export function mountTools(ctx: PageContext): () => void {
	const { live, gview } = ctx;
	const { tools } = ctx.dom;
	// The paragraph style: a button naming it, and a menu drawing each style as it reads.
	const styleBox = el("div", { class: "dp-style" });
	const styleButton = el("button", { type: "button", class: "dp-btn", title: m.docs_paragraph_style(), "aria-haspopup": "menu", "aria-expanded": "false" });
	const styleMenu = el("div", { class: "dp-menu", role: "menu", hidden: "" });
	styleBox.append(styleButton, styleMenu);
	const bar: Toolbar = {
		buttons: new Map(),
		styleBox,
		styles: [],
		styleNow: "p",
		styleLabel: () => {
			styleButton.innerHTML = "";
			styleButton.append(el("span", {}, bar.styles.find(([v]) => v === bar.styleNow)?.[1] ?? m.docs_style_body()));
			styleButton.insertAdjacentHTML("beforeend", svg("chevron"));
		},
	};
	const closeMenu = () => {
		styleMenu.hidden = true;
		styleButton.setAttribute("aria-expanded", "false");
	};
	styleButton.addEventListener("mousedown", (event) => event.preventDefault());
	styleButton.onclick = () => {
		const open = styleMenu.hidden;
		styleMenu.replaceChildren(
			...bar.styles.map(([value, label]) => {
				const item = el("button", { type: "button", role: "menuitemradio", class: `m-${value}`, "aria-checked": String(value === bar.styleNow) }, label);
				item.addEventListener("mousedown", (event) => event.preventDefault());
				item.onclick = () => {
					closeMenu();
					if (ctx.isGoogle()) gview.setParagraph({ namedStyleType: value }, "namedStyleType");
					else live.setBlock(value as BlockStyle);
				};
				return item;
			}),
		);
		styleMenu.hidden = !open;
		styleButton.setAttribute("aria-expanded", String(open));
	};
	const outside = (event: MouseEvent) => {
		if (!styleBox.contains(event.target as Node)) closeMenu();
	};
	document.addEventListener("mousedown", outside);

	ctx.hooks.buildTools = () => {
		tools.replaceChildren();
		bar.buttons.clear();
		if (ctx.isGoogle()) buildGoogleTools(ctx, bar);
		else buildPageTools(ctx, bar);
	};
	ctx.hooks.pressed = (state) => pressed(bar, state);
	ctx.hooks.gpressed = () => googlePressed(ctx, bar);
	ctx.hooks.askLink = () => askLink(ctx);
	return () => document.removeEventListener("mousedown", outside);
}

/** A row of tools in bordered groups, one per kind; `sep` closes the group being filled. */
export function toolGroups(tools: HTMLElement, bar: Toolbar) {
	let group = el("div", { class: "dp-group" });
	const sep = () => {
		if (group.childElementCount) tools.append(group);
		group = el("div", { class: "dp-group" });
	};
	const add = (node: HTMLElement) => group.append(node);
	const button = (key: string, title: string, run: () => void, icon = key) => {
		const b = el("button", { type: "button", class: "dp-ib", title, "aria-label": title, "aria-pressed": "false" });
		b.innerHTML = svg(icon);
		// Pressing a tool keeps the caret where it is in the page.
		b.addEventListener("mousedown", (event) => event.preventDefault());
		b.addEventListener("click", () => run());
		bar.buttons.set(key, b);
		group.append(b);
		return b;
	};
	return { button, add, sep };
}

/** Markdown's tools, or LaTeX's fewer: groups for marks, inline objects, blocks, inserts, history. */
function buildPageTools(ctx: PageContext, bar: Toolbar): void {
	const { live } = ctx;
	const { tools } = ctx.dom;
	const tex = ctx.isTex();
	const { button, sep } = toolGroups(tools, bar);
	bar.styles = tex
		? [["p", m.docs_style_body_text()], ["h1", m.docs_style_section()], ["h2", m.docs_style_subsection()], ["h3", m.docs_style_subsubsection()], ["h4", m.docs_style_paragraph_heading()]]
		: [["p", m.docs_style_body_text()], ["h1", m.docs_style_heading({ level: 1 })], ["h2", m.docs_style_heading({ level: 2 })], ["h3", m.docs_style_heading({ level: 3 })], ["h4", m.docs_style_heading({ level: 4 })], ["h5", m.docs_style_heading({ level: 5 })], ["h6", m.docs_style_heading({ level: 6 })]];
	bar.styleLabel();
	tools.append(bar.styleBox);
	const inline = (key: InlineStyle, title: string) => button(key, title, () => live.toggle(key));
	inline("bold", m.docs_tool_bold({ key: keyName("Mod+B") }));
	inline("italic", m.docs_tool_italic({ key: keyName("Mod+I") }));
	inline("underline", m.docs_tool_underline({ key: keyName("Mod+U") }));
	if (!tex) inline("strike", m.docs_tool_strike({ key: keyName("Mod+Shift+X") }));
	sep();
	inline("code", m.docs_tool_code({ key: keyName("Mod+E") }));
	if (!tex) inline("mark", m.docs_tool_highlight({ key: keyName("Mod+Shift+H") }));
	button("link", m.docs_tool_link({ key: keyName("Mod+K") }), () => live.link());
	inline("math", m.docs_tool_math({ key: keyName("Mod+Shift+M") }));
	sep();
	button("ul", m.docs_tool_bullets({ key: keyName("Mod+Shift+8") }), () => live.setBlock("ul"));
	if (!tex) {
		button("ol", m.docs_tool_numbers({ key: keyName("Mod+Shift+7") }), () => live.setBlock("ol"));
		button("task", m.docs_tool_tasks(), () => live.setBlock("task"));
		button("quote", m.docs_tool_quote(), () => live.setBlock("quote"));
		button("codeblock", m.docs_tool_codeblock(), () => live.setBlock("code"));
		sep();
		button("table", m.docs_tool_table(), () => live.insertBlock("table"));
		button("hr", m.docs_tool_rule(), () => live.insertBlock("hr"));
	} else {
		button("ol", m.docs_tool_numbered(), () => live.setBlock("ol"));
		button("display", m.docs_tool_equation(), () => live.insertBlock("math"));
	}
	sep();
	button("undo", m.docs_tool_undo({ key: keyName("Mod+Z") }), () => live.undo());
	button("redo", m.docs_tool_redo({ key: keyName("Mod+Shift+Z") }), () => live.redo());
	sep();
}

/** The styles at the caret, pressed in the markdown or LaTeX tools. */
function pressed(bar: Toolbar, state: FormatState): void {
	const { buttons } = bar;
	for (const key of ["bold", "italic", "strike", "underline", "code", "mark", "link", "math"] as const) buttons.get(key)?.setAttribute("aria-pressed", String(state[key]));
	for (const key of ["ul", "ol", "task", "quote"] as const) buttons.get(key)?.setAttribute("aria-pressed", String(state.block === key));
	buttons.get("codeblock")?.setAttribute("aria-pressed", String(state.block === "code"));
	const block = /^h[1-6]$/.test(state.block) ? state.block : "p";
	if (bar.styles.some(([v]) => v === block) && block !== bar.styleNow) {
		bar.styleNow = block;
		bar.styleLabel();
	}
}
