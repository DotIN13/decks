import type { Accessor } from "solid-js";
import type { Camera } from "@decks/protocol";
import { createEffect, on, onCleanup } from "solid-js";
import type { EditorState } from "../../view/types.ts";
import { fitClear, insets } from "../../camera/insets.ts";
import { type PageEnd } from "../protocol.ts";
import { type FramedEditorOptions } from "./host.tsx";

/** What `createSync` reads of `createFramedEditor` (`host.tsx`), each read when it is used. */
export interface SyncNeeds {
	readonly state: EditorState | undefined;
	readonly end: Accessor<PageEnd | undefined>;
	readonly options: FramedEditorOptions;
	localCamera: Camera;
	readonly fromFrame: { camera?: Camera; selected?: string; mode?: "edit" | "browse"; };
	modeNow: "edit" | "browse";
	readonly frameAt: Accessor<HTMLIFrameElement | undefined>;
}

export function createSync(d: SyncNeeds) {
	/*
	 * The host's state, kept in step: the cards and boards, the camera an agent or the app moved, the
	 * selected board, the mode, the scheme, ink, and what is going on around the canvas.
	 */
	const keepInStep = () => {
		createEffect(
			on(
				() => d.state?.pen?.(),
				(pen) => {
					// The drawing is the frame's own to read (`backend.ts`); this page's copy is only for its panels.
					if (!pen) return;
					const page = d.end();
					if (page && pen.writer) page.emit("busy", { writer: pen.writer });
				},
				{ defer: true },
			),
		);
		// The conversation on screen: an agent's view calls move this canvas only for it.
		createEffect(() => {
			const page = d.end();
			const agent = d.options.frame.focused?.();
			if (page && agent) page.emit("look", { agent });
		});
		// What of the frame the page's own chrome covers, so the frame's tools sit clear of it and a fit frames into the rest.
		createEffect(() => {
			const page = d.end();
			const covered = insets();
			const clear = fitClear();
			if (page) page.emit("look", { insets: covered, fitClear: clear });
		});
		createEffect(
			on(
				() => [d.state?.camera?.[0](), d.state?.glide?.()] as const,
				([camera, glide]) => {
					if (!camera) return;
					// Kept with no frame yet too: a frame starting for another canvas opens on the camera it landed on.
					d.localCamera = camera;
					const page = d.end();
					if (!page || camera === d.fromFrame.camera) return;
					page.emit("camera", { camera, ...(glide ? { glide: glide.ms } : {}) });
				},
			),
		);
		createEffect(() => {
			const page = d.end();
			const selected = d.state?.selected?.[0]();
			if (!page || selected === d.fromFrame.selected) return;
			page.emit("select", { ids: [], ...(selected ? { page: selected } : {}) });
		});
		createEffect(() => {
			const page = d.end();
			const mode = d.state?.mode?.[0]();
			if (!page || !mode || mode === d.modeNow) return;
			d.modeNow = mode;
			page.emit("look", { mode });
		});
		createEffect(() => {
			const page = d.end();
			const inking = d.state?.inking?.();
			if (page && inking !== undefined) page.emit("tool", { ink: { on: inking } });
		});
		createEffect(() => {
			const page = d.end();
			const dock = d.options.frame.dock?.();
			if (page && dock !== undefined) page.emit("look", { dock });
		});
		/*
		 * A press or Escape on this page, which the frame does not hear: its open menus go. A press in the
		 * frame lands in the frame's document, so every press heard here is outside it.
		 */
		createEffect(() => {
			const page = d.end();
			if (!page) return;
			const press = () => page.emit("away", {});
			const key = (event: KeyboardEvent) => event.key === "Escape" && page.emit("away", {});
			window.addEventListener("pointerdown", press, true);
			window.addEventListener("keydown", key, true);
			onCleanup(() => {
				window.removeEventListener("pointerdown", press, true);
				window.removeEventListener("keydown", key, true);
			});
		});
		/*
		 * Where the composer is, on the frame's screen: said as the frame starts, as the composer or the
		 * frame changes size, and each time the pointer comes into the frame, since the composer is moved
		 * only from the page, by a hand that has to come back to the canvas to drag anything onto it.
		 */
		createEffect(() => {
			const page = d.end();
			const frame = d.frameAt();
			const composer = page && frame ? d.options.frame.composer?.() : undefined;
			if (!page || !frame || !composer) return;
			const say = () => {
				const at = frame.getBoundingClientRect();
				const box = composer.getBoundingClientRect();
				page.emit("look", { composer: box.width && box.height ? { x: box.x - at.x, y: box.y - at.y, w: box.width, h: box.height } : null });
			};
			const sized = new ResizeObserver(say);
			sized.observe(composer);
			sized.observe(frame);
			frame.addEventListener("pointerenter", say);
			onCleanup(() => {
				sized.disconnect();
				frame.removeEventListener("pointerenter", say);
			});
		});
		// Each agent's name and colour, when they change: the frame works out what is new itself.
		createEffect(() => {
			const page = d.end();
			const agents = d.options.frame.agents?.();
			if (page && agents) page.emit("look", { agents });
		});
	};

	return {
		keepInStep,
	};
}
