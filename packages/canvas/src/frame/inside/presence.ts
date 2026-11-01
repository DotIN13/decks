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
/** How long an agent's cursor stays on a card after its work there is done. */
export const ACT_LINGER_MS = 2500;

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
	/** Agents' cursors on their way out, by key. */
	const linger = new Map<string, ReturnType<typeof setTimeout>>();
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
		/**
		 * An agent at work on a card (`agent.act`): its cursor at the card, or at the first box it drew,
		 * and the card outlined in its colour, as a person's presence is; gone a moment after it is done.
		 */
		act(message: { agentId: string; phase: "start" | "done"; label: string; color: string; at: number; boxes?: Array<{ x1: number; y1: number }> }, card: { id?: string; x: number; y: number } | undefined): void {
			const key = `act/agent/${message.agentId}`;
			const by: PresenceBy = { kind: "agent", id: message.agentId, name: message.label, color: message.color };
			const box = message.boxes?.[0];
			const pointer = box ? { x: box.x1, y: box.y1 } : card ? { x: card.x + 28, y: card.y + 52 } : undefined;
			clearTimeout(linger.get(key));
			setPresent((all) => {
				const next = new Map(all);
				next.set(key, { by, at: message.at, ...(pointer ? { pointer } : {}), selection: card?.id && message.phase === "start" ? [card.id] : [] });
				return next;
			});
			if (message.phase === "done") linger.set(key, setTimeout(() => setPresent((all) => {
				const next = new Map(all);
				next.delete(key);
				return next;
			}), ACT_LINGER_MS));
		},
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
