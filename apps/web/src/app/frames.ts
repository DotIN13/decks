import type { BoardPatch, Camera, ServerMessage } from "@decks/protocol";
import { reconcile } from "solid-js/store";
import { PAGE, prepend } from "../chat/history-page.ts";
import { receiveToolResult } from "../chat/tool-results.ts";
import { viewToPark } from "../camera/agent-view.ts";
import { runStageCall } from "../canvas/stage-ops.ts";
import { scratch } from "../state/agent.ts";
import { setCamera } from "../state/camera.ts";
import { reportCamera } from "./camera-report.ts";
import { ensureAgent, nameOf, setState, state } from "../state/deck.ts";
import { ensureHistory, resolveEarlier } from "../state/history.ts";
import { boardChanged, forgetInFlight, forgetPatches, patchAccepted, patchRefused } from "../state/patches.ts";
import { notice } from "../state/notices.ts";
import { setComponent, setMarks, setSelected } from "../state/selection.ts";
import { send } from "../state/socket.ts";
import { finished, startedAsking } from "../lib/alerts.ts";
import { historyShown } from "../state/edge.ts";
import { releaseBoards, setDraft, setUnread, setUsagePanel, setUsageReport, usagePanel } from "../state/ui.ts";

/** What the frame handler needs from the component it used to live in. */
export interface FrameHooks {
	/** A board asked for by a drop heard its path. */
	hearBoard(request: string, path: string): void;
	setAtTurn(at: { id: string; at: number } | undefined): void;
	raise(kind: "done" | "ask" | "problem", banner: { title: string; body?: string; tag?: string; agent?: string }): void;
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
					setState("identities", message.id, undefined as never);
					setState("contexts", message.id, undefined as never);
					setUnread(message.id, 0);
					return;
				}

				case "agent.identity":
					setState("identities", message.id, message.identity);
					return;

				case "agent.state": {
					const mine = scratch.of(message.id);
					const was = mine.lastState;
					mine.lastState = message.state;
					setState("chats", (chats) => chats.map((chat) => (chat.id === message.id ? { ...chat, state: message.state } : chat)));
					/*
					 * The moment a face turns green (`chrome/agent-order.ts`), said out loud.
					 *
					 * Keyed on the *transition* rather than the value, so a reconnection — which
					 * replays the state of every agent on the deck — does not ring five times.
					 */
					if (finished(was, message.state)) {
						hooks.raise("done", {
							title: `${nameOf(message.id)} finished`,
							// The deck's name, so a banner from one of three windows says which one.
							body: state.deck?.name,
							tag: `done:${message.id}`,
							agent: message.id,
						});
					} else if (startedAsking(was, message.state)) {
						hooks.raise("ask", { title: `${nameOf(message.id)} is waiting for you`, tag: `ask:${message.id}`, agent: message.id });
					}
					return;
				}

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
					// A reading for an agent whose panel is not open is a reading for a panel that
					// was closed while it was in flight.
					if (usagePanel() !== message.id) return;
					setUsageReport({ loading: false, ...(message.report ? { report: message.report } : {}), ...(message.error ? { error: message.error } : {}) });
					return;
				}

				case "models":
					// One list per agent: the runtime each agent runs on answers its own, and
					// a global list would show the last agent to start on everyone — a row
					// for Claude listing the models of a pi agent that started after it.
					ensureAgent(message.agentId);
					setState("agents", message.agentId, "models", message.models);
					return;

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
							setCamera: (next) => setCamera(next),
							rememberView: (agentId, camera, selected) => {
								scratch.of(agentId).view = viewToPark(camera, selected);
								// So `stage.camera()` answers for that agent's canvas rather than falling
								// back to wherever the last person to look at anything was.
								reportCamera(camera, agentId);
							},
							select: (path) => setSelected(path),
							reload: (path) => setState("nonces", path, (current = 0) => current + 1),
							cursor: (cursor) => setState("cursor", cursor),
							/* Replace one agent's marks on one board, leaving every other agent's alone. */
							annotate: (agentId, path, next) =>
								setMarks((was) => [...was.filter((mark) => mark.agentId !== agentId || mark.path !== path), ...next]),
							toast: (text) => notice("info", text),
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
