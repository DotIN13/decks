import type { AgentState, ServerMessage } from "@decks/protocol";
import { reconcile } from "solid-js/store";
import { prepend } from "../chat/history-page.ts";
import { receiveToolResult } from "../chat/tool-results.ts";
import { viewToPark } from "../camera/agent-view.ts";
import { agentViews } from "../camera/agent-views.ts";
import { runStageCall } from "../canvas/stage-ops.ts";
import { DONE_LINGER_MS } from "../canvas/acts.ts";
import { scratch } from "../state/agent.ts";
import { moveCamera } from "../state/camera.ts";
import { reportCamera } from "./camera-report.ts";
import { ensureAgent, nameOf, setState, state } from "../state/deck.ts";
import { ensureHistory, resolveEarlier } from "../state/history.ts";
import { boardChanged, forgetInFlight, forgetPatches, patchAccepted, patchRefused } from "../state/patches.ts";
import { notice } from "../state/notices.ts";
import { setTimeZone } from "../lib/time.ts";
import { setComponent, setMarks, setSelected } from "../state/selection.ts";
import { send } from "../state/socket.ts";
import { finished, startedAsking } from "../alerts/policy.ts";
import { historyShown } from "../state/edge.ts";
import { releaseBoards, setDraft, setUnread, setUsagePanel, tookReport } from "../state/ui.ts";
import { watchedBeingNamed } from "./watching.ts";
import { forgetPen, receivePen } from "../state/pens.ts";

/** What the frame handler needs from the component it used to live in. */
export interface FrameHooks {
	/** A board asked for by a drop heard its path. */
	hearBoard(request: string, path: string): void;
	/**
	 * The deck has arrived for the conversation we just switched to.
	 *
	 * The other half of a switch, because *where the boards are* is half of what decides where to
	 * look: a view is restored only if it still shows one of the boards it was left on, and that
	 * question cannot be asked of the conversation being left.
	 */
	landed(): void;
	setAtTurn(at: { id: string; at: number } | undefined): void;
	raise(kind: "done" | "ask" | "problem", banner: { title: string; body?: string; tag?: string; agent?: string }): void;
}

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

/**
 * What happens when a frame arrives.
 *
 * Four hundred lines that used to be the body of one `onMount` in `App.tsx`, between the
 * socket's setup and the memos below it. It is the app's whole inbound surface: every
 * `ServerMessage` the protocol can send is answered here, and several are answered to
 * nobody (`default: return`) because the switch is a statement about what the app knows.
 *
 * The context is explicit and small: what the handler needs from the component is the
 * things it *writes*, plus the two readers it needs to answer a question. Everything else
 * it touches is a module it imports — the store, the notices, the selection — which is the
 * point of the state split: a frame changes the app's state, not the component's.
 */
