import { m } from "@decks/i18n";
import { Icon } from "@decks/ui";
import type { ThinkingLevel } from "@decks/protocol";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import { Show } from "solid-js";
import { Dialog } from "../agents/Dialog.tsx";
import { Composer } from "../composer/Composer.tsx";
import { pageKey } from "../composer/parked.ts";
import { StatusPill } from "../shell/ChatSection.tsx";
import { removeComment, waitingComments } from "../state/comments.ts";
import { clearDialog, dialog, runtimeFor, state } from "../state/deck.ts";
import { queuedFor } from "../state/queued.ts";
import { call, warnIfFailed } from "../state/socket.ts";
import { draft, openUsage, panelOpen, setDraft, unread } from "../state/ui.ts";
import type { Parts } from "./parts.ts";
import { closeAgent, focusAgent, focusedCanvas, newAgent, openAgentsPanel } from "./person.ts";
import { destination, destinationLabel } from "./send-from-bar.ts";

/**
 * The dock: a question if one is waiting, the status row, and the input bar.
 *
 * One bottom-centred stack, because these are the same conversation and should
 * not be in three different places — and a stack rather than three offsets so
 * that a question appearing pushes the rest up instead of landing on it.
 *
 * The status row keeps its height whether or not it has anything to say, which
 * is the whole reason it is a row and not a chip that comes and goes: the box
 * you type into must not move between turns.
 */
export function DockBar(props: { parts: Parts }) {
	const { dock, underSheet, layout, focusedChat, busy, bar, pills, pickFile, files } = props.parts;
	const { phone, chatShown, chatOut, openChat } = layout;
	const { barText, setBarText, agentName, barContext, sendFromBar } = bar;
	const { titleOf, itemName, showPill } = pills;
	return (
			<div class="dock" ref={dock.watchDock} data-under={underSheet() ? "true" : undefined}>
				{/* Only drawn while the bar is put away behind the right edge (a hard throw
				    at it, `float.ts`): the one part of it left on screen, and the way back. */}
				<button type="button" class="stowtab" data-stowtab aria-label={m.app_stow_back()} title={m.app_stow_back()} onClick={() => dock.unstow()}>
					<Icon of={ChevronLeft} size={16} />
				</button>
				<Show when={dialog()}>
					{(prompt) => (
						<Dialog
							prompt={prompt()}
							onAnswer={(answer) => {
								void call("agent.answer", [{ id: prompt().id, ...answer }]);
								clearDialog();
							}}
						/>
					)}
				</Show>

				{/* Only while nothing else says it: the panel's folded foot does, while the panel is open, and the folded float does wherever it is. */}
				<Show when={!chatShown() && (phone() || (!panelOpen() && !chatOut()))}>
					<StatusPill chat={focusedChat()} identity={state.identities[state.focused ?? ""]} onOpen={openChat} />
				</Show>

				<Composer
					draft={draft()}
					agentId={state.focused}
					page={pageKey(state.focused, focusedCanvas())}
					usage={state.focused ? state.agents[state.focused!]?.usage : undefined}
					onUsage={() => openUsage(state.focused)}
					busy={busy()}
					model={state.focused ? state.agents[state.focused!]?.model : undefined}
					models={runtimeFor(focusedChat()?.kind)?.models ?? []}
					commands={focusedChat()?.commands ?? runtimeFor(focusedChat()?.kind)?.commands ?? []}
					runtime={focusedChat()?.kind}
					modes={runtimeFor(focusedChat()?.kind)?.capabilities?.modes ?? []}
					mode={focusedChat()?.mode}
					onMode={(mode) => void call("agent.set", [state.focused ?? "", { mode }]).then(warnIfFailed)}
					onSend={(text, comments, draft) => sendFromBar(text, comments, false, draft)}
					onQueue={(text, comments, draft) => sendFromBar(text, comments, true, draft)}
					{...(queuedFor(state.focused) ? { queued: queuedFor(state.focused)! } : {})}
					onQueueAction={(action, item) => {
						const id = state.focused;
						if (id) void call("chat.queue", [id, { action, ...(item ? { item } : {}) }]);
					}}
					comments={waitingComments(state.focused, focusedCanvas())}
					onCommentsGone={(ids) => {
						for (const id of ids) if (state.focused) removeComment(state.focused, focusedCanvas(), id);
					}}
					onText={setBarText}
					destination={destinationLabel(destination(barText(), barContext()))}
					recipient={{
						chats: state.chats,
						identities: state.identities,
						unread,
						focused: state.focused,
						dest: destination(barText(), barContext()),
						label: destinationLabel(destination(barText(), barContext())),
						onPick: focusAgent,
						onNew: (kind) => void newAgent({ ...(kind ? { kind } : {}) }),
						onClose: closeAgent,
						onMore: openAgentsPanel,
					}}
					mentionables={state.chats.map((chat) => ({ name: agentName(chat.id), chat }))}
					onAbort={() => void call("chat.abort", [state.focused ?? ""])}
					/*
					 * `thinking` comes back with the model now. Switching to a model that does
					 * not offer the level you were on keeps the nearest one it does, and that
					 * decision is made in the picker — so it has to travel with the choice, or
					 * the server would hear two messages and apply them in either order.
					 */
					onModel={(provider, model, thinking) =>
						void call("agent.set", [state.focused ?? "", { model: { provider, model, ...(thinking ? { thinking } : {}) } }]).then(warnIfFailed)
					}
					onThinking={(thinking: ThinkingLevel) =>
						void call("agent.set", [state.focused ?? "", { thinking }]).then(warnIfFailed)
					}
					/*
					 * Which subscription this conversation spends.
					 *
					 * Only for a chat whose runtime spends the install's Claude accounts
					 * (`capabilities.accounts`): the others have none, and a
					 * section offering to change one they do not have would be a control that
					 * does nothing. `agentId` is what makes the switch reach this agent alone —
					 * without it the server reads it as the default for the *next* one.
					 */
					{...(runtimeFor(focusedChat()?.kind)?.capabilities?.accounts && state.accounts.length > 1 ? { accounts: state.accounts } : {})}
					/* Falling back to the default, because that is what an agent with no entry in
					   the mapping is actually on — and a picker showing nothing selected reads
					   as "no subscription" rather than as "the list has not arrived". */
					account={(state.focused ? state.agents[state.focused]?.spending : undefined) ?? state.activeAccount}
					onAccount={(id: string) => void call("account.use", [id, state.focused ?? ""]).then(warnIfFailed)}
					onAccountsOpen={() => void call("account.list", [{ limits: true }])}
					/*
					 * The paperclip opens the same picker the inspector's embed row does, and
					 * what it hands back is a deck path — so what it inserts is a file pill, which the agent reads as an `@` mention
					 * of a file, which is the one thing in this app a message can point at.
					 */
					onAttach={() => {
						// Taken now: the picker can be open across a switch, and the mention is for
						// the conversation it was attached to. A deck path, not one relative to the
						// selected board — a message is not a board, and `@../assets/x.png` means
						// nothing to the agent reading it.
						const agentId = state.focused;
						void pickFile().then((path) => {
							if (path) setDraft({ text: "", files: [path], at: Date.now(), insert: true, ...(agentId ? { agentId } : {}) });
						});
					}}
					onDraftTaken={() => setDraft(undefined)}
					onDropFiles={(dropped) => void files.intoComposer(dropped)}
					titleOf={titleOf}
					itemName={itemName}
					onShowPill={showPill}
				/>
			</div>
	);
}
