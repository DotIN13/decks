import type { JSX } from "solid-js";
import { CanvasSwitcher } from "../canvases/CanvasSwitcher.tsx";
import { scheme } from "../lib/theme.ts";
import { stageOf, stages } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import { newCanvas, openCanvas, setStagesOpen } from "./person.ts";

/** What a canvas menu is opened from: the button its owner draws. */
export type CanvasMenuTrigger = (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;

/** The canvas switcher around a trigger: the panel head's title and the top bar's canvas chip both use it. */
export const canvasMenu = (trigger: CanvasMenuTrigger, placement: "bottom-start" | "bottom-end" = "bottom-start") => (
	<CanvasSwitcher
		stages={stages()}
		here={stageOf(state.focused)?.name}
		scheme={scheme()}
		placement={placement}
		onPick={(name) => openCanvas(name)}
		onNew={() => newCanvas()}
		onAll={() => void setStagesOpen(true)}
		trigger={trigger}
	/>
);
