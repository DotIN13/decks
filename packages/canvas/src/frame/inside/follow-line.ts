import type { Backend } from "./backend.ts";
import { type CanvasHandle } from "../../view/types.ts";
import { type FramePage } from "../protocol.ts";
import { type Heard } from "./backend.ts";
import { type StudioLine } from "./studio-line.ts";
import type { Accessor, Setter } from "solid-js";
import type { PenDocument } from "@decks/pen";
import { serialize } from "@decks/pen";
import { untrack } from "solid-js";
import type { Page, CanvasCall } from "@decks/protocol";
import type { FrameContext } from "./boot.ts";

/** What `followLine` reads of `wireFrame` (`events.ts`), each read when it is used. */
export interface FollowLineNeeds {
	readonly studio: StudioLine | undefined;
	readonly handle: CanvasHandle;
	readonly changed: () => void;
	readonly first: { doc: PenDocument; base: string; rev: number; by?: string; cards: Page[]; harness?: string; };
	readonly ctx: FrameContext;
	readonly backend: Backend;
	readonly viewCall: (call: CanvasCall) => undefined;
	readonly pages: Accessor<FramePage[]>;
	readonly setPages: Setter<FramePage[]>;
	readonly follower: { at(next: number): void; rev: () => number; hear(message: Heard): void; };
}

export function followLine(d: FollowLineNeeds) {
	// On Studio: the drawing as Studio's revisions change it, kept in step as Studio's own page keeps it.
	if (d.studio)
		d.studio.follow(
			(doc) => {
				d.handle.setDocument(serialize(doc));
				d.changed();
			},
			() => d.handle.document(),
			d.first.rev,
			(message) => void d.ctx.presence?.hear(message),
		);
	else d.backend.follow((message) => {
		if (message.type === "view.called") return d.viewCall(message.call);
		if (message.type === "presence.changed") return void d.ctx.presence?.hear(message);
		// An agent at work on a card: its cursor and outline, from the card's place on the drawing. What it
		// draws on the canvas is marked from the drawing's own change instead (`edits` above).
		if (message.type === "agent.act") {
			if (message.what === "draw") return;
			const page = untrack(d.pages).find((one) => one.path === message.path) ?? untrack(d.pages).find((one) => message.path.endsWith(one.path) || one.path.endsWith(message.path));
			let id: string | undefined;
			try {
				id = ((d.handle.drawn().children ?? []) as unknown as Array<{ id?: string; metadata?: { path?: string } }>).find((one) => one.metadata?.path && page?.path.endsWith(one.metadata.path))?.id;
			} catch {
				id = undefined;
			}
			d.ctx.presence?.act(message, page ? { id, x: page.x, y: page.y } : undefined);
			return;
		}
		if (message.type.startsWith("doc.")) return d.ctx.hearDoc(message);
		// An app's state changed: its windows hear it (`apps.watch`), and nothing asks the harness again.
		if (message.type === "app.changed") {
			for (const listener of d.ctx.appWatchers.get(message.name) ?? []) listener({ ...(message.title ? { title: message.title } : {}), status: message.status, ...(message.reload === undefined ? {} : { reload: message.reload }) });
			return;
		}
		// A card's file changed: its record taken, its place kept, as the drawing says it.
		if (message.type === "card.changed") {
			if (message.removed || !message.card) return;
			const record = message.card;
			/*
			 * A change of its size alone keeps the surface showing it: the record says so (`sized`), and a later
			 * change of its words clears it. The same revision said again (the file watcher's word after the
			 * writer's) is no new change, so what the first message said of it stands.
			 */
			d.setPages(untrack(d.pages).map((page) => (page.path === record.path ? { ...record, x: page.x, y: page.y, w: page.w, h: page.h, trust: page.trust, ...(message.sized || (page.sized && page.rev === record.rev) ? { sized: true as const } : {}) } : page)));
			return;
		}
		d.follower.hear(message);
	}, () => d.follower.rev());

}
