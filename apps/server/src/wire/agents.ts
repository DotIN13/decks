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
			// From under a workspace heading: the agent is in that project.
			...(message.workspace ? { workspace: message.workspace } : {}),
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

	"agent.focus": (message, reply, wire) => {
		/*
		 * The arrangement comes with the switch, and **after** it.
		 *
		 * Positions were sent once and never again, which was fine while they did not depend on the stage:
		 * now every conversation would keep showing the arrangement of whichever one was opened first.
		 * Order matters — `stageState` reads the focused stage, so sending before `focus` would hand the
		 * browser the arrangement it was leaving.
		 */
		wire.agents.focus(message.id);
		// To the asker alone: the focus is this browser's, and every other one is still where it was.
		reply({ type: "deck.state", deck: wire.stageState() });
	},

	"agent.remove": (message, reply, wire) => {
		const outcome = wire.agents.remove(message.id);
		if (outcome.removed) wire.acts.forget(message.id);
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

	/*
	 * A rename from a person, which is the same act as `stage.me({ name })` from the agent.
	 *
	 * Refused when the name is taken, and said out loud: a name is an address — the bar reads
	 * `@Sable` and the deck has to know which Sable — so two agents cannot share one. The
	 * agent's own rename throws the same refusal at the model (`stage/tool.ts`).
	 */
	"agent.rename": (message, reply, wire) => {
		const agent = wire.agents.get(message.id);
		const name = message.name.trim().slice(0, 40);
		if (!agent || !name) return;
		if (wire.agents.nameTaken(name, agent.id)) {
			reply({ type: "notice", level: "warn", text: `Another agent is already called ${name}.` });
			// The field is holding a name the deck refused; this is what puts the old one back.
			reply({ type: "agent.identity", id: agent.id, identity: agent.chat().identity });
			return;
		}
		agent.rename(name);
	},

	/*
	 * The workspace, from the row's customise popup.
	 *
	 * One field and one writer at a time: this is the same value `stage.me.setWorkspace` writes,
	 * so whoever moved last is where the agent is. Silent when the agent is gone, like the tags
	 * above — the row a popup was opened from can be removed by another tab.
	 */
	"agent.workspace": (message, _reply, wire) => {
		wire.agents.get(message.id)?.setWorkspace(message.workspace);
	},

	"agent.prompt": (message, _reply, wire) => {
		const agent = wire.agents.get(message.id) ?? wire.agents.focused();
		/*
		 * Deliberately not awaited: a prompt runs for minutes and the socket has other frames
		 * to handle meanwhile. Everything it produces arrives as events of its own.
		 *
		 * The row, not the list. This was `publish()` — the whole chat list, to report that one
		 * row now shows what you just typed. `sayRow` is the same news about the one chat it
		 * happened to; the end of the turn says it again from the session itself, which is
		 * where work an agent gave itself ends too. A prompt that *makes* an agent still
		 * publishes, from `create`, because then the list really is different.
		 */
		void agent.prompt(message.text);
		agent.sayRow();
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
		if (!asked) return;
		reply(asked.historyMessage());
		// And its drawing, which is part of what that chat's stage shows.
		const pen = wire.penMessage(message.agentId);
		if (pen) reply(pen);
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
		// Answered after the frame is over, so the browser that asked is kept to move to the fork.
		const view = wire.viewing;
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
			if (view) view.focused = child.id;
			wire.agents.focus(child.id);
		});
	},

	"extension.ui.answer": (message, _reply, wire) => {
		// The answer carries no agent id — a dialog id is unique across them —
		// so it goes to every agent and the one holding that question takes it.
		for (const agent of wire.agents.all()) agent.answerDialog(message.answer);
	},
} satisfies WirePart;
