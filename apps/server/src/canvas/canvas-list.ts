import { existsSync, statSync } from "node:fs";
import type { ServerMessage } from "@decks/protocol";
import type { CanvasPens } from "./pens.ts";

/**
 * Every canvas in the deck, and who is on it: the manager's whole list (`protocol/CanvasRow`).
 *
 * Built from two records that already exist — the folders under `canvases/`, and each session's
 * own canvas field — because a canvas nobody has open is still a canvas, and an agent with a canvas
 * that has never been drawn on still has one. A server with no canvas files answers with nothing,
 * and the manager draws nothing rather than an empty room.
 */
export function canvasListMessage(pens: CanvasPens, everyone: ReadonlyArray<{ id: string; name: string; color: string; seat: { canvasFolder(): string | undefined } }>): ServerMessage {
	const canvases = pens.names().map((name) => {
		const { cards: cards, rev, shot, words } = pens.summary(name);
		let changedAt: number | undefined;
		try {
			changedAt = Math.round(statSync(existsSync(pens.fileOf(name)) ? pens.fileOf(name) : pens.folderOf(name)).mtimeMs);
		} catch {
			/* gone between the listing and the look */
		}
		const shared = pens.rights.sharing(name);
		return {
			name,
			title: pens.titleOf(name),
			...(shared ? { shared: { owner: shared.ownerName ?? shared.owner, role: shared.role } } : !pens.rights.yoursAlone(name) ? { othersEdit: true as const } : {}),
			...(changedAt ? { changedAt } : {}),
			cards: cards,
			rev,
			shot,
			words,
			...(pens.formerly(name).length ? { formerly: pens.formerly(name) } : {}),
			agents: everyone
				.filter((agent) => agent.seat.canvasFolder() === name)
				.map((agent) => ({ id: agent.id, name: agent.name, color: agent.color })),
		};
	});
	return { type: "canvas.list", canvases };
}
