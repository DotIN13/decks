import Maximize from "lucide-solid/icons/maximize";
import Minus from "lucide-solid/icons/minus";
import Plus from "lucide-solid/icons/plus";
import { For, Show } from "solid-js";
import { Icon, Popover } from "@decks/ui";
import { formatNumber, m } from "@decks/i18n";

const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;
/** The wheel's own factor, so a press and a roll land on the same stops. */
const STEP = 1.25;
const STOPS = [25, 50, 100, 200];

/**
 * The zoom, at the bottom right: out, the reading (a menu of stops), in, and fit everything on the
 * canvas.
 */
export function ZoomBar(props: { zoom: number; onZoom: (zoom: number) => void; onFit: () => void; compact?: boolean }) {
	const percent = () => Math.round(props.zoom * 100);
	const shown = (value: number) => formatNumber(value / 100, { style: "percent" });
	const clamp = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
	return (
		<div class="v3-bar v3-zoom float pill">
			<Show when={!props.compact}>
				<button type="button" class="v3-icon v3-zoom-btn" data-tip={m.frame_zoom_out()} data-key="⌘−" data-side="top" aria-label={m.frame_zoom_out()} onClick={() => props.onZoom(clamp(props.zoom / STEP))}>
					<Icon of={Minus} size={15} />
				</button>
			</Show>
			<Popover
				placement="top-end"
				label={m.frame_zoom()}
				class="w-[160px]"
				trigger={(api) => (
					<button type="button" class="v3-zoom-value" ref={api.ref} aria-haspopup="menu" aria-expanded={api.open} data-tip={m.frame_zoom()} data-side="top" aria-label={m.frame_zoom_at({ percent: shown(percent()) })} onClick={api.toggle}>
						{shown(percent())}
					</button>
				)}
			>
				<For each={STOPS}>
					{(stop) => (
						<button type="button" role="menuitem" data-row data-flat="true" data-current={percent() === stop ? "true" : undefined} onClick={() => props.onZoom(stop / 100)}>
							<span class="row-label flex-1 tabular-nums">{shown(stop)}</span>
						</button>
					)}
				</For>
			</Popover>
			<Show when={!props.compact}>
				<button type="button" class="v3-icon v3-zoom-btn" data-tip={m.frame_zoom_in()} data-key="⌘=" data-side="top" aria-label={m.frame_zoom_in()} onClick={() => props.onZoom(clamp(props.zoom * STEP))}>
					<Icon of={Plus} size={15} />
				</button>
			</Show>
			<button type="button" class="v3-icon v3-zoom-btn" data-tip={m.frame_fit()} data-key="0" data-side="top" aria-label={m.frame_fit_label()} onClick={() => props.onFit()}>
				<Icon of={Maximize} size={15} />
			</button>
		</div>
	);
}
