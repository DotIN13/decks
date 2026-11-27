import { m } from "@decks/i18n";
import type { PageContext } from "./context.ts";
import { toolGroups, type Toolbar } from "./tools.ts";
import { el, keyName } from "./ui.ts";

/**
 * A Google Doc's own tools: what Google's toolbar has (undo, paragraph style, font and size, marks
 * and colours, link, alignment, lists, tables, comment), each sent to Google as Docs requests.
 */

const FONTS = ["Arial", "Roboto", "Times New Roman", "Georgia", "Lato", "Merriweather", "Montserrat", "Open Sans", "Playfair Display", "Source Sans 3", "Courier New", "Verdana", "Comic Sans MS"];

/** What Google's toolbar has, sent to Google as Docs requests. */
export function buildGoogleTools(ctx: PageContext, bar: Toolbar): void {
	const { gview } = ctx;
	const { tools } = ctx.dom;
	const { button, add, sep } = toolGroups(tools, bar);
	button("undo", m.docs_tool_undo({ key: keyName("Mod+Z") }), () => gview.undo());
	button("redo", m.docs_tool_redo({ key: keyName("Mod+Shift+Z") }), () => gview.redo());
	sep();
	bar.styles = [["NORMAL_TEXT", m.docs_style_normal()], ["TITLE", m.docs_style_title()], ["SUBTITLE", m.docs_style_subtitle()], ["HEADING_1", m.docs_style_heading({ level: 1 })], ["HEADING_2", m.docs_style_heading({ level: 2 })], ["HEADING_3", m.docs_style_heading({ level: 3 })], ["HEADING_4", m.docs_style_heading({ level: 4 })]];
	bar.styleNow = "NORMAL_TEXT";
	bar.styleLabel();
	tools.append(bar.styleBox);
	const font = el("select", { class: "dp-select", title: m.docs_tool_font(), "aria-label": m.docs_tool_font() });
	for (const f of FONTS) font.append(el("option", { value: f, style: `font-family: "${f}"` }, f));
	font.onchange = () => {
		gview.setText("weightedFontFamily", { fontFamily: font.value });
		gview.focus();
	};
	bar.font = font;
	add(font);
	sep();
	const size = el("input", { class: "dp-size", type: "text", inputmode: "numeric", title: m.docs_tool_font_size(), "aria-label": m.docs_tool_font_size() });
	const setSize = (value: number) => {
		const v = Math.max(1, Math.min(400, Math.round(value)));
		size.value = String(v);
		gview.setText("fontSize", { magnitude: v, unit: "PT" });
	};
	button("smaller", m.docs_tool_smaller(), () => setSize(Number(size.value || 11) - 1), "minus");
	add(size);
	button("bigger", m.docs_tool_bigger(), () => setSize(Number(size.value || 11) + 1), "plus");
	size.onchange = () => {
		setSize(Number(size.value) || 11);
		gview.focus();
	};
	bar.size = size;
	sep();
	button("bold", m.docs_tool_bold({ key: keyName("Mod+B") }), () => gview.toggle("bold"));
	button("italic", m.docs_tool_italic({ key: keyName("Mod+I") }), () => gview.toggle("italic"));
	button("underline", m.docs_tool_underline({ key: keyName("Mod+U") }), () => gview.toggle("underline"));
	button("strike", m.docs_tool_strike({ key: keyName("Mod+Shift+X") }), () => gview.toggle("strikethrough"));
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
	colour("colour", m.docs_tool_text_colour(), "foregroundColor");
	colour("highlight", m.docs_tool_highlight_colour(), "backgroundColor");
	sep();
	button("link", m.docs_tool_link({ key: keyName("Mod+K") }), () => askLink(ctx));
	sep();
	const align = (key: string, title: string, value: string) => button(key, title, () => gview.setParagraph({ alignment: value }, "alignment"));
	align("alignleft", m.docs_tool_align_left(), "START");
	align("aligncenter", m.docs_tool_align_centre(), "CENTER");
	align("alignright", m.docs_tool_align_right(), "END");
	align("justify", m.docs_tool_justify(), "JUSTIFIED");
	sep();
	button("ul", m.docs_tool_bullets({ key: keyName("Mod+Shift+8") }), () => gview.list(false));
	button("ol", m.docs_tool_numbers({ key: keyName("Mod+Shift+7") }), () => gview.list(true));
	button("outdent", m.docs_tool_outdent({ key: keyName("Mod+[") }), () => gview.indent(-1));
	button("indent", m.docs_tool_indent({ key: keyName("Mod+]") }), () => gview.indent(1));
	sep();
	button("table", m.docs_tool_insert_table(), () => gview.table("insert"));
	// Rows and columns, for the cell the caret is in.
	button("rowabove", m.docs_tool_row_above(), () => gview.table("rowAbove"));
	button("rowbelow", m.docs_tool_row_below(), () => gview.table("rowBelow"));
	button("colleft", m.docs_tool_col_left(), () => gview.table("colLeft"));
	button("colright", m.docs_tool_col_right(), () => gview.table("colRight"));
	button("rowdelete", m.docs_tool_delete_row(), () => gview.table("deleteRow"));
	button("coldelete", m.docs_tool_delete_col(), () => gview.table("deleteCol"));
	sep();
	button("comment", m.docs_tool_comment(), () => ctx.hooks.newComment());
	button("clear", m.docs_tool_clear({ key: keyName("Mod+\\") }), () => gview.clearFormatting());
	sep();
	googlePressed(ctx, bar);
}

/** Ask for a link and put it on the selected words; an empty answer takes the link off. */
export function askLink(ctx: PageContext): void {
	const { gview } = ctx;
	const url = window.prompt(m.docs_link_prompt(), "https://");
	if (url !== null) gview.link(url.trim() && url.trim() !== "https://" ? url.trim() : undefined);
	gview.focus();
}

/** The styles at the caret, shown in a Doc's tools: pressed, its font and size, the table tools in a cell. */
export function googlePressed(ctx: PageContext, bar: Toolbar): void {
	const { gview } = ctx;
	const { buttons } = bar;
	if (!ctx.isGoogle() || !gview.loaded) return;
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
	if (bar.font && document.activeElement !== bar.font) {
		if (![...bar.font.options].some((o) => o.value === state.font)) bar.font.append(el("option", { value: state.font }, state.font));
		bar.font.value = state.font;
	}
	if (bar.size && document.activeElement !== bar.size) bar.size.value = String(Math.round(state.size * 10) / 10);
	const type = state.type === "TITLE" || state.type === "SUBTITLE" || state.type.startsWith("HEADING_") ? state.type : "NORMAL_TEXT";
	if (type !== bar.styleNow) {
		bar.styleNow = type;
		if (!bar.styles.some(([v]) => v === type)) bar.styles.push([type, type.startsWith("HEADING_") ? m.docs_style_heading({ level: type.slice("HEADING_".length) }) : type]);
		bar.styleLabel();
	}
}
