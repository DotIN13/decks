import { For } from "solid-js";
import { state } from "../state/deck.ts";

/**
 * The notice strip: what the app has to say, briefly, over the boards.
 *
 * Top-centre and pointer-transparent, because a notice is not a thing to click — the one
 * thing it must not do is take a gesture meant for the canvas underneath it. `top-[58px]`
 * clears the pill cluster; `pointer-coarse` clears the taller touch chrome.
 *
 * The whole lifetime of a notice is `state/notices.ts` — when it is raised, when it expires,
 * and when a `working` line is replaced by a result. This draws the list and knows nothing
 * else about it, which is why it takes no props at all.
 *
 * **The layout is utilities rather than a stylesheet rule**, because none of it is a decision
 * worth a name: it is a centred column of small cards over the canvas. The responsive rules
 * are variants here rather than media queries in `styles/`, because a utility outranks
 * anything in the components layer — a `@media` block there would lose to the class beside it
 * and silently do nothing. `pointer-coarse` drops the column below a title bar that grows to
 * 52px with a 44px palette in it, where 58px used to be clear; the narrow rule lets it span
 * the screen instead of centring inside it.
 */
export function NoticeStrip() {
	return (
		<div class="notices pointer-events-none absolute top-[58px] left-1/2 flex max-w-[560px] -translate-x-1/2 flex-col gap-1.5 pointer-coarse:top-[74px] max-[760px]:right-3 max-[760px]:left-3 max-[760px]:max-w-none max-[760px]:translate-x-0">
			<For each={state.notices}>
				{(item) => (
					<div
						class="notice rounded-[10px] border border-line bg-panel px-3 py-[7px] text-[12px] shadow-panel data-[level=error]:border-danger/50 data-[level=warn]:border-warn/50"
						data-level={item.level}
					>
						{item.text}
					</div>
				)}
			</For>
		</div>
	);
}
