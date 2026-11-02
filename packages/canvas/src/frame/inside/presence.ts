import { life } from "./life.ts";
import { createSignal, type Accessor } from "solid-js";
import type { Camera, Presence, PresenceBy, ServerMessage } from "@decks/protocol";
import { toWorld } from "../../camera/camera.ts";

/** Someone else on this canvas, as last heard: who, and where their pointer, selection and camera are. */
export interface Present extends Presence {
	by: PresenceBy;
	at: number;
	/** On its way out: drawn fading, with no pointer, until it is dropped. */
	leaving?: true;
}

/** How often at most this frame says where its pointer is. */
const POINTER_MS = 50;
/** How long an agent's cursor stays on a card after its work there is done. */
const ACT_LINGER_MS = 2500;
/** How long an agent's cursor stays on the last thing it drew, waiting for its next edit. */
const TOUR_LINGER_MS = 3200;
/** How long the cursor rests on each thing an edit touched before moving to the next: its drift is 380 ms. */
const TOUR_STEP_MS = 340;
/** More stops waiting than this and the older ones are skipped: the cursor keeps up with the agent rather than replaying. */
const TOUR_MOST = 6;
/** How long a cursor is kept, pointer gone, for its fade out (`AgentCursor`, 600 ms). */
export const LEAVE_MS = 650;

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
	/** Each agent's tour: the stops still to make and the timer between them, by key. */
	const tours = new Map<string, { stops: Array<{ x: number; y: number }>; timer?: ReturnType<typeof setTimeout> }>();
	/** Let an agent's cursor go: fading first, then dropped. */
	const letGo = (key: string) => {
		setPresent((all) => {
			const was = all.get(key);
			if (!was) return all;
			const next = new Map(all);
			next.set(key, { ...was, pointer: undefined, leaving: true });
			return next;
		});
		linger.set(key, setTimeout(() => {
			linger.delete(key);
			setPresent((all) => {
				const next = new Map(all);
				next.delete(key);
				return next;
			});
		}, LEAVE_MS));
	};
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
	addEventListener("pointermove", pointer, { capture: true, passive: true, signal: life() });
	addEventListener("pointerleave", leave, { capture: true, signal: life() });
	addEventListener("blur", leave, { signal: life() });
	document.addEventListener("mouseleave", leave, { signal: life() });
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
			if (message.phase === "done") linger.set(key, setTimeout(() => letGo(key), ACT_LINGER_MS));
		},
		/**
		 * An agent's edit landed: its cursor goes to each thing it touched in turn, resting `TOUR_STEP_MS`
		 * on each, and stays on the last for `TOUR_LINGER_MS` so a run of edits reads as one hand at
		 * work rather than a cursor that comes and goes. Stops past `TOUR_MOST` are skipped, newest kept.
		 */
		tour(agentId: string, by: PresenceBy, stops: ReadonlyArray<{ x: number; y: number }>): void {
			if (!stops.length) return;
			const key = `act/agent/${agentId}`;
			clearTimeout(linger.get(key));
			linger.delete(key);
			const tour = tours.get(key) ?? { stops: [] };
			tours.set(key, tour);
			tour.stops.push(...stops);
			if (tour.stops.length > TOUR_MOST) tour.stops.splice(0, tour.stops.length - TOUR_MOST);
			const step = () => {
				const stop = tour.stops.shift();
				if (!stop) {
					tour.timer = undefined;
					linger.set(key, setTimeout(() => letGo(key), TOUR_LINGER_MS));
					return;
				}
				setPresent((all) => {
					const next = new Map(all);
					const was = next.get(key);
					next.set(key, { by, at: Date.now(), pointer: stop, selection: was?.selection ?? [] });
					return next;
				});
				tour.timer = setTimeout(step, TOUR_STEP_MS);
			};
			if (tour.timer === undefined) step();
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
			for (const tour of tours.values()) clearTimeout(tour.timer);
			for (const timer of linger.values()) clearTimeout(timer);
			removeEventListener("pointermove", pointer, true);
			removeEventListener("pointerleave", leave, true);
			removeEventListener("blur", leave);
			document.removeEventListener("mouseleave", leave);
		},
	};
}
