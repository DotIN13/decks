import { createSignal, type Accessor } from "solid-js";
import type { Camera, Presence, PresenceBy, ServerMessage } from "@decks/protocol";
import { toWorld } from "../../camera/camera.ts";

/** Someone else on this canvas, as last heard: who, and where their pointer, selection and camera are. */
export interface Present extends Presence {
	by: PresenceBy;
	at: number;
}

/** How often at most this frame says where its pointer is. */
export const POINTER_MS = 50;

/**
 * Presence: where everyone else on this canvas is, and where this frame is for them.
 *
 * Out: the pointer in canvas units at most twenty times a second while it moves, gone when it leaves
 * the window; the selection when it changes; the camera when it rests. Each is one `presence.set`
 * carrying only what changed. In: `presence.changed` for every other line on the canvas, kept by
 * who said it, and dropped when they go (`gone`). Nothing here is drawn: `frame.tsx` draws the
 * pointers as cursors and the selections as outlines from `present()`.
 */
export function installPresence(options: { camera: Accessor<Camera>; send: (presence: Presence) => void; viewport: () => { width: number; height: number } }) {
	const [present, setPresent] = createSignal<Map<string, Present>>(new Map());
	let last = 0;
	let pointerOut = true;
	const pointer = (event: PointerEvent) => {
		const now = performance.now();
		if (now - last < POINTER_MS) return;
		last = now;
		pointerOut = false;
		options.send({ pointer: toWorld(options.camera(), options.viewport(), { x: event.clientX, y: event.clientY }) });
	};
	const leave = () => {
		if (pointerOut) return;
		pointerOut = true;
		options.send({ pointer: null });
	};
	addEventListener("pointermove", pointer, { capture: true, passive: true });
	addEventListener("pointerleave", leave, true);
	addEventListener("blur", leave);
	document.addEventListener("mouseleave", leave);
	return {
		present,
		/** The selection changed: said as it is. */
		selection: (ids: readonly string[]) => options.send({ selection: [...ids] }),
		/** The camera rests here. */
		camera: (camera: Camera) => options.send({ camera }),
		/** What the line says of someone else. */
		hear(message: ServerMessage): boolean {
			if (message.type !== "presence.changed") return false;
			const key = `${message.by.harness ?? ""}/${message.by.kind}/${message.by.id}`;
			setPresent((all) => {
				const next = new Map(all);
				if (message.gone) next.delete(key);
				else {
					const was = next.get(key);
					next.set(key, {
						by: message.by,
						at: Date.now(),
						pointer: message.pointer === undefined ? was?.pointer : message.pointer,
						selection: message.selection ?? was?.selection,
						camera: message.camera === undefined ? was?.camera : message.camera,
					});
				}
				return next;
			});
			return true;
		},
		dispose() {
			removeEventListener("pointermove", pointer, true);
			removeEventListener("pointerleave", leave, true);
			removeEventListener("blur", leave);
			document.removeEventListener("mouseleave", leave);
		},
	};
}
