import type { Accessor } from "solid-js";
import { m } from "@decks/i18n";
import { isShape, type PenNode } from "@decks/pen";
import { For, Show } from "solid-js";
import { penBoxes } from "../../edit/pen-tools.ts";
import { NumField } from "./fields.tsx";
import { numberOf, shared } from "./values.ts";
import { Section } from "./section.tsx";
import type { SetFields } from "./writes.ts";

/** What `createLayout` reads of the panel (`../Properties.tsx`). */
export interface LayoutNeeds {
	readonly selected: Accessor<PenNode[]>;
	readonly set: SetFields;
}

/** The Layout section: how a frame holds what is in it. */
export function createLayout(d: LayoutNeeds) {
	/**
	 * Frames of the selection that are frames in their own right, not a shape from the library.
	 *
	 * A frame is the one item that holds others, and the panel showed nothing about how it holds
	 * them: pen gives it a direction, a gap, padding, two alignments, clipping and a size that can
	 * hug its children, and every one of those was unreachable. A library shape is a frame too, and
	 * is left out — its layout is how its own words sit, which it has its own control for.
	 */
	const frames = () => d.selected().filter((node) => node.type === "frame" && !isShape(node));

	const frameFlow = () => shared(frames(), (node) => (node.layout === "vertical" ? "vertical" : node.layout === "horizontal" ? "horizontal" : "none"));

	const framePad = () => shared(frames(), (node) => numberOf(Array.isArray(node.padding) ? node.padding[0] : node.padding, 0));

	const frameGap = () => shared(frames(), (node) => numberOf(node.gap, 0));

	const frameAlong = () => shared(frames(), (node) => (node.justifyContent === "end" ? "end" : node.justifyContent === "center" ? "center" : node.justifyContent === "space_between" ? "space_between" : "start"));

	const frameAcross = () => shared(frames(), (node) => (node.alignItems === "end" ? "end" : node.alignItems === "center" ? "center" : "start"));

	const frameClips = () => shared(frames(), (node) => node.clip !== false);

	/** Whether a frame's size follows its children. pen's own word for it is `fit_content`. */
	const frameHugs = (field: "width" | "height") => shared(frames(), (node) => typeof node[field] === "string" && /^(fit|hug)/.test(String(node[field])));

	/*
	 * Turning hugging off needs a number, and the number is the size the frame is right now, which
	 * the panel already keeps for every selected item (`penBoxes`). Without that a frame would snap
	 * to pen's own fallback the moment it was pinned.
	 */
	const setHug = (field: "width" | "height", hug: boolean) =>
		d.set(frames(), (node) => {
			/*
			 * `fit_content(120)` is pen's own hug with a fallback, which the layout pass uses when the
			 * frame has no children: a floor, so a frame that follows its children does not collapse to
			 * nothing the moment it is emptied and leave nothing to drop into.
			 */
			if (hug) return { [field]: field === "height" ? "fit_content(120)" : "fit_content" };
			const box = penBoxes().get(node.id);
			const now = field === "width" ? box?.w : box?.h;
			return { [field]: Math.max(1, Math.round(now ?? 100)) };
		});

	/*
	 * How a frame holds what is in it. Every control here writes one of pen's own
	 * fields, which the layout pass already reads; none of them was reachable before.
	 *
	 * Direction first, because it decides what the rest mean: with no direction a
	 * child sits where it was put and only padding and clipping do anything, so the
	 * gap and the two alignments are shown only once there is a direction to have
	 * them along.
	 */
	const layoutSection = () => (
		<Show when={frames().length > 0}>
			<Section key="layout" title={m.canvas_props_layout()}>
				{/*
				 * Named in CSS, not in our own words: pen's layout pass is flexbox, and every field
				 * here has a CSS property that means exactly it. Someone who knows flexbox needs no
				 * translation, and `fit-content` and `overflow` are the words they would search for.
				 */}
				<span class="props-prop">flex-direction</span>
				<div class="seg-set" role="group" aria-label="flex-direction">
					<For each={[["none", "none"], ["vertical", "column"], ["horizontal", "row"]] as const}>
						{([value, label]) => (
							<button type="button" data-on={frameFlow() === value ? "true" : undefined} aria-pressed={frameFlow() === value} onClick={() => d.set(frames(), () => ({ layout: value }))}>
								{label}
							</button>
						)}
					</For>
				</div>
				<div class="props-row">
					<NumField label="padding" value={framePad()} min={0} onCommit={(v) => d.set(frames(), () => ({ padding: v <= 0 ? null : v }))} />
					<Show when={frameFlow() !== "none"}>
						<NumField label="gap" value={frameGap()} min={0} onCommit={(v) => d.set(frames(), () => ({ gap: v <= 0 ? null : v }))} />
					</Show>
				</div>
				<Show when={frameFlow() !== "none"}>
					<span class="props-prop">justify-content</span>
					{/* Four values do not fit one row at 276 px, so this set wraps; the other sets do not. */}
					<div class="seg-set wrap" role="group" aria-label="justify-content">
						<For each={[["start", "start"], ["center", "center"], ["end", "end"], ["space_between", "space-between"]] as const}>
							{([value, label]) => (
								<button type="button" data-on={frameAlong() === value ? "true" : undefined} aria-pressed={frameAlong() === value} onClick={() => d.set(frames(), () => ({ justifyContent: value }))}>
									{label}
								</button>
							)}
						</For>
					</div>
					<span class="props-prop">align-items</span>
					<div class="seg-set" role="group" aria-label="align-items">
						<For each={["start", "center", "end"] as const}>
							{(value) => (
								<button type="button" data-on={frameAcross() === value ? "true" : undefined} aria-pressed={frameAcross() === value} onClick={() => d.set(frames(), () => ({ alignItems: value }))}>
									{value}
								</button>
							)}
						</For>
					</div>
				</Show>
				{/*
				 * `fit-content` is what makes dropping something into a frame visible: a frame that
				 * follows its children grows round what you put in it, where a fixed one just
				 * swallows it. One row per side, because a column that fits its height and keeps its
				 * width is the common shape. The other value is a length, so the button says px.
				 */}
				<For each={["width", "height"] as const}>
					{(field) => (
						<>
							<span class="props-prop">{field}</span>
							<div class="seg-set" role="group" aria-label={field}>
								<button type="button" data-on={frameHugs(field) === true ? "true" : undefined} aria-pressed={frameHugs(field) === true} onClick={() => setHug(field, true)}>fit-content</button>
								<button type="button" data-on={frameHugs(field) === false ? "true" : undefined} aria-pressed={frameHugs(field) === false} onClick={() => setHug(field, false)}>px</button>
							</div>
						</>
					)}
				</For>
				<span class="props-prop">overflow</span>
				<div class="seg-set" role="group" aria-label="overflow">
					<button type="button" data-on={frameClips() === true ? "true" : undefined} aria-pressed={frameClips() === true} onClick={() => d.set(frames(), () => ({ clip: true }))}>hidden</button>
					<button type="button" data-on={frameClips() === false ? "true" : undefined} aria-pressed={frameClips() === false} onClick={() => d.set(frames(), () => ({ clip: false }))}>visible</button>
				</div>
			</Section>
		</Show>
	);

	return {
		layoutSection,
	};
}
