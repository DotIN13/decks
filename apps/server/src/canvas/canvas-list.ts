import { existsSync, statSync } from "node:fs";
import type { ServerMessage } from "@decks/protocol";
import type { StagePens } from "./pens.ts";

/**
 * Every stage in the deck, and who is on it: the manager's whole list (`protocol/StageRow`).
 *
 * Built from two records that already exist — the folders under `canvases/`, and each session's
 * own stage field — because a stage nobody has open is still a stage, and an agent with a stage
 * that has never been drawn on still has one. A server with no stage files answers with nothing,
 * and the manager draws nothing rather than an empty room.
 */
export function canvasListMessage(pens: StagePens, everyone: ReadonlyArray<{ id: string; name: string; color: string; seat: { stageName(): string | undefined } }>): ServerMessage {
	const stages = pens.names().map((name) => {
		const { boards, rev, words } = pens.summary(name);
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
			boards,
			rev,
			words,
			...(pens.formerly(name).length ? { formerly: pens.formerly(name) } : {}),
			agents: everyone
				.filter((agent) => agent.seat.stageName() === name)
				.map((agent) => ({ id: agent.id, name: agent.name, color: agent.color })),
		};
	});
	return { type: "canvas.list", stages };
}
