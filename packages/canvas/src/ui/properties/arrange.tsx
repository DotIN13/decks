import type { Accessor } from "solid-js";
import { m } from "@decks/i18n";
import { isArrow, isCard, isMarkdown, newId, ids as penIds, type PenNode } from "@decks/pen";
import AlignCenterHorizontal from "lucide-solid/icons/align-center-horizontal";
import AlignCenterVertical from "lucide-solid/icons/align-center-vertical";
import AlignEndHorizontal from "lucide-solid/icons/align-end-horizontal";
import AlignEndVertical from "lucide-solid/icons/align-end-vertical";
import AlignHorizontalSpaceAround from "lucide-solid/icons/align-horizontal-space-around";
import AlignStartHorizontal from "lucide-solid/icons/align-start-horizontal";
import AlignStartVertical from "lucide-solid/icons/align-start-vertical";
import AlignVerticalSpaceAround from "lucide-solid/icons/align-vertical-space-around";
import BringToFront from "lucide-solid/icons/bring-to-front";
import Copy from "lucide-solid/icons/copy";
import FileDown from "lucide-solid/icons/file-down";
import ImageDown from "lucide-solid/icons/image-down";
import SendToBack from "lucide-solid/icons/send-to-back";
import Trash2 from "lucide-solid/icons/trash-2";
import { obsidianNote } from "../../model/card-frame.ts";
import { Show } from "solid-js";
import { penBoxes, setPenSelection } from "../../edit/pen-tools.ts";
import { Icon } from "@decks/ui";
import { IconToggle } from "./fields.tsx";
import { Section } from "./section.tsx";
import type { PropertiesProps } from "./props.ts";

/** What `createArrange` reads of the panel (`../Properties.tsx`). */
export interface ArrangeNeeds {
	readonly edit: (ops: unknown[]) => void;
	readonly selected: Accessor<PenNode[]>;
	readonly props: PropertiesProps;
	readonly single: () => PenNode | undefined;
}

