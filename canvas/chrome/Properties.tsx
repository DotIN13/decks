import Layers from "lucide-solid/icons/layers";
import X from "lucide-solid/icons/x";
import { Show } from "solid-js";
import { penTyping, propsOpen, setPenSelection, setPropsOpen } from "../editor/pen-tools.ts";
import { Icon } from "@decks/ui";
import { COARSE } from "../input/touch-rules.ts";
import { kindOf, KIND_ICON } from "./properties/model.ts";
import { createPanel, createPanelPlace, type PanelProps } from "./properties/state.ts";
import { held } from "./properties/fields.tsx";
import { ShapeSection, LayoutSection, CornersSection } from "./properties/shape.tsx";
import { FillSection, LineSection } from "./properties/paint.tsx";
import { ArrowSection } from "./properties/arrow.tsx";
import { WordsSection, IconSection } from "./properties/words.tsx";
import { PlaceSection, EffectsSection, ArrangeSection } from "./properties/place.tsx";

/**
 * The properties panel: everything about what is selected in the drawing, in the board inspector's
 * corner (top right).
 *
 * It shows only what the selection has: a shape its kind, fill, line and words; an arrow its route,
 * heads, sides and words; an icon its library, name and weight; words their font. Position, size,
 * turn and opacity, shadow and blur, and the arrange buttons are for everything. With several items
 * picked, a value they do not share reads Mixed, and setting it sets all of them.
 *
 * Every control sends the pen edit an agent would send (`decks.canvas.batch`), so what the panel does
 * is what the file says. It is 276 px wide and scrolls only down: every row is built from columns
 * that shrink and sets of buttons that wrap, so a long value wraps rather than pushing the panel
 * sideways.
 */
export function Properties(props: PanelProps) {
	const ctx = createPanel(props);
	const { selected, single, title, set } = ctx;
	const { narrow, anchor } = createPanelPlace();
	/* It stands aside while a card is typed into, whose toolbar is its panel then (`penTyping`). */
	return (
		<Show when={selected().length > 0 && !penTyping() && (!COARSE || propsOpen())}>
			<aside class="panel-float props-panel" aria-label="Properties" data-props data-sheet={COARSE && narrow() ? "true" : undefined} data-popover={COARSE && !narrow() && anchor() ? "true" : undefined} style={COARSE && !narrow() && anchor() ? { left: `${anchor()!.left}px`, top: `${anchor()!.top}px`, right: "auto" } : undefined}>
				<header class="props-head">
					<span class="props-kind" aria-hidden="true">
						<Icon of={single() ? KIND_ICON[kindOf(single()!)] : Layers} size={14} />
					</span>
					<Show when={single()} fallback={<span class="props-title">{title()}</span>}>
						{(node) => (
							<input
								class="props-title"
								aria-label="Name"
								ref={(el) => held(el, title)}
								onChange={(event) => {
									const name = event.currentTarget.value.trim();
									set([node()], () => ({ name: name || null }));
								}}
								on:keydown={(event: KeyboardEvent) => {
									event.stopPropagation();
									if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
								}}
							/>
						)}
					</Show>
					<button type="button" class="close" aria-label="Close" title={COARSE ? "Close" : "Let go of the selection"} onClick={() => (COARSE ? setPropsOpen(false) : setPenSelection([]))}>
						<Icon of={X} size={13} />
					</button>
				</header>
				<div class="props-body">
					<ShapeSection ctx={ctx} />
					<LayoutSection ctx={ctx} />
					<CornersSection ctx={ctx} />
					<FillSection ctx={ctx} />
					<LineSection ctx={ctx} />
					<ArrowSection ctx={ctx} />
					<WordsSection ctx={ctx} />
					<IconSection ctx={ctx} />
					<PlaceSection ctx={ctx} />
					<EffectsSection ctx={ctx} />
					<ArrangeSection ctx={ctx} />
				</div>
			</aside>
		</Show>
	);
}
