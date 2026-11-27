import type { JSX } from "solid-js";
import { CanvasSwitcher } from "../canvases/CanvasSwitcher.tsx";
import { scheme } from "../lib/theme.ts";
import { stages } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import { newCanvas, openCanvas, setStagesOpen } from "./person.ts";
import { canvasOnScreen } from "../tabs/tabs.ts";

/** What a canvas menu is opened from: the button its owner draws. */
export type CanvasMenuTrigger = (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;

/** The canvas switcher around a trigger: the panel head's title, a canvas's tab in the top bar and a touch bar's chip use it. A pick moves the camera of the chat on screen there, so the one washed is where that camera is. */
export const canvasMenu = (trigger: CanvasMenuTrigger, placement: "bottom-start" | "bottom-end" = "bottom-start") => (
	<CanvasSwitcher
		canvases={stages()}
		here={canvasOnScreen()?.name}
		scheme={scheme()}
		placement={placement}
		onPick={(name) => openCanvas(name)}
		onNew={() => newCanvas()}
		onAll={() => void setStagesOpen(true)}
		trigger={trigger}
	/>
);
