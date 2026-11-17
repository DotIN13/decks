import { For } from "solid-js";
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
export function CardBarView(p: { bar: (el: HTMLDivElement) => void; tools: (el: HTMLDivElement) => void; onStyle: (event: MouseEvent) => void; onScroll: () => void }) {
	return (
		<div ref={p.bar} class="pce-bar" data-off onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={p.onStyle}>
			<div ref={p.tools} class="pce-tools" onScroll={p.onScroll}>
				{/* Two rows: what the words are set in, and what is done to them. */}
				<div class="pce-row">
					<button type="button" class="pce-pick pce-pick-block" data-menu="block" title="What the block is">
						<span data-label="block">Body text</span>
						<ChevronDown size={16} />
					</button>
					<button type="button" class="pce-pick pce-pick-font" data-menu="font" title="Font">
						<span data-label="font">Inter</span>
						<ChevronDown size={16} />
					</button>
					<button type="button" class="pce-pick pce-pick-size" data-menu="size" title="Size">
						<span data-label="size">Normal</span>
						<ChevronDown size={16} />
					</button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-cmd="undo" title="Undo (⌘Z)"><Undo2 size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="redo" title="Redo (⌘⇧Z)"><Redo2 size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="clear" title="Clear styling"><RemoveFormatting size={18} /></button>
				</div>
				<div class="pce-row">
					<button type="button" class="pce-icon" data-cmd="bold" title="Bold (⌘B)"><Bold size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="italic" title="Italic (⌘I)"><Italic size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="underline" title="Underline (⌘U)"><Underline size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="strikeThrough" title="Strike (⌘⇧X)"><Strikethrough size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="code" title="Code (⌘E)"><Code size={18} /></button>
					<button type="button" class="pce-icon" data-menu="hl" title="Highlight"><Highlighter size={18} /></button>
					<button type="button" class="pce-icon" data-menu="fg" title="Text colour"><Baseline size={18} /></button>
					<button type="button" class="pce-icon" data-cmd="link" title="Link"><Link size={18} /></button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-block-button="ul" title="Bulleted list"><List size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="ol" title="Numbered list"><ListOrdered size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="check" title="Checklist"><ListChecks size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="quote" title="Quote"><TextQuote size={18} /></button>
					<button type="button" class="pce-icon" data-block-button="codeblock" title="Code block"><SquareCode size={18} /></button>
					<span class="pce-sep" />
					<button type="button" class="pce-icon" data-insert="table" title="Table"><Table size={18} /></button>
					<button type="button" class="pce-icon" data-insert="rule" title="Rule"><Minus size={18} /></button>
				</div>
			</div>
			<div class="pce-menu" data-for="block">
				<For each={BLOCK_MENU}>{([kind, name]) => <button type="button" class={`pce-opt pce-opt-${kind}`} data-block={kind}>{name}</button>}</For>
			</div>
			<div class="pce-menu pce-fonts" data-for="font">
				<button type="button" class="pce-opt" data-font="default">Inter <small>the card's own</small></button>
				<For each={FONT_GROUPS}>
					{(group) => (
						<>
							<span class="pce-group">{group.group}</span>
							<For each={group.fonts.filter((font) => font !== "Inter")}>{(font) => <button type="button" class="pce-opt" data-font={font}>{font}</button>}</For>
						</>
					)}
				</For>
			</div>
			<div class="pce-menu" data-for="size">
				<For each={SIZE_MENU}>{([size, name]) => <button type="button" class={`pce-opt pce-size-${size}`} data-size={size}>{name}</button>}</For>
			</div>
			<div class="pce-menu pce-swatches" data-for="hl">
				<For each={SIX}>{(c) => <button type="button" class="pce-sw" data-hl={c} title={`${c} highlight`} />}</For>
				<button type="button" class="pce-opt" data-hl="none">No highlight</button>
			</div>
			<div class="pce-menu pce-swatches" data-for="fg">
				<For each={SIX}>{(c) => <button type="button" class="pce-swatch-fg" data-fg={c} title={`${c} text`}>A</button>}</For>
				<button type="button" class="pce-opt" data-fg="none">No colour</button>
			</div>
		</div>
	);
}