/** The Arrange section: order, duplicate, export and delete, and lining several items up or spacing them out. */
export function createArrange(d: ArrangeNeeds) {
	const order = (where: "front" | "back") => d.edit(d.selected().map((node) => ({ op: "move", id: node.id, index: where === "front" ? 1e9 : 0 })));

	const duplicate = () => {
		const taken = d.props.doc ? penIds(d.props.doc) : new Set<string>();
		const made: string[] = [];
		d.edit(
			d.selected().flatMap((node) => {
				const as = newId(taken);
				taken.add(as);
				made.push(as);
				const beside = typeof node.x === "number" && typeof node.y === "number" ? [{ op: "update", id: as, set: { x: node.x + 24, y: node.y + 24 } }] : [];
				return [{ op: "copy", id: node.id, as }, ...beside];
			}),
		);
		setPenSelection(made);
	};

	const remove = () => {
		d.edit(d.selected().map((node) => ({ op: "delete", id: node.id })));
		setPenSelection([]);
	};

	/** Line the picked items up on one edge or middle of the box round them all. */
	const align = (how: "l" | "c" | "r" | "t" | "m" | "b") => {
		const items = d.selected().filter((node) => !isArrow(node)).flatMap((node) => {
			const at = penBoxes().get(node.id);
			return at ? [{ node, at }] : [];
		});
		if (items.length < 2) return;
		const x1 = Math.min(...items.map(({ at }) => at.x));
		const x2 = Math.max(...items.map(({ at }) => at.x + at.w));
		const y1 = Math.min(...items.map(({ at }) => at.y));
		const y2 = Math.max(...items.map(({ at }) => at.y + at.h));
		d.edit(
			items.map(({ node, at }) => {
				const x = how === "l" ? x1 : how === "r" ? x2 - at.w : how === "c" ? Math.round((x1 + x2) / 2 - at.w / 2) : at.x;
				const y = how === "t" ? y1 : how === "b" ? y2 - at.h : how === "m" ? Math.round((y1 + y2) / 2 - at.h / 2) : at.y;
				return { op: "update", id: node.id, box: { x1: x, y1: y } };
			}),
		);
	};

	/** Equal gaps between the picked items, across or down, the first and last staying where they are. */
	const distribute = (across: boolean) => {
		const items = d.selected().filter((node) => !isArrow(node)).flatMap((node) => {
			const at = penBoxes().get(node.id);
			return at ? [{ node, at }] : [];
		});
		if (items.length < 3) return;
		items.sort((a, b) => (across ? a.at.x - b.at.x : a.at.y - b.at.y));
		const first = items[0]!.at;
		const last = items[items.length - 1]!.at;
		const span = across ? last.x + last.w - first.x : last.y + last.h - first.y;
		const used = items.reduce((sum, { at }) => sum + (across ? at.w : at.h), 0);
		const gap = (span - used) / (items.length - 1);
		let cursor = across ? first.x : first.y;
		d.edit(
			items.map(({ node, at }) => {
				const op = { op: "update", id: node.id, box: across ? { x1: Math.round(cursor), y1: at.y } : { x1: at.x, y1: Math.round(cursor) } };
				cursor += (across ? at.w : at.h) + gap;
				return op;
			}),
		);
	};

	/** A card downloaded as an Obsidian note (`card-frame.ts`, `obsidianNote`), named for the card. */
	const exportNote = (node: PenNode) => {
		const name = (String(node.name ?? "") || m.canvas_props_kind_card()).replace(/[\\/:*?"<>|]+/g, " ").trim() || m.canvas_props_kind_card();
		const url = URL.createObjectURL(new Blob([obsidianNote(node)], { type: "text/markdown;charset=utf-8" }));
		const link = Object.assign(document.createElement("a"), { href: url, download: `${name}.md` });
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	const arrangeSection = () => (
		<Section key="arrange" title={m.canvas_props_arrange()}>
			<Show when={d.selected().filter((node) => !isArrow(node)).length >= 2}>
				<div class="props-buttons wide" role="group" aria-label={m.canvas_props_align()}>
					<IconToggle title={m.canvas_props_align_left()} onClick={() => align("l")}><Icon of={AlignStartVertical} size={14} /></IconToggle>
					<IconToggle title={m.canvas_props_align_centre()} onClick={() => align("c")}><Icon of={AlignCenterVertical} size={14} /></IconToggle>
					<IconToggle title={m.canvas_props_align_right()} onClick={() => align("r")}><Icon of={AlignEndVertical} size={14} /></IconToggle>
					<IconToggle title={m.canvas_props_align_top()} onClick={() => align("t")}><Icon of={AlignStartHorizontal} size={14} /></IconToggle>
					<IconToggle title={m.canvas_props_align_middle()} onClick={() => align("m")}><Icon of={AlignCenterHorizontal} size={14} /></IconToggle>
					<IconToggle title={m.canvas_props_align_bottom()} onClick={() => align("b")}><Icon of={AlignEndHorizontal} size={14} /></IconToggle>
					<Show when={d.selected().filter((node) => !isArrow(node)).length >= 3}>
						<IconToggle title={m.canvas_props_distribute_x()} onClick={() => distribute(true)}><Icon of={AlignHorizontalSpaceAround} size={14} /></IconToggle>
						<IconToggle title={m.canvas_props_distribute_y()} onClick={() => distribute(false)}><Icon of={AlignVerticalSpaceAround} size={14} /></IconToggle>
					</Show>
				</div>
			</Show>
			<div class="props-buttons wide" role="group" aria-label={m.canvas_props_order_actions()}>
				<IconToggle title={m.canvas_props_to_front()} onClick={() => order("front")}><Icon of={BringToFront} size={14} /></IconToggle>
				<IconToggle title={m.canvas_props_to_back()} onClick={() => order("back")}><Icon of={SendToBack} size={14} /></IconToggle>
				<IconToggle title={m.canvas_props_duplicate()} onClick={duplicate}><Icon of={Copy} size={14} /></IconToggle>
				<IconToggle title={m.canvas_props_export_png()} onClick={() => d.props.onExport(d.selected().map((node) => node.id))}><Icon of={ImageDown} size={14} /></IconToggle>
				<Show when={d.single() && (isCard(d.single()!) || isMarkdown(d.single()!))}>
					<IconToggle title={m.canvas_props_export_obsidian()} onClick={() => exportNote(d.single()!)}><Icon of={FileDown} size={14} /></IconToggle>
				</Show>
				<IconToggle title={m.canvas_props_delete()} danger onClick={remove}><Icon of={Trash2} size={14} /></IconToggle>
			</div>
		</Section>
	);

	return {
		arrangeSection,
	};
}
