import { indexOf, isArrow, isShape } from "@decks/pen";
import type { LucideIcon } from "lucide-solid";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import FrameIcon from "lucide-solid/icons/frame";
import Layers from "lucide-solid/icons/layers";
import Shapes from "lucide-solid/icons/shapes";
import SmilePlus from "lucide-solid/icons/smile-plus";
import Spline from "lucide-solid/icons/spline";
import Square from "lucide-solid/icons/square";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import X from "lucide-solid/icons/x";
import { createMemo, Show } from "solid-js";
import { penTyping, propsOpen, setPenSelection, setPropsOpen } from "../edit/pen-tools.ts";
import { Icon } from "@decks/ui";
import { COARSE } from "../edit/core/touch-rules.ts";
import { held } from "./properties/fields.tsx";
import { Effects } from "./properties/effects.tsx";
import { type Kind, kindOf } from "./properties/values.ts";
import { Section } from "./properties/section.tsx";
import { createArrange } from "./properties/arrange.tsx";
import { createArrows } from "./properties/arrows.tsx";
import { createPosition } from "./properties/position.tsx";
import { createIconSection } from "./properties/icon.tsx";
import { createWords } from "./properties/words.tsx";
import { createLine } from "./properties/line.tsx";
import { createFill } from "./properties/fill.tsx";
import { createLayout } from "./properties/layout.tsx";
import { createCorners } from "./properties/corners.tsx";
import { createShapeSection } from "./properties/shape.tsx";
import { createWrites } from "./properties/writes.ts";
import { createTargets } from "./properties/targets.ts";
import { createPlacement } from "./properties/placement.ts";
import type { PropertiesProps } from "./properties/props.ts";

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

const KIND_ICON: Record<Kind, LucideIcon> = { shape: Shapes, arrow: ArrowUpRight, text: Type, note: StickyNote, icon: SmilePlus, frame: FrameIcon, rectangle: Square, ellipse: Square, polygon: Shapes, path: Spline, group: Layers, other: Square };

export function Properties(props: PropertiesProps) {
	const index = createMemo(() => (props.doc ? indexOf(props.doc) : new Map()));
	const { narrow, anchor } = createPlacement();
	const { selected, single, has, fillTargets, lineTargets, wordTargets, effectTargets, arrows, icons, shapes } = createTargets({ index });
	const { edit, set, show, writer, live, shownOf } = createWrites({ props });

	const { setShapeWords, wordsSection } = createWords({ props, selected, wordTargets, shapes, edit, set, writer, shownOf, live });
	const { shapeSection } = createShapeSection({ shapes, single, edit, setShapeWords });
	const { layoutSection } = createLayout({ selected, set });
	const { cornersSection } = createCorners({ selected, set });
	const { fillSection } = createFill({ fillTargets, has, set, writer, shownOf, live });
	const { lineSection } = createLine({ lineTargets, arrows, set, writer, shownOf, live });
	const { arrowSection } = createArrows({ arrows, index, set });
	const { iconSection } = createIconSection({ icons, set, writer, shownOf, live });
	const { placeSection } = createPosition({ single, edit, set });
	const { arrangeSection } = createArrange({ props, selected, single, edit });

	const title = () => {
		const node = single();
		if (!node) return `${selected().length} items`;
		if (typeof node.name === "string" && node.name) return node.name;
		if (isShape(node)) return String(node.metadata?.kind ?? "Shape");
		if (isArrow(node)) return "Arrow";
		if (kindOf(node) === "icon") return String(node.icon ?? "Icon");
		return node.type[0]!.toUpperCase() + node.type.slice(1);
	};

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
					{shapeSection()}
					{layoutSection()}
					{cornersSection()}
					{fillSection()}
					{lineSection()}
					{arrowSection()}
					{wordsSection()}
					{iconSection()}
					{placeSection()}

					<Show when={effectTargets().length > 0}>
						<Section key="effects" title="Shadow and blur">
							<Effects targets={effectTargets()} set={set} show={show} onLive={live} />
						</Section>
					</Show>

					{arrangeSection()}
				</div>
			</aside>
		</Show>
	);
}
