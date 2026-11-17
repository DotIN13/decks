import type { JSX } from "solid-js";
import { CanvasSwitcher } from "../canvases/CanvasSwitcher.tsx";
import { scheme } from "../lib/theme.ts";
import { stages } from "../state/canvases.ts";
import { placeLink } from "./link.ts";
import { OpenMore } from "./OpenMore.tsx";
import { canvasOnScreen } from "./tabs.ts";

/*
 * The finder is opened from where the canvas's tools are: the tool column's card menu (Link to…),
 * beside the button it is given.
 */
let open: ((beside: HTMLElement) => void) | undefined;
/** Open the finder that puts a link on the canvas, beside an element. A moment later, so the menu it is picked from has shut. */
export const openLinkFinder = (beside: HTMLElement): void => void setTimeout(() => open?.(beside), 0);

/**
 * The finder that puts a link on the canvas: the list the row of tabs' + has, the canvases and what
 * the other kinds offer, found by typing, where a pick places a chip that points at it (`link.ts`)
 * instead of opening it.
 */
export function LinkFinder(): JSX.Element {
	return (
		<CanvasSwitcher
			stages={stages()}
			here={canvasOnScreen()?.name}
			scheme={scheme()}
			placement="right-start"
			label="Link to"
			plain
			findLabel="Link to a canvas, an app, a card or a document"
			onPick={(name) => void placeLink({ kind: "canvas", target: name })}
			onNew={() => {}}
			onAll={() => {}}
			more={(find, pick) => <OpenMore find={find()} pick={pick} onPick={(kind, target) => void placeLink({ kind, target })} />}
			trigger={(popover) => {
				open = (beside) => {
					popover.ref(beside);
					if (!popover.open) popover.toggle();
				};
				return <></>;
			}}
		/>
	);
}
