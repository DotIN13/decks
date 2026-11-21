import { For } from "solid-js";
import { m } from "@decks/i18n";
import Baseline from "lucide-solid/icons/baseline";
import Bold from "lucide-solid/icons/bold";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Code from "lucide-solid/icons/code";
import Highlighter from "lucide-solid/icons/highlighter";
import Italic from "lucide-solid/icons/italic";
import Link from "lucide-solid/icons/link";
import List from "lucide-solid/icons/list";
import ListChecks from "lucide-solid/icons/list-checks";
import ListOrdered from "lucide-solid/icons/list-ordered";
import Minus from "lucide-solid/icons/minus";
import Redo2 from "lucide-solid/icons/redo-2";
import RemoveFormatting from "lucide-solid/icons/remove-formatting";
import SquareCode from "lucide-solid/icons/square-code";
import Strikethrough from "lucide-solid/icons/strikethrough";
import Table from "lucide-solid/icons/table";
import TextQuote from "lucide-solid/icons/text-quote";
import Underline from "lucide-solid/icons/underline";
import Undo2 from "lucide-solid/icons/undo-2";
import { FONT_GROUPS } from "../model/card-syntax.ts";
import { BLOCK_MENU, SIZE_MENU, SIX } from "./card-menus.ts";

/**
 * The style bar's markup: two rows of buttons and the menus they open. What a press on any of them
 * does is read from its `data-` attribute by one handler (`card-blocks.ts`, `style`); where the bar
 * sits and what it shows pressed is `card-bar.ts`.
 */
/** A group of fonts in the font menu, in the person's language. */
const fontGroupName = (group: string): string => ({ Sans: m.canvas_card_fonts_sans, Serif: m.canvas_card_fonts_serif, Mono: m.canvas_card_fonts_mono, "Hand and display": m.canvas_card_fonts_display } as Record<string, () => string>)[group]?.() ?? group;

/** One of the six colours of a mark or of words, in the person's language. */
const colourName = (colour: (typeof SIX)[number]): string => ({ yellow: m.canvas_card_colour_yellow, orange: m.canvas_card_colour_orange, red: m.canvas_card_colour_red, green: m.canvas_card_colour_green, blue: m.canvas_card_colour_blue, purple: m.canvas_card_colour_purple })[colour]();

export function CardBarView(p: { bar: (el: HTMLDivElement) => void; tools: (el: HTMLDivElement) => void; onStyle: (event: MouseEvent) => void; onScroll: () => void }) {
	return (
		<div ref={p.bar} class="pce-bar" data-off onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={p.onStyle}>
			<div ref={p.tools} class="pce-tools" onScroll={p.onScroll}>
				{/* Two rows: what the words are set in, and what is done to them. */}
				<div class="pce-row">
					<button type="button" class="pce-pick pce-pick-block" data-menu="block" title={m.canvas_card_block_title()}>
						<span data-label="block">{m.canvas_card_block_body()}</span>
						<ChevronDown size={16} />
					</button>
					<button type="button" class="pce-pick pce-pick-font" data-menu="font" title={m.canvas_props_font()}>
						<span data-label="font">Inter</span>
						<ChevronDown size={16} />
					</button>
					<button type="button" class="pce-pick pce-pick-size" data-menu="size" title={m.canvas_card_size()}>
						<span data-label="size">{m.canvas_card_size_normal()}</span>
						<ChevronDown size={16} />
					</button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-cmd="undo" title={m.canvas_card_undo()}><Undo2 size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="redo" title={m.canvas_card_redo()}><Redo2 size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="clear" title={m.canvas_card_clear()}><RemoveFormatting size={18} /></button>
				</div>
				<div class="pce-row">
					<button type="button" class="pce-icon" data-cmd="bold" title={m.canvas_card_bold()}><Bold size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="italic" title={m.canvas_card_italic()}><Italic size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="underline" title={m.canvas_card_underline()}><Underline size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="strikeThrough" title={m.canvas_card_strike()}><Strikethrough size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="code" title={m.canvas_card_code()}><Code size={18} /></button>
					<button type="button" class="pce-icon" data-menu="hl" title={m.canvas_card_highlight()}><Highlighter size={18} /></button>
					<button type="button" class="pce-icon" data-menu="fg" title={m.canvas_props_text_colour()}><Baseline size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="link" title={m.canvas_card_link()}><Link size={18} /></button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-block-button="ul" title={m.canvas_card_ul()}><List size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="ol" title={m.canvas_card_ol()}><ListOrdered size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="check" title={m.canvas_card_check()}><ListChecks size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="quote" title={m.canvas_card_block_quote()}><TextQuote size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="codeblock" title={m.canvas_card_block_code()}><SquareCode size={18} /></button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-insert="table" title={m.canvas_card_table()}><Table size={18} /></button>
					<button type="button" class="pce-icon" data-insert="rule" title={m.canvas_card_rule()}><Minus size={18} /></button>
				</div>
			</div>
			<div class="pce-menu" data-for="block">
				<For each={BLOCK_MENU}>{([kind, name]) => <button type="button" class={`pce-opt pce-opt-${kind}`} data-block={kind}>{name()}</button>}</For>
			</div>
			<div class="pce-menu pce-fonts" data-for="font">
				<button type="button" class="pce-opt" data-font="default">Inter <small>{m.canvas_card_font_default()}</small></button>
				<For each={FONT_GROUPS}>
					{(group) => (
						<>
							<span class="pce-group">{fontGroupName(group.group)}</span>
							<For each={group.fonts.filter((font) => font !== "Inter")}>{(font) => <button type="button" class="pce-opt" data-font={font}>{font}</button>}</For>
						</>
					)}
				</For>
			</div>
			<div class="pce-menu" data-for="size">
				<For each={SIZE_MENU}>{([size, name]) => <button type="button" class={`pce-opt pce-size-${size}`} data-size={size}>{name()}</button>}</For>
			</div>
			<div class="pce-menu pce-swatches" data-for="hl">
				<For each={SIX}>{(c) => <button type="button" class="pce-sw" data-hl={c} title={m.canvas_card_highlight_colour({ colour: colourName(c) })} />}</For>
				<button type="button" class="pce-opt" data-hl="none">{m.canvas_card_no_highlight()}</button>
			</div>
			<div class="pce-menu pce-swatches" data-for="fg">
				<For each={SIX}>{(c) => <button type="button" class="pce-swatch-fg" data-fg={c} title={m.canvas_card_text_colour({ colour: colourName(c) })}>A</button>}</For>
				<button type="button" class="pce-opt" data-fg="none">{m.canvas_card_no_colour()}</button>
			</div>
		</div>
	);
}
