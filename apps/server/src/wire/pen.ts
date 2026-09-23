import type { Op } from "@decks/pen";
import type { WirePart } from "./context.ts";

/**
 * The person's edits to a stage drawing (`stage/pens.ts`).
 *
 * The same operations an agent sends, applied the same way, so a drag in the browser and a
 * `stage.pen.edit` from a model are one code path with one set of refusals. The change reaches
 * every browser as a `stage.pen` frame from the watcher's own announcement; a refusal goes back to
 * the one browser that asked, as a notice it can show.
 */
export const pen = {
	"stage.pen.edit": (message, reply, wire) => {
		const agent = wire.agents.get(message.agentId);
		const pens = wire.stage.pens;
		if (!agent || !pens || !Array.isArray(message.ops)) return;
		const name = agent.stageName(true);
		if (!name) return;
		try {
			pens.edit(name, message.ops as Op[], undefined, { undoable: true });
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
			// Send the drawing back as it is, so a preview the browser drew for the failed edit goes away.
			reply(pens.frame(agent.id, name));
		}
	},
	/** Undo and redo the person's own edits (`StagePens.step`): refused, with a sentence, when an agent has drawn since. */
	"stage.pen.step": (message, reply, wire) => {
		const agent = wire.agents.get(message.agentId);
		const pens = wire.stage.pens;
		if (!agent || !pens) return;
		const name = agent.stageName(false);
		if (!name) return;
		try {
			pens.step(name, message.direction === "redo" ? "redo" : "undo");
		} catch (error) {
			reply({ type: "notice", level: "info", text: (error as Error).message });
		}
	},
} satisfies WirePart;
