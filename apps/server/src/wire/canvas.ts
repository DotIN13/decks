import type { WirePart } from "./context.ts";

/**
 * The frames about canvases: which one you are looking at, and what is drawn on it.
 *
 * A canvas is the deck's, not a conversation's, so these change something every browser can
 * see — with one exception. **Looking is per browser**: `canvas.focus` sets what this socket
 * is looking at and answers that socket alone, the same way opening a chat does, so a phone
 * and a laptop can be on two canvases at once.
 */
export const canvas = {
	"canvas.focus": (message, reply, wire) => {
		/*
		 * An empty id is "stop looking at a canvas": the browser has gone back to a chat's own
		 * stage, and from here on it is sent that conversation's boards again. Said rather than
		 * inferred, because the server cannot tell a browser that moved from one that went quiet.
		 */
		if (message.id === "") {
			if (wire.viewing) wire.viewing.canvas = undefined;
			reply({ type: "deck.state", deck: wire.stageState() });
			reply({ type: "canvases", canvases: wire.canvasList(), focused: "" });
			return;
		}
		const found = wire.canvases.get(message.id);
		if (!found) {
			reply({ type: "notice", level: "warn", text: "That canvas is gone." });
			return;
		}
		if (wire.viewing) wire.viewing.canvas = found.id;
		/*
		 * Opening it clears its changed mark, and only its own: the mark answers "what moved
		 * while I was away", and the answer is per canvas.
		 */
		wire.canvases.opened(found.id);
		reply({ type: "deck.state", deck: wire.canvasState(found.id) });
		reply({ type: "canvases", canvases: wire.canvasList(), focused: found.id });
	},

	"canvas.create": (message, reply, wire) => {
		/*
		 * One name, one canvas: a canvas is joined by name (`stage.canvas("…")`), so a second
		 * one wearing the same name would take work meant for the first. A name already in
		 * use is replaced by a fresh default rather than refused — nobody chose this one, the
		 * app generated it, and a dialog about a name the person never typed is worse than a
		 * different number.
		 */
		const wanted = message.name.trim();
		const name = !wanted || wire.canvases.nameTaken(wanted) ? wire.canvases.newName() : wanted;
		const made = wire.canvases.create({ name, ...(message.workspace ? { workspace: message.workspace } : {}) });
		// Made by the person, so it is not news to them: the mark is for what changed while they were elsewhere.
		wire.canvases.opened(made.id, made.changedAt);
		wire.publishCanvases();
		reply({ type: "deck.state", deck: wire.canvasState(made.id) });
		reply({ type: "canvases", canvases: wire.canvasList(), focused: made.id });
		if (wire.viewing) wire.viewing.canvas = made.id;
	},

	/** File a canvas under a workspace, or under none. The boards stay where they are. */
	"canvas.workspace": (message, _reply, wire) => {
		if (wire.canvases.setWorkspace(message.id, message.workspace)) wire.publishCanvases();
	},

	"canvas.rename": (message, reply, wire) => {
		// Refused rather than numbered: this name was typed, so the person is the one to change it.
		if (wire.canvases.nameTaken(message.name, message.id)) {
			reply({ type: "notice", level: "warn", text: `Another canvas is already called ${message.name.trim()}.` });
			reply({ type: "canvases", canvases: wire.canvasList() });
			return;
		}
		if (wire.canvases.rename(message.id, message.name)) wire.publishCanvases();
	},

	/*
	 * Removing a canvas removes the arrangement and nothing else.
	 *
	 * The boards are files in `boards/` and stay exactly where they are; what goes is the
	 * record of where they sat together. An agent left standing on it lands on no canvas,
	 * which is the same state a fresh chat is in.
	 */
	"canvas.remove": (message, _reply, wire) => {
		if (!wire.canvases.remove(message.id)) return;
		wire.publishCanvases();
		wire.send({ type: "deck.state", deck: wire.stageState() });
	},

	"canvas.use": (message, reply, wire) => {
		const agent = wire.agents.get(message.agentId);
		const found = wire.canvases.get(message.canvasId);
		if (!agent || !found) {
			reply({ type: "notice", level: "warn", text: "That agent or canvas is gone." });
			return;
		}
		agent.useCanvas(found.name);
		wire.publishCanvases();
	},

	"canvas.link": (message, _reply, wire) => {
		if (wire.canvases.link(message.id, message.from, message.to, message.label)) wire.publishCanvases();
	},

	"canvas.unlink": (message, _reply, wire) => {
		if (wire.canvases.unlink(message.id, message.from, message.to)) wire.publishCanvases();
	},

	"canvas.group": (message, _reply, wire) => {
		if (wire.canvases.group(message.id, message.name, message.boards)) wire.publishCanvases();
	},

	"canvas.ungroup": (message, _reply, wire) => {
		if (wire.canvases.ungroup(message.id, message.name)) wire.publishCanvases();
	},
} satisfies WirePart;
