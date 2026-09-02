import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import X from "lucide-solid/icons/x";
import CornerDownRight from "lucide-solid/icons/corner-down-right";
import Plus from "lucide-solid/icons/plus";
import { For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { AgentFace, AgentMark, agentState } from "./agent-marks.tsx";

/**
 * The agents, as a messaging app's conversation list.
 *
 * That framing is the design, not a skin: an agent here has a name it chose, a face
 * it drew, a last line, and an unread count, because those are the four things that
 * let you tell six of them apart at a glance. A subagent is a row too — it is a
 * conversation, and hiding it inside its parent's would mean the one place its
 * transcript exists is a place you cannot open.
 */
export function ChatList(props: {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onRemove: (id: string) => void;
	/** `kind` is the runtime, chosen here because it cannot change later. */
	onNew: (kind?: AgentKind) => void;
	/** What the server hands a new agent unless told otherwise. */
	defaultKind: AgentKind;
}) {
	/** Parents first, each followed by its children — the order people expect. */
	const ordered = () => {
		const roots = props.chats.filter((chat) => !chat.parentId);
		const childrenOf = (id: string) => props.chats.filter((chat) => chat.parentId === id);
		return roots.flatMap((root) => [root, ...childrenOf(root.id)]);
	};

	/** The first chat restored from a previous run, which is where the divider goes. */
	const firstDormant = () => ordered().find((chat) => chat.dormant)?.id;

	return (
		<section class="chats">
			<div class="rail-head">
				<span>agents</span>
				{/*
				 * A group, not a spacer. The spacer here was `flex: 1` on a header that is
				 * not a flex row — `.rail .rail-head` styles the *boards* rail, and `.chats`
				 * is its sibling rather than its child — so it measured zero and all three
				 * controls piled up against the label.
				 */}
				<span class="tools">
					<button
						type="button"
						title="Start another agent"
						aria-label="Start another agent"
						onClick={() => props.onNew()}
					>
						<Icon of={Plus} size={16} />
					</button>
					{/*
					 * The runtime is picked before the agent exists because it cannot be
					 * changed afterwards: a live session cannot swap the process behind it,
					 * and pretending otherwise would silently start a new conversation.
					 */}
					{/*
					 * The label is drawn, and the native select laid transparently over it.
					 *
					 * A `<select>` sizes itself to its *widest* option, so showing "pi" while
					 * "claude" exists left a gap between the value and the chevron — the same
					 * dangling look the row badge had. Drawing the label means the chip is the
					 * width of what it says, and the chevron is the app's own icon rather than
					 * whatever the platform draws.
					 */}
					<span class="kind" data-kind={props.defaultKind}>
						<AgentMark agent={props.defaultKind} size={13} />
						<Icon of={ChevronDown} size={12} />
						<select
							title="Which runtime a new agent starts on"
							aria-label="Which runtime a new agent starts on"
							onChange={(event) => {
								const kind = event.currentTarget.value as AgentKind;
								props.onNew(kind);
								// Left showing the default rather than the last choice: this is a
								// button that happens to have options, not a setting.
								event.currentTarget.value = props.defaultKind;
							}}
						>
							<For each={["pi", "claude"] as AgentKind[]}>
								{(kind) => (
									<option value={kind} selected={kind === props.defaultKind}>
										new {kind} agent
									</option>
								)}
							</For>
						</select>
					</span>
				</span>
			</div>
			<div class="chat-rows">
				<For each={ordered()}>
					{(chat) => (
						<>
							{/*
							 * Where the chats from previous runs begin.
							 *
							 * A sibling of the row rather than a child of it: `.chat-row-wrap` is the
							 * box that draws the row's highlight, so a divider inside one would be
							 * highlighted along with it on hover.
							 *
							 * Drawn before the first dormant row rather than around all of them, so it
							 * costs one element and cannot disagree with the ordering — the server
							 * restores oldest-first and `ordered()` keeps that order, so every dormant
							 * row follows every live one.
							 */}
							<Show when={chat.id === firstDormant()}>
								<span class="earlier">earlier</span>
							</Show>
							<div class="chat-row-wrap" data-dormant={chat.dormant === true}>
								<button
									type="button"
									class="chat-row"
									data-current={props.focused === chat.id}
									data-child={Boolean(chat.parentId)}
									onClick={() => props.onFocus(chat.id)}
								>
									<AgentFace chat={chat} identity={props.identities[chat.id]} unread={props.unread[chat.id] ?? 0} />
									<span class="who">
										<span class="top">
											{/*
											 * The mark leads the row. Which runtime an agent is on cannot
											 * change, so it belongs with the name rather than out at the
											 * right with the things that do change.
											 */}
											<span class="runtime" data-kind={chat.kind} title={chat.dormant ? `On ${chat.kind} — not resumed yet` : `Running on ${chat.kind}`}>
												<AgentMark agent={chat.kind} size={13} />
											</span>
											<span class="name">{props.identities[chat.id]?.name ?? chat.name}</span>
										</span>
										<span class="bottom">
											<span class="last">
												<Show when={chat.parentId}>
													<span class="tag">
														<Icon of={CornerDownRight} size={11} />
														{props.chats.find((other) => other.id === chat.parentId)?.name ?? "parent"}
													</span>{" "}
												</Show>
												{chat.state === "idle" ? (chat.lastLine ?? (chat.dormant ? "not resumed yet" : "no messages yet")) : agentState(chat.state)}
											</span>
										</span>
									</span>
								</button>

								{/*
								 * A sibling of the row's button rather than a child of it — a button
								 * inside a button is invalid — but inside the wrapper, which is the box
								 * that draws the row and its highlight, so it reads as part of the row
								 * rather than something floating in the gutter beside it.
								 *
								 * The chat closes; the conversation does not. The runtime's own transcript
								 * stays where it is — pi's and Claude's session directories are theirs, and
								 * this does not touch them — which is why the label says "close" rather
								 * than "delete".
								 *
								 * It does now drop the row from the deck's list for good, so it will not be
								 * back after a restart the way it would have been before agents were
								 * persisted. Still unconfirmed: a chat is cheap to start again, and a
								 * confirm on every close is the kind of friction that makes people keep
								 * rows they do not want.
								 */}
								<button
									class="close"
									type="button"
									title={`Close this chat with ${props.identities[chat.id]?.name ?? chat.name}`}
									aria-label={`Close this chat with ${props.identities[chat.id]?.name ?? chat.name}`}
									onClick={(event) => {
										// Without this the row underneath takes the focus on the way past.
										event.stopPropagation();
										props.onRemove(chat.id);
									}}
								>
									<Icon of={X} size={13} />
								</button>
							</div>
						</>
					)}
				</For>
			</div>
		</section>
	);
}


