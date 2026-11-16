import { receiveQueued } from "../../state/queued.ts";
import type { AgentState } from "@decks/protocol";
import { reconcile } from "solid-js/store";
import { scratch } from "../../state/agent.ts";
import { ensureAgent, nameOf, setState, state } from "../../state/deck.ts";
import { ensureHistory } from "../../state/history.ts";
import { finished, startedAsking } from "@decks/agent-ui/alerts";
import { accountChanged, releasePages, setUnread, setUsagePanel, tookReport } from "../../state/ui.ts";
import type { FrameHooks, Of } from "../socket-messages.ts";

/**
 * Whether a value from the wire differs from the one already held.
 *
 * Serialised rather than compared field by field, because the four things this is asked
 * about are small and shaped differently — an identity with two lists in it, a list of
 * board paths, a model, a reading of three numbers. Reading a store proxy through
 * `JSON.stringify` walks it, which is the point: it is the *contents* that decide whether
 * anything downstream needs to run again.
 */
function changed(held: unknown, arrived: unknown): boolean {
	return JSON.stringify(held ?? null) !== JSON.stringify(arrived ?? null);
}

/**
 * What an agent's state means, whichever message carried it.
 *
 * The moment a face turns green (`agents/agent-order.ts`), said out loud — and keyed on the
 * *transition* rather than the value, so a reconnection, which replays the state of every
 * agent on the deck, does not ring five times. Two messages carry a state now: the row in the
 * chat list and the `agent.state` that follows a change, and both have to mean the same thing
 * or a chat that finished while the socket was down rings twice or not at all.
 */
function heardState(id: string, state_: AgentState, hooks: FrameHooks): void {
	const mine = scratch.of(id);
	const was = mine.lastState;
	mine.lastState = state_;
	if (finished(was, state_)) {
		hooks.raise("done", {
			title: `${nameOf(id)} finished`,
			// The deck's name, so a banner from one of three windows says which one.
			body: state.deck?.name,
			tag: `done:${id}`,
			agent: id,
		});
	} else if (startedAsking(was, state_)) {
		hooks.raise("ask", { title: `${nameOf(id)} is waiting for you`, tag: `ask:${id}`, agent: id });
	}
}

/** The list of agents, and the rest of each row, into the places the app reads them from. */
function heardAgentList(message: Extract<Of<"agent">, { type: "agent.list" }>, hooks: FrameHooks): void {
	const focused = message.focused ?? state.focused;
	// A different conversation is a different history: the turn the chat was
	// opened at belongs to the one you were reading.
	if (focused !== state.focused) {
		hooks.setAtTurn(undefined);
	}
	setState({ chats: message.chats, focused, defaultKind: message.defaultKind });
	/*
	 * And the rest of each row, into the places the app reads them from.
	 *
	 * These arrived as seven messages per chat until the row carried them: the
	 * identity, the boards, the model, the account, the reading. The unpacking
	 * is here rather than at each reader because everything above this line
	 * already keys by agent id, and a row is a fact about one agent however it
	 * travelled. The state handler is the same one a live `agent.state` uses, so
	 * a chat that finished while the socket was down still rings on reconnect.
	 *
	 * **Only what changed is written.** The list is published for a dozen
	 * reasons that have nothing to do with these fields — a prompt sent, a turn
	 * finished, a chat focused — and a write of an equal value is still a write:
	 * it would invalidate every agent's boards on every prompt, and everything
	 * derived from them. A separate message only ever
	 * arrived when something had actually moved, and this has to mean the same.
	 */
	for (const chat of message.chats) {
		ensureAgent(chat.id);
		if (chat.identity && changed(state.identities[chat.id], chat.identity)) setState("identities", chat.id, chat.identity);
		if (changed(state.contexts[chat.id], chat.boards)) setState("contexts", chat.id, chat.boards ?? []);
		const held = state.agents[chat.id];
		if (changed(held?.inPlay, chat.inPlay)) setState("agents", chat.id, "inPlay", chat.inPlay ?? []);
		if (changed(held?.model, chat.model)) setState("agents", chat.id, "model", chat.model);
		if (changed(held?.usage, chat.usage)) setState("agents", chat.id, "usage", chat.usage);
		if (held?.spending !== chat.account) setState("agents", chat.id, "spending", chat.account);
		heardState(chat.id, chat.state, hooks);
	}
	ensureHistory(focused);
	// No chat to wait for: the deck is all there is to open.
	if (!focused) releasePages();
}

/**
 * Drop what was being kept for it. The `agents` frame that follows sets the
 * list and the focus, so this is only about not holding a transcript for a
 * chat that is gone — and about not showing its unread count on whatever row
 * happens to take its place.
 *
 * One record and one scratch, each dropped whole. The teardown this replaces
 * cleared seven maps by hand and missed four: `moreHistory`, `dialogs`,
 * `previews` and `spendingByAgent` all outlived the agent. Dropping a record
 * cannot miss a field, which is the point of there being one.
 *
 * `scratch.forget` carries the part that was never drawn — including the last
 * state, so a new agent cannot inherit a dead one's and be reported as having
 * just finished. Ids are unique, but the map would otherwise grow all session.
 */
