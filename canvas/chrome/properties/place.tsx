// The panel's sections for every item: position and size, the shadow and blur section (its control,
// Effects, is in fields.tsx), and arranging, with a card's export as an Obsidian note.
import { isArrow, isCard, isMarkdown, type PenNode } from "@decks/pen";
import { obsidianNote } from "../../cards/card-frame.ts";
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
import FlipHorizontal2 from "lucide-solid/icons/flip-horizontal-2";
import FlipVertical2 from "lucide-solid/icons/flip-vertical-2";
import ImageDown from "lucide-solid/icons/image-down";
import Lock from "lucide-solid/icons/lock";
import LockOpen from "lucide-solid/icons/lock-open";
import SendToBack from "lucide-solid/icons/send-to-back";
import Trash2 from "lucide-solid/icons/trash-2";
import { Show } from "solid-js";
import { Icon } from "@decks/ui";
import { numberOf } from "./model.ts";
import { Effects, NumField, IconToggle, Section } from "./fields.tsx";
import type { PanelCtx } from "./state.ts";

/** Position, size, turn, opacity and flips of the one item selected. */
export function PlaceSection(own: { ctx: PanelCtx }) {
	const { single, set, keepRatio, setKeepRatio, box, setBox } = own.ctx;
	return (
		<Show when={single() && !isArrow(single()!) && box()}>
			<Section key="place" title="Position and size">
				{/*
				 * A markdown card starts as tall as its words and stays that way until a top or
				 * bottom handle pins a height on it. This is the way back: the same two words the
				 * frame's own height uses, so one control means one thing across the panel.
				 */}
				<Show when={isMarkdown(single()!) || isCard(single()!)}>
					<span class="props-prop">height</span>
					<div class="seg-set" role="group" aria-label="height">
						<button type="button" data-on={typeof single()!.height !== "number" ? "true" : undefined} aria-pressed={typeof single()!.height !== "number"} onClick={() => set([single()!], () => ({ height: null }))}>fit-content</button>
						<button type="button" data-on={typeof single()!.height === "number" ? "true" : undefined} aria-pressed={typeof single()!.height === "number"} onClick={() => set([single()!], () => ({ height: Math.max(1, Math.round(box()!.h)) }))}>px</button>
					</div>
				</Show>
				<div class="props-nums">
					<NumField field="x" label="x" value={box()!.x} onCommit={(v) => setBox({ x: Math.round(v) })} />
					<NumField field="y" label="y" value={box()!.y} onCommit={(v) => setBox({ y: Math.round(v) })} />
					<NumField field="w" label="w" value={box()!.w} min={1} onCommit={(v) => setBox({ w: Math.round(v) })} />
					<NumField field="h" label="h" value={box()!.h} min={1} onCommit={(v) => setBox({ h: Math.round(v) })} />
				</div>
				<div class="props-row">
					<NumField label="°" value={numberOf(single()!.rotation, 0)} onCommit={(v) => set([single()!], () => ({ rotation: Math.round(v) % 360 === 0 ? null : Math.round(v) % 360 }))} title="Turn, in degrees" />
					<NumField label="%" value={Math.round(numberOf(single()!.opacity, 1) * 100)} min={0} max={100} onCommit={(v) => set([single()!], () => ({ opacity: v >= 100 ? null : Math.max(0, v) / 100 }))} title="Opacity" />
					<div class="props-buttons">
						<IconToggle on={keepRatio()} title={keepRatio() ? "Keeping the proportions" : "Keep the proportions"} onClick={() => setKeepRatio(!keepRatio())}>
							<Icon of={keepRatio() ? Lock : LockOpen} size={14} />
						</IconToggle>
						<IconToggle on={single()!.flipX === true} title="Flip across" onClick={() => set([single()!], (node) => ({ flipX: node.flipX === true ? null : true }))}>
							<Icon of={FlipHorizontal2} size={14} />
						</IconToggle>
						<IconToggle on={single()!.flipY === true} title="Flip up and down" onClick={() => set([single()!], (node) => ({ flipY: node.flipY === true ? null : true }))}>
							<Icon of={FlipVertical2} size={14} />
						</IconToggle>
					</div>
				</div>
			</Section>
		</Show>
	);
}

