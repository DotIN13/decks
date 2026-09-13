import type { WirePart } from "./context.ts";

/**
 * The conversation frames: the chat list, a turn, and the three ways to go back through one.
 *
 * Split from the board frames because they answer a different question — what an agent is
 * doing and what it said — and because this is where most of the frames are. The pattern
 * throughout is `wire.agents.get(id)` if asked for one, `wire.agents.focused()` when the
 * frame is about "the conversation you are in".
 */
export const agents = {
	"agent.create": (message, _reply, wire) => {
		/*
		 * A new agent is a new row in the accounts mapping — it starts on the default
		 * and records it — so the panel and the picker have to hear about it. Without
		 * this the picker for a fresh conversation showed nothing selected until
		 * something else happened to republish the list.
		 */
		const agent = wire.agents.create({
			... (message.parentId ? { parentId: message.parentId } : {}),
			... (message.kind ? { kind: message.kind } : {}),
		});
		/*
		 * Asked for by a person, so it is what they want to talk to. A subagent is
		 * created through `Registry.spawn` instead and deliberately does not take
		 * the focus — its parent is mid-turn and still has something to say.
		 */
		wire.agents.focus(agent.id);
		void wire.publishAccounts();
	},

	"agent.focus": (message, _reply, wire) => {
		wire.agents.focus(message.id);
	},

	"agent.remove": (message, reply, wire) => {
		const outcome = wire.agents.remove(message.id);
		if (!outcome.removed && outcome.reason) reply({ type: "notice", level: "warn", text: outcome.reason });
	},

	/*
	 * Your own tags on an agent, from the customise popup.
	 *
	 * Silent when the agent is gone: the popup is opened from a row, and a row can be
	 * removed by another tab between the open and the save. There is nothing useful to
	 * say about it — the list the popup was editing no longer exists.
	 */
	"agent.tags": (message, _reply, wire) => {
		wire.agents.get(message.id)?.setUserTags(message.tags);
	},

	"agent.prompt": (message, _reply, wire) => {
		const agent = wire.agents.get(message.id) ?? wire.agents.focused();
		// Deliberately not awaited: a prompt runs for minutes and the socket has
		// other frames to handle meanwhile. Everything it produces arrives as
		// events, and `publish()` refreshes the chat list once it settles.
		void agent.prompt(message.text).then(() => wire.agents.publish());
		wire.agents.publish();
	},

	"agent.abort": (message, _reply, wire) => {
		void wire.agents.get(message.id)?.abort();
	},

	/*
	 * A history, for the conversation a browser is about to show. To the asker alone,
	 * like scrollback: another tab showing another chat has no use for it. An agent that
	 * is not here gets no answer rather than an empty one, which would wipe a transcript
	 * the browser was given some other way.
	 */
	"chat.open": (message, reply, wire) => {
		const asked = wire.agents.get(message.agentId);
		if (asked) reply(asked.historyMessage());
	},

	"chat.tool": (message, reply, wire) => {
		const asked = wire.agents.get(message.agentId);
		reply({ type: "chat.tool", agentId: message.agentId, itemId: message.itemId, result: asked?.toolResult(message.itemId) ?? "" });
	},

	/*
	 * Answered to the asker alone, not broadcast.
	 *
	 * Every other chat message goes to every client because it is news about the
	 * conversation. This is not news — it is one reader's scrollback, and a
	 * second tab that has not scrolled has no use for a page it did not ask for
	 * and would prepend it to a window it is not looking at.
	 */
	"chat.earlier": (message, reply, wire) => {
		const asked = wire.agents.get(message.agentId);
		if (!asked) {
			reply({ type: "chat.earlier", agentId: message.agentId, before: message.before, items: [], more: false });
			return;
		}
		const page = asked.earlier(message.before, Math.min(Math.max(message.limit ?? 60, 1), 200));
		reply({ type: "chat.earlier", agentId: message.agentId, before: message.before, items: page.items, more: page.more });
	},

	"agent.setModel": (message, reply, wire) => {
		const agent = wire.agents.get(message.id);
		if (!agent) return;
		void agent
			.setModel(message.provider, message.model, message.thinking)
			.catch((error: unknown) => reply({ type: "error", text: (error as Error).message }));
	},

	"agent.thinking": (message, reply, wire) => {
		// Fire and forget: it may have to start a runtime first, and the browser has
		// already drawn the level it pressed. What comes back is `agent.model`.
		void wire.agents
			.get(message.id)
			?.setThinking(message.thinking)
			.catch((error: unknown) => reply({ type: "notice", level: "warn", text: `Could not change the thinking level: ${(error as Error).message}` }));
	},

	/*
	 * The usage panel, read on demand.
	 *
	 * Replied to rather than broadcast: a second tab did not open this panel and has
	 * no use for figures it did not ask for. The `/cost` path is the other way round
	 * and broadcasts — see `pushReport` — because there the *agent* asked.
	 */
	"agent.report": (message, reply, wire) => {
		const agent = wire.agents.get(message.id);
		if (!agent) {
			reply({ type: "agent.report", id: message.id, error: "That agent is gone." });
			return;
		}
		void agent
			.report()
			.then((report) => reply({ type: "agent.report", id: message.id, report }))
			.catch((error: unknown) => reply({ type: "agent.report", id: message.id, error: (error as Error).message }));
	},

	"agent.setMode": (message, reply, wire) => {
		const agent = wire.agents.get(message.id);
		if (!agent) return;
		void agent
			.setMode(message.mode)
			.then(() => wire.agents.publish())
			.catch((error: unknown) => {
				reply({ type: "notice", level: "warn", text: `Could not change mode: ${(error as Error).message}` });
			});
	},

	"rewind.preview": (message, reply, wire) => {
		const agent = wire.agents.get(message.id);
		if (!agent) return;
		// A preview is a read. Nothing is written, and the browser renders those
		// revisions read-only.
		reply({
			type: "timeline.preview",
			agentId: message.id,
			entryId: message.entryId,
			boards: message.entryId ? wire.boards.boardsAt(agent, message.entryId) : {},
		});
	},

	"rewind.to": (message, reply, wire) => {
		const agent = wire.agents.get(message.id);
		if (!agent) return;
		void agent.rewindTo(message.entryId).then((result) => {
			wire.agents.publish();
			if (result.cancelled) {
				reply({ type: "notice", level: "info", text: "Rewind cancelled." });
				return;
			}
			/*
			 * The rewound message goes back in the composer, which is what the deck has
			 * been passing `editorText` around for since rewinding existed — and where it
			 * never actually went. It was announced instead, so the notice carried the
			 * whole message: a paragraph in a toast, saying a thing the transcript above
			 * it already said, and the one place it would have been useful — the input
			 * bar, ready to be said differently — was empty.
			 */
			reply({ type: "notice", level: "info", text: "Rewound." });
			if (result.editorText) reply({ type: "composer.draft", text: result.editorText });
		});
	},

	"fork.from": (message, _reply, wire) => {
		const agent = wire.agents.get(message.id);
		if (!agent) return;
		// Async now: Claude's handle comes from copying a session file, which Pi
		// can do from memory.
		void agent.forkFrom(message.entryId).then((resumeRef) => {
			if (!resumeRef) {
				_reply({ type: "notice", level: "warn", text: "There is nothing before that message to fork from." });
				return;
			}
			const at = agent.entryTime(message.entryId);
			// A fork is a new chat that remembers everything up to that point —
			// including what was on the canvas then, so it does not open blank.
			const child = wire.agents.create({
				name: `${agent.chat().name} (fork)`,
				resumeRef,
				kind: agent.kind,
				...(at ? { forkedFrom: { agentId: agent.id, at } } : {}),
				// And the model it was being held in. A fork continues one
				// conversation; answering the rest of it from a different model is a
				// change nobody asked for, and on Claude there is no session file to
				// recover the choice from.
				...(agent.model ? { model: agent.model } : {}),
				...(agent.mode ? { mode: agent.mode } : {}),
			});
			wire.agents.focus(child.id);
		});
	},

	"extension.ui.answer": (message, _reply, wire) => {
		// The answer carries no agent id — a dialog id is unique across them —
		// so it goes to every agent and the one holding that question takes it.
		for (const agent of wire.agents.all()) agent.answerDialog(message.answer);
	},
} satisfies WirePart;