export function handleFrame(message: ServerMessage, hooks: FrameHooks): void {
	switch (message.type) {
				case "runtimes":
					// A property of the machine rather than of the deck, so it travels beside
					// the greeting instead of inside it.
					setState("runtimes", message.list);
					return;
				case "deck.state":
					setState("deck", message.deck);
					/*
					 * The greeting is a refresh (§5), so nothing is in flight any more. Said
					 * out loud because the patch queue depends on it: an edit made while a
					 * patch is unacknowledged waits for that acknowledgement, and one lost to
					 * a dropped socket would otherwise leave every later edit to that board
					 * waiting for a message that is never coming.
					 */
					forgetInFlight();
					/*
					 * Reconciled by path, not replaced.
					 *
					 * A board row owns a live iframe, and Solid re-creates a row whose item
					 * is a new object — so assigning a fresh array reloaded every board on
					 * screen. That is what "moving a board refreshes the page" was: a drag
					 * writes deck.json, the watcher reports it, and the whole deck arrived
					 * as new objects. `reconcile` keyed on the path updates the boards that
					 * changed and leaves the rest — and their documents — alone.
					 */
					setState("boards", reconcile(message.deck.boards, { key: "path", merge: false }));
					hooks.landed();
					return;
				case "board.patched": {
					if (message.refused) {
						notice("warn", message.refused);
						/*
						 * Its optimistic DOM is now a lie: unpin and reload from the file. What
						 * was queued behind it was composed against that same lie, so the queue
						 * goes too (`state/patches.ts`) — one warning, not one per held-back
						 * click.
						 */
						patchRefused(message.path);
						/*
						 * And the selection, which may name a component that was never renamed or
						 * a copy that was never made. The frame is about to reload with the
						 * file's own answer; a selection composed against the refused version of
						 * it would leave the inspector describing something that does not exist.
						 */
						setComponent(undefined);
						setState("nonces", message.path, (current = 0) => current + 1);
						return;
					}
					// Accepted: our revision is remembered, and whatever was waiting behind it
					// goes now, against the rev this message carries.
					patchAccepted(message.path, message.rev);
					return;
				}

				case "board.changed": {
					if (message.removed) {
						forgetPatches(message.path);
						setState("boards", (boards) => boards.filter((board) => board.path !== message.path));
						return;
					}
					if (!message.board) return;
					const board = message.board;
					/*
					 * An agent named this board while its own stage was the one on screen: it was watched
					 * being written, so it is not news. Reading it is how the browser says so, and the read
					 * stamp is the server's, so the mark clears on every device signed in.
					 */
					if (watchedBeingNamed(board, { focused: state.focused })) {
						send({ type: "board.seen", path: board.path });
					}
					/*
					 * Whose write it was, which decides whether the frame may reload: our own
					 * (already on screen), the echo that overtook our acknowledgement, or
					 * somebody else's — the agent, another tab, an editor (`state/patches.ts`).
					 */
					boardChanged(board.path, board.rev);
					// Merged into the existing row so its frame survives; only a board that
					// is genuinely new grows the array.
					//
					// `reconcile` with `merge` rather than a plain assignment: `Stage` renders
					// the boards with `<For>`, which keys by reference, so replacing the object
					// at this index makes the row new — and re-creating a row re-creates its
					// iframe, which reloads the document. That is a full white-flash reload of
					// the board the user is editing, on every component drag, showing the very
					// bytes the live DOM already has. Merging leaves the identity alone and
					// updates only the fields that moved.
					const index = state.boards.findIndex((existing) => existing.path === board.path);
					if (index === -1) {
						setState("boards", (boards) => [...boards, board].sort((a, b) => a.path.localeCompare(b.path)));
					} else {
						setState("boards", index, reconcile(board, { merge: true }));
					}
					return;
				}
				case "agents": {
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
					if (!focused) releaseBoards();
					return;
				}

				case "agent.removed": {
					/*
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
					scratch.forget(message.id);
					setState("agents", message.id, undefined);
					setState("acts", message.id, undefined);
					setState("identities", message.id, undefined as never);
					setState("contexts", message.id, undefined as never);
					forgetPen(message.id);
					setUnread(message.id, 0);
					return;
				}

				/*
				 * Replaced, not merged. A store setter merges an object into what is there, and the
				 * server leaves an empty field out: removing the last tag, or taking an agent out
				 * of its workspace, sent an identity without that key and the old value stayed.
				 */
				case "agent.identity":
					setState("identities", message.id, reconcile(message.identity));
					return;

				/*
				 * An agent acting on a board: kept as the latest act per agent, which is what the
				 * frame draws a cursor and marks from. A finished act stays for a moment so the
				 * landing can be seen, then goes — unless a newer act has replaced it by then.
				 */
				case "agent.act":
					setState("acts", message.agentId, message);
					if (message.phase === "done") {
						setTimeout(() => {
							if (state.acts[message.agentId]?.at === message.at) setState("acts", message.agentId, undefined);
						}, DONE_LINGER_MS);
					}
					return;

				case "agent.state": {
					setState("chats", (chats) => chats.map((chat) => (chat.id === message.id ? { ...chat, state: message.state } : chat)));
					heardState(message.id, message.state, hooks);
					return;
				}

				/*
				 * The four fields of a row that no other message carries, restated in full.
				 *
				 * Assigned rather than merged, because the message is a complete statement of
				 * those four: a chat that was dormant and is now running says so by not saying
				 * `dormant`, and a merge would leave it asleep for ever. Everything else on the
				 * row is left exactly as it was — this is not a row, it is the part of one that
				 * moves when a turn starts and ends.
				 */
				case "agent.row":
					setState("chats", (chats) =>
						chats.map((chat) => {
							if (chat.id !== message.id) return chat;
							const { lastLine: _line, lastAt: _at, mode: _mode, dormant: _dormant, ...rest } = chat;
							return {
								...rest,
								...(message.lastLine === undefined ? {} : { lastLine: message.lastLine }),
								...(message.lastAt === undefined ? {} : { lastAt: message.lastAt }),
								...(message.mode ? { mode: message.mode } : {}),
								...(message.dormant ? { dormant: true as const } : {}),
							};
						}),
					);
					return;

				case "agent.model":
					ensureAgent(message.id);
					setState("agents", message.id, "model", message.model);
					return;

				case "agent.usage":
					ensureAgent(message.id);
					setState("agents", message.id, "usage", message.usage);
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

				case "chat.history":
					ensureAgent(message.agentId);
					setState("agents", message.agentId, "transcript", message.items);
					setState("agents", message.agentId, "moreHistory", message.more ?? false);
					scratch.of(message.agentId).historyHeld = true;
					if (message.agentId === state.focused) releaseBoards();
					scratch.of(message.agentId).historyAsked = false;
					return;

				case "chat.tool":
					receiveToolResult(message.itemId, message.result);
					return;

				case "chat.earlier": {
					/*
					 * A page of scrollback, folded in at the front.
					 *
					 * `prepend` drops anything already held, which is not a hypothetical: a
					 * reader who keeps scrolling asks for a second page before the first has
					 * landed, and a rewind re-sends a window that can overlap a page already
					 * fetched. The held copy wins — it is the one a delta may be arriving into.
					 */
					ensureAgent(message.agentId);
					setState("agents", message.agentId, "transcript", (held) => prepend(message.items, held));
					setState("agents", message.agentId, "moreHistory", message.more);
					// Whoever asked is waiting on the count, so it can hold the reader's place.
					resolveEarlier(message.before, message.items.length);
					return;
				}

				case "chat.item": {
					const item = message.item;
					/*
					 * A reply you cannot see is the thing an unread count is for — whether
					 * that is because you are in another conversation or because the panel
					 * is away. Your own messages are not news.
					 */
					const unseen = message.agentId !== state.focused || !historyShown();
					if (unseen && item.kind === "assistant") setUnread(message.agentId, (count = 0) => count + 1);
					ensureAgent(message.agentId);
					setState("agents", message.agentId, "transcript", (items) => {
						const index = items.findIndex((existing) => existing.id === item.id);
						if (index === -1) return [...items, item];
						const next = [...items];
						next[index] = item;
						return next;
					});
					return;
				}

				case "chat.delta": {
					// Deltas are applied to the item in place: the server sends the whole
					// item at the start and the end, and the increments in between.
					ensureAgent(message.agentId);
					setState("agents", message.agentId, "transcript", (items) =>
						items.map((item) => {
							if (item.id !== message.itemId || item.kind !== "assistant") return item;
							return message.field === "thinking"
								? { ...item, thinking: (item.thinking ?? "") + message.delta }
								: { ...item, text: item.text + message.delta };
						}),
					);
					return;
				}

				case "timeline.preview":
					ensureAgent(message.agentId);
					setState("agents", message.agentId, "preview", message.entryId ? { entryId: message.entryId, boards: message.boards } : undefined);
					return;

				case "stage.pen":
					receivePen(message);
					if (message.error) notice("warn", message.error);
					return;

				case "context.changed":
					setState("contexts", message.agentId, message.boards);
					ensureAgent(message.agentId);
					setState("agents", message.agentId, "inPlay", message.inPlay);
					return;

				case "stage.call": {
					/*
					 * An agent asking something of the canvas. It is answered, always —
					 * the server is holding a tool call open on it, and a refusal it can
					 * read beats a timeout it cannot.
					 */
					let value: unknown;
					try {
						value = runStageCall(message.call, {
							boards: () => state.boards,
							viewport: () => {
								const stage = document.querySelector(".stage");
								return { width: stage?.clientWidth ?? 0, height: stage?.clientHeight ?? 0 };
							},
							/*
							 * Whose canvas this is. An op that moves the view is carried out for the
							 * conversation on screen and remembered for one that is not — see `defer`
							 * in `canvas/stage-ops.ts`, which is where the reasoning lives.
							 */
							focused: () => state.focused,
							setCamera: (next, options) => moveCamera(next, options),
							rememberView: (agentId, camera, selected) => {
								// On this device, like every other view (`camera/agent-views.ts`): an
								// agent that moved a canvas nobody is looking at is remembered for the
								// browser that was told, which is the same scope as the ones parked on
								// a switch.
								agentViews(state.deck?.path ?? "").keep(agentId, viewToPark(camera, selected));
								// So `stage.camera()` answers for that agent's stage rather than falling
								// back to wherever the last person to look at anything was.
								reportCamera(camera, agentId);
							},
							select: (path) => setSelected(path),
							reload: (path) => setState("nonces", path, (current = 0) => current + 1),
							cursor: (cursor) => setState("cursor", cursor),
							/* Replace one agent's marks on one board, leaving every other agent's alone. */
							annotate: (agentId, path, next) =>
								setMarks((was) => [...was.filter((mark) => mark.agentId !== agentId || mark.path !== path), ...next]),
						});
					} catch (error) {
						value = { error: error instanceof Error ? error.message : String(error) };
					}
					send({ type: "stage.result", result: { id: message.call.id, value } });
					return;
				}

				case "extension.ui.prompt":
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

				case "extension.ui.prompt.closed":
					if (state.agents[message.agentId]) setState("agents", message.agentId, "dialog", (current) => (current?.id === message.id ? undefined : current));
					return;

				case "notice":
					notice(message.level, message.text);
					// Only `error`. A warning is a thing worth reading when you get to it, and an
					// app that makes a noise for every one of those is an app people mute.
					if (message.level === "error") hooks.raise("problem", { title: "Something went wrong", body: message.text, tag: "problem" });
					return;

				case "composer.draft":
					// A rewound message, for the conversation that was rewound — the one on screen.
					setDraft({ text: message.text, at: Date.now(), ...(state.focused ? { agentId: state.focused } : {}) });
					return;

				case "board.created":
					hooks.hearBoard(message.request, message.path);
					return;

				case "claude.accounts": {
					setState({ accounts: message.accounts, activeAccount: message.active });
					/*
					 * Which subscription each agent spends arrives as one map and is scattered onto
					 * the agents' own records, where the rest of what is known about them lives.
					 */
					for (const [id, account] of Object.entries(message.spending ?? {})) {
						ensureAgent(id);
						setState("agents", id, "spending", account);
					}
					return;
				}

				/*
				 * The shared Chrome. The code rides only on the greeting's copy, so a later
				 * status keeps the code the greeting brought rather than dropping it.
				 */
				case "settings":
					// The zone first, so everything the store change redraws is drawn in it.
					setTimeZone(message.settings.timezone);
					setState("settings", reconcile(message.settings));
					setState("machineZone", message.machineZone);
					return;
				case "web.status":
					setState("web", { status: message.status, code: message.code ?? state.web?.code });
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
					return;
				case "error":
					notice("error", message.text);
					hooks.raise("problem", { title: "Something went wrong", body: message.text, tag: "problem" });
					return;
				default:
					return;
			}
}
