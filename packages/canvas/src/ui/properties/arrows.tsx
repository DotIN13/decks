import type { Accessor } from "solid-js";
import { arrowBend, arrowEndAt, arrowEndItem, arrowEndSide, arrowLabel, arrowStyle, isPointEnd, shapeLabel, type ArrowSide, type PenNode } from "@decks/pen";
import ArrowLeftRight from "lucide-solid/icons/arrow-left-right";
import ArrowRight from "lucide-solid/icons/arrow-right";
import CornerDownRight from "lucide-solid/icons/corner-down-right";
import Minus from "lucide-solid/icons/minus";
import MoveRight from "lucide-solid/icons/move-right";
import Spline from "lucide-solid/icons/spline";
import { For, Show } from "solid-js";
import { Icon } from "@decks/ui";
import { IconToggle, held } from "./fields.tsx";
import { shared } from "./values.ts";
import { Section } from "./section.tsx";
import type { SetFields } from "./writes.ts";

/** What `createArrows` reads of the panel (`../Properties.tsx`). */
export interface ArrowsNeeds {
	readonly set: SetFields;
	readonly arrows: Accessor<PenNode[]>;
	readonly index: Accessor<Map<any, any>>;
}

/** The Arrow section: an arrow's route, its heads, and the side of an item each end joins. */
export function createArrows(d: ArrowsNeeds) {
	const arrowSet = (patch: Record<string, unknown>) => d.set(d.arrows(), (node) => ({ metadata: { ...(node.metadata ?? {}), ...patch } }));

	const style = () => arrowStyle(d.arrows()[0]?.metadata);

	const endName = (end: unknown): string => {
		if (isPointEnd(end)) return "a point";
		const item = arrowEndItem(end);
		if (!item) return "nothing";
		const node = d.index().get(item)?.node as PenNode | undefined;
		return node ? (typeof node.name === "string" && node.name ? node.name : (shapeLabel(node)?.content as string | undefined) ?? node.type) : item.replace(/^.*\//, "");
	};

	const setSide = (which: "from" | "to", side: ArrowSide | "auto") => {
		const node = d.arrows()[0];
		const end = node?.metadata?.[which];
		const item = arrowEndItem(end);
		if (!node || !item) return;
		arrowSet({ [which]: side === "auto" ? item : { item, side } });
	};

	/** A join slid along its side (`at`) put back in the side's middle. */
	const joinToMiddle = (which: "from" | "to") => {
		const end = d.arrows()[0]?.metadata?.[which];
		const item = arrowEndItem(end);
		const side = arrowEndSide(end);
		if (item && side) arrowSet({ [which]: { item, side } });
	};

	const arrowSection = () => (
		<Show when={d.arrows().length > 0}>
			<Section key="arrow" title="Arrow">
				<div class="seg-set" role="group" aria-label="Route">
					<For each={[["straight", "Straight", MoveRight], ["curved", "Curved", Spline], ["elbow", "Elbow", CornerDownRight]] as const}>
						{([route, label]) => (
							<button type="button" data-route={route} data-on={style().route === route ? "true" : undefined} aria-pressed={style().route === route} onClick={() => arrowSet({ route: route === "straight" ? undefined : route })}>
								{label}
							</button>
						)}
					</For>
				</div>
				<div class="props-row">
					<span class="props-label">Heads</span>
					<div class="props-buttons" role="group" aria-label="Heads">
						<IconToggle attr={{ "data-heads": "end" }} on={style().heads === "end"} title="A head at the end" onClick={() => arrowSet({ heads: undefined })}>
							<Icon of={ArrowRight} size={14} />
						</IconToggle>
						<IconToggle attr={{ "data-heads": "both" }} on={style().heads === "both"} title="A head at both ends" onClick={() => arrowSet({ heads: "both" })}>
							<Icon of={ArrowLeftRight} size={14} />
						</IconToggle>
						<IconToggle attr={{ "data-heads": "none" }} on={style().heads === "none"} title="No head" onClick={() => arrowSet({ heads: "none" })}>
							<Icon of={Minus} size={14} />
						</IconToggle>
					</div>
				</div>
				<div class="props-row">
					<span class="props-label">Words</span>
					<input
						class="field props-text"
						placeholder="On the middle of the line"
						ref={(el) => held(el, () => String(shared(d.arrows(), (node) => arrowLabel(node.metadata) ?? "") ?? ""))}
						onChange={(event) => arrowSet({ label: event.currentTarget.value.trim() || undefined })}
					/>
				</div>
				<Show when={d.arrows().some((node) => arrowBend(node.metadata) !== undefined)}>
					<div class="props-row">
						<span class="props-label">Bend</span>
						<span class="props-endname">Custom</span>
						<button type="button" class="props-reset" title="Back to the automatic route" onClick={() => arrowSet({ bend: undefined })}>
							Automatic
						</button>
					</div>
				</Show>
				<Show when={d.arrows().length === 1}>
					<For each={["from", "to"] as const}>
						{(which) => {
							const end = () => d.arrows()[0]?.metadata?.[which];
							return (
								<div class="props-row props-end">
									<span class="props-label">{which === "from" ? "From" : "To"}</span>
									<span class="props-endname" title={endName(end())}>{endName(end())}</span>
									<Show when={arrowEndItem(end())}>
										<select class="props-select props-side" aria-label={`${which === "from" ? "Start" : "End"} side`} value={arrowEndSide(end()) ?? "auto"} onChange={(event) => setSide(which, event.currentTarget.value as ArrowSide | "auto")}>
											<option value="auto">Nearest side</option>
											<option value="top">Top</option>
											<option value="right">Right</option>
											<option value="bottom">Bottom</option>
											<option value="left">Left</option>
										</select>
									</Show>
									{/* A join slid off the middle of its side, and the way back to it. */}
									<Show when={arrowEndAt(end()) !== undefined}>
										<button type="button" class="props-reset" title="Join at the middle of the side" onClick={() => joinToMiddle(which)}>
											Middle
										</button>
									</Show>
								</div>
							);
						}}
					</For>
				</Show>
			</Section>
		</Show>
	);

	return {
		arrowSection,
	};
}
