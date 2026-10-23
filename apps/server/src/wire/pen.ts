import type { Op } from "@decks/pen";
import { deleteStage, titleCanvas } from "../stage/stage-admin.ts";
import type { WirePart } from "./context.ts";
import { asPerson } from "../verbs/person.ts";
import { penEditBy } from "../stage/pens.ts";

/**
 * The person's edits to a stage drawing (`stage/pens.ts`).
 *
 * The same operations an agent sends, applied the same way, so a drag in the browser and a
 * `decks.canvas.batch` from a model are one code path with one set of refusals. The change reaches
 * every browser as a `stage.pen` frame from the watcher's own announcement; a refusal goes back to
 * the one browser that asked, as a notice it can show.
 */
export const pen = {
	"stage.pen.edit": (message, reply, wire) => {
		const asked = { agent: message.agentId, ...(message.stage ? { stage: message.stage } : {}) };
		const edit = typeof message.edit === "string" && message.edit ? message.edit.slice(0, 80) : undefined;
		const run = () => asPerson({ agents: wire.agents, pens: wire.stage.pens }, asked, "pen.edit", [message.ops as Op[]], reply);
		void (edit ? penEditBy.run(edit, run) : run()).then((ok) => {
			if (ok) return;
			if (edit) reply({ type: "stage.pen.refused", agentId: message.agentId, edit });
			// Send the drawing back as it is, so a preview the browser drew for the failed edit goes away.
			const agent = wire.agents.get(message.agentId);
			const name = agent?.stageName();
			if (agent && name && wire.stage.pens) reply(wire.stage.pens.frame(agent.id, name));
		});
	},
	/** The whole drawing again, for a browser that missed a revision of the edits. */
	"stage.pen.get": (message, reply, wire) => {
		const agent = wire.agents.get(message.agentId);
		const name = agent?.stageName();
		if (!agent || !name || !wire.stage.pens) return;
		reply(wire.stage.pens.frame(agent.id, name));
	},
	/**
	 * Put an agent on a stage, because the person picked it in the manager.
	 *
	 * The same call the agent makes with `decks.agent.update({ canvas })`, so nothing here knows anything the agent's
	 * own path does not: the session takes that stage's boards as its own and sends its browser the
	 * drawing. The arrangement goes to every browser from `openStage` itself (`arranged`), so it is
	 * not sent again here: a second copy of the deck state was 400 KB more for the page to take in
	 * on every switch of canvas.
	 */
	"agent.stage": (message, reply, wire) => {
		if (!wire.agents.get(message.id)) return;
		void asPerson({ agents: wire.agents, pens: wire.stage.pens }, { agent: message.id }, "open", [message.stage], reply);
	},

	/** A stage made from a name you typed, opened for that agent at once. */
	"stage.new": (message, reply, wire) => {
		if (!wire.agents.get(message.id)) return;
		const title = typeof message.title === "string" ? message.title.trim() : "";
		if (!title) return;
		void asPerson({ agents: wire.agents, pens: wire.stage.pens }, { agent: message.id }, "newStage", [title], reply).then((ok) => {
			if (ok) reply({ type: "deck.state", deck: wire.stageState() });
		});
	},

	/**
	 * Rename a stage: its name, and nothing else (`StagePens.setTitle`). The folder is the stage's id
	 * and stays, so no board path, camera or agent moves with a new name.
	 */
	"stage.rename": (message, reply, wire) => {
		const pens = wire.stage.pens;
		if (!pens || typeof message.name !== "string" || typeof message.to !== "string") return;
		try {
			titleCanvas({ deck: wire.deck, pens, agents: wire.agents.all() }, message.name, message.to);
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
			return;
		}
		reply({ type: "deck.state", deck: wire.stageState() });
		wire.publishStages();
	},

	/** Delete a stage (`stage/stage-admin.ts`); agents on it move to a fresh stage of their own. */
	"stage.delete": (message, reply, wire) => {
		const pens = wire.stage.pens;
		if (!pens || typeof message.name !== "string") return;
		try {
			deleteStage({ deck: wire.deck, pens, agents: wire.agents.all() }, message.name);
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
			return;
		}
		reply({ type: "deck.state", deck: wire.stageState() });
		wire.publishStages();
	},

	/** Undo and redo the person's own edits (`StagePens.step`): refused, with a sentence, when an agent has drawn since. */
	"stage.pen.step": (message, reply, wire) => {
		const agent = wire.agents.get(message.agentId);
		const pens = wire.stage.pens;
		if (!agent || !pens) return;
		const name = message.stage && pens.has(message.stage) ? message.stage : agent.stageName(false);
		if (!name) return;
		const edit = typeof message.edit === "string" && message.edit ? message.edit.slice(0, 80) : undefined;
		try {
			const step = () => pens.step(name, message.direction === "redo" ? "redo" : "undo");
			if (edit) penEditBy.run(edit, step);
			else step();
		} catch (error) {
			// A browser that showed the step ahead of the answer stops showing it.
			if (edit) reply({ type: "stage.pen.refused", agentId: message.agentId, edit });
			reply({ type: "notice", level: "info", text: (error as Error).message });
		}
	},
} satisfies WirePart;