function forgetAgent(id: string): void {
	scratch.forget(id);
	setState("agents", id, undefined);
	setState("identities", id, undefined as never);
	setState("contexts", id, undefined as never);
	setUnread(id, 0);
}

/**
 * The four fields of a row that no other message carries, restated in full.
 *
 * Assigned rather than merged, because the message is a complete statement of
 * those four: a chat that was dormant and is now running says so by not saying
 * `dormant`, and a merge would leave it asleep for ever. Everything else on the
 * row is left exactly as it was — this is not a row, it is the part of one that
 * moves when a turn starts and ends.
 */
function heardRow(message: Extract<Of<"agent">, { type: "agent.row" }>): void {
	setState("chats", (chats) =>
		chats.map((chat) => {
			if (chat.id !== message.id) return chat;
			const { lastLine: _line, lastAt: _at, mode: _mode, dormant: _dormant, outside: _outside, ...rest } = chat;
			return {
				...rest,
				...(message.lastLine === undefined ? {} : { lastLine: message.lastLine }),
				...(message.lastAt === undefined ? {} : { lastAt: message.lastAt }),
				...(message.mode ? { mode: message.mode } : {}),
				...(message.dormant ? { dormant: true as const } : {}),
				...(message.outside ? { outside: message.outside } : {}),
			};
		}),
	);
}

/** What is said of one agent: that it is gone, who it is, what it is doing, its model, its usage, a question it asks. */
export function heardAgent(message: Of<"agent">, hooks: FrameHooks): void {
	switch (message.type) {
		case "agent.list":
			heardAgentList(message, hooks);
			return;

		case "agent.removed":
			forgetAgent(message.id);
			return;

		/*
		 * Replaced, not merged. A store setter merges an object into what is there, and the
		 * server leaves an empty field out: removing the last tag, or taking an agent out
		 * of its workspace, sent an identity without that key and the old value stayed.
		 */
		case "agent.identity":
			setState("identities", message.id, reconcile(message.identity));
			return;

		// An agent acting on a board or a drawing: the canvas no longer draws agents' cursors or marks.
		case "agent.act":
			return;

		case "agent.state": {
			setState("chats", (chats) => chats.map((chat) => (chat.id === message.id ? { ...chat, state: message.state } : chat)));
			heardState(message.id, message.state, hooks);
			return;
		}

		case "agent.row":
			heardRow(message);
			return;

		case "agent.model":
			ensureAgent(message.id);
			setState("agents", message.id, "model", message.model);
			return;

		case "agent.usage":
			ensureAgent(message.id);
			setState("agents", message.id, "usage", message.usage);
			return;

		// Your own queue for an agent, as the server holds it (`state/queued.ts`).
		case "agent.queued":
			receiveQueued(message);
			return;

		/*
		 * The usage panel's answer — and, when it carries `show`, the instruction to
		 * open it. That is `/cost`: the person asked in the composer, so the panel has
		 * to appear rather than wait for a reading nobody is looking at.
		 */
		case "agent.report": {
			if (message.show) setUsagePanel(message.id);
			// Kept for this agent whether or not its panel is still open — a panel closed
			// while a reading was in flight is exactly the case the next opening wants it
			// for, so `tookReport` files it and draws it only if it is still being read.
			tookReport(message.id, { ...(message.report ? { report: message.report } : {}), ...(message.error ? { error: message.error } : {}) });
			return;
		}

		case "agent.context":
			setState("contexts", message.agentId, message.boards);
			ensureAgent(message.agentId);
			setState("agents", message.agentId, "inPlay", message.inPlay);
			return;

		case "agent.prompt":
			ensureAgent(message.agentId);
			setState("agents", message.agentId, "dialog", message.prompt);
			// Drawn in the dock, above the input bar, so it needs nothing dragged
			// open to be seen.
			/*
			 * The other half of `ask`, and the half that actually fires today: no backend
			 * sets the `waiting` state yet, but every question an agent asks arrives here.
			 * Both routes are wired because the state is the one that will survive — see
			 * `agent-order.ts`, which has ringed `waiting` since before anything set it.
			 *
			 * It said `agent: state.focused`, which was a guess — right most of the time
			 * and silently wrong when a background agent asked. The frame carries the id
			 * now, so the banner names the agent that is actually waiting and clicking it
			 * switches to that conversation rather than to whichever was on screen.
			 */
			hooks.raise("ask", {
				title: `${nameOf(message.agentId)} is waiting for you`,
				body: "title" in message.prompt ? message.prompt.title : undefined,
				tag: `prompt:${message.prompt.id}`,
				agent: message.agentId,
			});
			return;

		case "agent.promptClosed":
			if (state.agents[message.agentId]) setState("agents", message.agentId, "dialog", (current) => (current?.id === message.id ? undefined : current));
			return;

		/*
		 * One agent moved — by hand, or because a limit moved it.
		 *
		 * Merged rather than waiting for the whole list to be republished: a rotation
		 * happens mid-turn, and the row saying which subscription is answering should
		 * change with the turn rather than on the next poll.
		 */
		case "agent.account":
			ensureAgent(message.id);
			setState("agents", message.id, "spending", message.account);
			accountChanged(message.id);
			return;
		default:
			return;
	}
}
