// The panel's sections for an item's form: a library shape's kind and words, a frame's layout, corners.
import { isShape, SHAPES, shapeKind, shapeLabel, shapeOutline } from "@decks/pen";
import { For, Show } from "solid-js";
import { MIXED, numberOf, shared } from "./model.ts";
import { NumField, held, Section } from "./fields.tsx";
import type { PanelCtx } from "./state.ts";

/** A library shape: its kind, and its words. */
export function ShapeSection(own: { ctx: PanelCtx }) {
	const { single, shapes, edit, setShapeWords } = own.ctx;
	return (
		<Show when={shapes().length > 0}>
			<Section key="shape" title="Shape">
				<div class="props-row">
					<span class="props-label">Kind</span>
					<select
						class="props-select"
						aria-label="Kind of shape"
						value={String(shared(shapes(), (node) => String(node.metadata?.kind ?? "")) ?? "")}
						onChange={(event) => {
							const kind = shapeKind(event.currentTarget.value);
							if (!kind) return;
							edit(
								shapes().flatMap((node) => {
									const outline = shapeOutline(node);
									const renamed = !node.name || node.name === node.metadata?.kind;
									return [
										{ op: "update", id: node.id, set: { metadata: { ...(node.metadata ?? {}), kind: kind.name }, ...(renamed ? { name: kind.name } : {}) } },
										...(outline ? [{ op: "update", id: outline.id, set: { geometry: kind.geometry, fillRule: kind.fillRule ?? null, ...(kind.line ? { fill: null } : outline.fill === undefined ? { fill: "$decks-surface" } : {}) } }] : []),
									];
								}),
							);
						}}
					>
						<Show when={shared(shapes(), (node) => node.metadata?.kind) === MIXED}>
							<option value={MIXED}>Mixed</option>
						</Show>
						<For each={SHAPES}>{(kind) => <option value={kind.name}>{kind.name}</option>}</For>
					</select>
				</div>
				<Show when={single() && isShape(single())}>
					<div class="props-row">
						<span class="props-label">Words</span>
						<input
							class="field props-text"
							placeholder="Double-click the shape, or type here"
							ref={(el) => held(el, () => String(shapeLabel(single()!)?.content ?? ""))}
							onChange={(event) => setShapeWords(single()!, event.currentTarget.value)}
						/>
					</div>
				</Show>
			</Section>
		</Show>
	);
}

/**
 * How a frame holds what is in it. Every control writes one of pen's own fields, which the layout pass
 * already reads. Direction first, because it decides what the rest mean: with no direction a child sits
 * where it was put, so the gap and the two alignments show only once there is a direction to have them along.
 */
export function LayoutSection(own: { ctx: PanelCtx }) {
	const { frames, set, frameFlow, framePad, frameGap, frameClips, frameHugs, setHug } = own.ctx;
	return (
		<Show when={frames().length > 0}>
			<Section key="layout" title="Layout">
				{/*
				 * Named in CSS, not in our own words: pen's layout pass is flexbox, and every field
				 * here has a CSS property that means exactly it. Someone who knows flexbox needs no
				 * translation, and `fit-content` and `overflow` are the words they would search for.
				 */}
				<span class="props-prop">flex-direction</span>
				<div class="seg-set" role="group" aria-label="flex-direction">
					<For each={[["none", "none"], ["vertical", "column"], ["horizontal", "row"]] as const}>
						{([value, label]) => (
							<button type="button" data-on={frameFlow() === value ? "true" : undefined} aria-pressed={frameFlow() === value} onClick={() => set(frames(), () => ({ layout: value }))}>
								{label}
							</button>
						)}
					</For>
				</div>
				<div class="props-row">
					<NumField label="padding" value={framePad()} min={0} onCommit={(v) => set(frames(), () => ({ padding: v <= 0 ? null : v }))} />
					<Show when={frameFlow() !== "none"}>
						<NumField label="gap" value={frameGap()} min={0} onCommit={(v) => set(frames(), () => ({ gap: v <= 0 ? null : v }))} />
					</Show>
				</div>
				<LayoutAlong ctx={own.ctx} />
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
					<button type="button" data-on={frameClips() === true ? "true" : undefined} aria-pressed={frameClips() === true} onClick={() => set(frames(), () => ({ clip: true }))}>hidden</button>
					<button type="button" data-on={frameClips() === false ? "true" : undefined} aria-pressed={frameClips() === false} onClick={() => set(frames(), () => ({ clip: false }))}>visible</button>
				</div>
			</Section>
		</Show>
	);
}

/** The gap's two alignments, once the frame has a direction. */
export function LayoutAlong(own: { ctx: PanelCtx }) {
	const { frames, set, frameFlow, frameAlong, frameAcross } = own.ctx;
	return (
		<Show when={frameFlow() !== "none"}>
			<span class="props-prop">justify-content</span>
			{/* Four values do not fit one row at 276 px, so this set wraps; the other sets do not. */}
			<div class="seg-set wrap" role="group" aria-label="justify-content">
				<For each={[["start", "start"], ["center", "center"], ["end", "end"], ["space_between", "space-between"]] as const}>
					{([value, label]) => (
						<button type="button" data-on={frameAlong() === value ? "true" : undefined} aria-pressed={frameAlong() === value} onClick={() => set(frames(), () => ({ justifyContent: value }))}>
							{label}
						</button>
					)}
				</For>
			</div>
			<span class="props-prop">align-items</span>
			<div class="seg-set" role="group" aria-label="align-items">
				<For each={["start", "center", "end"] as const}>
					{(value) => (
						<button type="button" data-on={frameAcross() === value ? "true" : undefined} aria-pressed={frameAcross() === value} onClick={() => set(frames(), () => ({ alignItems: value }))}>
							{value}
						</button>
					)}
				</For>
			</div>
		</Show>
	);
}

/** Corners, and a polygon's sides. */
export function CornersSection(own: { ctx: PanelCtx }) {
	const { selected, set } = own.ctx;
	return (
		<Show when={selected().some((node) => (node.type === "rectangle" || node.type === "frame" || node.type === "polygon") && !isShape(node))}>
			<Section key="corners" title={selected().some((node) => node.type === "polygon") ? "Sides and corners" : "Corners"}>
				<div class="props-row">
					<Show when={selected().some((node) => node.type === "polygon")}>
						<NumField label="sides" value={shared(selected().filter((node) => node.type === "polygon"), (node) => numberOf(node.polygonCount, 3))} min={3} onCommit={(v) => set(selected().filter((node) => node.type === "polygon"), () => ({ polygonCount: Math.max(3, Math.round(v)) }))} />
					</Show>
					<NumField
						label="radius"
						value={shared(selected().filter((node) => ["rectangle", "frame", "polygon"].includes(node.type) && !isShape(node)), (node) => numberOf(node.cornerRadius, 0))}
						min={0}
						onCommit={(v) => set(selected().filter((node) => ["rectangle", "frame", "polygon"].includes(node.type) && !isShape(node)), () => ({ cornerRadius: v <= 0 ? null : v }))}
					/>
				</div>
			</Section>
		</Show>
	);
}