/** Shadow and blur. */
export function EffectsSection(own: { ctx: PanelCtx }) {
	const { effectTargets, set, show, live } = own.ctx;
	return (
		<Show when={effectTargets().length > 0}>
			<Section key="effects" title="Shadow and blur">
				<Effects targets={effectTargets()} set={set} show={show} onLive={live} />
			</Section>
		</Show>
	);
}

/** Align, distribute, order, duplicate, export and delete. */
export function ArrangeSection(own: { ctx: PanelCtx }) {
	const { props, selected, single, order, duplicate, remove, align, distribute } = own.ctx;
	return (
		<Section key="arrange" title="Arrange">
			<Show when={selected().filter((node) => !isArrow(node)).length >= 2}>
				<div class="props-buttons wide" role="group" aria-label="Align">
					<IconToggle title="Align left edges" onClick={() => align("l")}><Icon of={AlignStartVertical} size={14} /></IconToggle>
					<IconToggle title="Align centres" onClick={() => align("c")}><Icon of={AlignCenterVertical} size={14} /></IconToggle>
					<IconToggle title="Align right edges" onClick={() => align("r")}><Icon of={AlignEndVertical} size={14} /></IconToggle>
					<IconToggle title="Align tops" onClick={() => align("t")}><Icon of={AlignStartHorizontal} size={14} /></IconToggle>
					<IconToggle title="Align middles" onClick={() => align("m")}><Icon of={AlignCenterHorizontal} size={14} /></IconToggle>
					<IconToggle title="Align bottoms" onClick={() => align("b")}><Icon of={AlignEndHorizontal} size={14} /></IconToggle>
					<Show when={selected().filter((node) => !isArrow(node)).length >= 3}>
						<IconToggle title="Equal gaps across" onClick={() => distribute(true)}><Icon of={AlignHorizontalSpaceAround} size={14} /></IconToggle>
						<IconToggle title="Equal gaps down" onClick={() => distribute(false)}><Icon of={AlignVerticalSpaceAround} size={14} /></IconToggle>
					</Show>
				</div>
			</Show>
			<div class="props-buttons wide" role="group" aria-label="Order and actions">
				<IconToggle title="Bring to the front" onClick={() => order("front")}><Icon of={BringToFront} size={14} /></IconToggle>
				<IconToggle title="Send to the back" onClick={() => order("back")}><Icon of={SendToBack} size={14} /></IconToggle>
				<IconToggle title="Duplicate (⌘D)" onClick={duplicate}><Icon of={Copy} size={14} /></IconToggle>
				<IconToggle title="Export as a picture (PNG)" onClick={() => props.onExport(selected().map((node) => node.id))}><Icon of={ImageDown} size={14} /></IconToggle>
				<Show when={single() && (isCard(single()!) || isMarkdown(single()!))}>
					<IconToggle title="Export to Obsidian (.md)" onClick={() => exportNote(single()!)}><Icon of={FileDown} size={14} /></IconToggle>
				</Show>
				<IconToggle title="Delete (Delete)" danger onClick={remove}><Icon of={Trash2} size={14} /></IconToggle>
			</div>
		</Section>
	);
}

/** A card downloaded as an Obsidian note (`card-frame.ts`, `obsidianNote`), named for the card. */
export function exportNote(node: PenNode): void {
	const name = (String(node.name ?? "") || "Card").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Card";
	const url = URL.createObjectURL(new Blob([obsidianNote(node)], { type: "text/markdown;charset=utf-8" }));
	const link = Object.assign(document.createElement("a"), { href: url, download: `${name}.md` });
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
