import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import ChevronDown from "lucide-solid/icons/chevron-down";
import X from "lucide-solid/icons/x";
import CornerDownRight from "lucide-solid/icons/corner-down-right";
import Plus from "lucide-solid/icons/plus";
import { For, Show } from "solid-js";
import { Icon } from "../icons.tsx";

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
	pinned: boolean;
	onPin: (pinned: boolean) => void;
}) {
	/** Parents first, each followed by its children — the order people expect. */
	const ordered = () => {
		const roots = props.chats.filter((chat) => !chat.parentId);
		const childrenOf = (id: string) => props.chats.filter((chat) => chat.parentId === id);
		return roots.flatMap((root) => [root, ...childrenOf(root.id)]);
	};

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
						<span class="value">{props.defaultKind}</span>
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
					<button
						class="pin"
						type="button"
						data-on={props.pinned}
						title={props.pinned ? "Let this panel hide again" : "Keep this panel open"}
						aria-label={props.pinned ? "Let this panel hide again" : "Keep this panel open"}
						onClick={() => props.onPin(!props.pinned)}
					>
						{/* The dot, not a pin glyph: filled is pinned, hollow is not. A pin icon
						    needs a second icon or a colour to say which state it is in; a filled
						    circle beside a hollow one is the state, at 12px and in one character. */}
						{props.pinned ? "◉" : "○"}
					</button>
				</span>
			</div>
			<div class="chat-rows">
				<For each={ordered()}>
					{(chat) => (
						<div class="chat-row-wrap">
							<button
								type="button"
								class="chat-row"
								data-current={props.focused === chat.id}
								data-child={Boolean(chat.parentId)}
								onClick={() => props.onFocus(chat.id)}
							>
								<Avatar chat={chat} identity={props.identities[chat.id]} />
								<span class="who">
									<span class="top">
										<span class="name">{props.identities[chat.id]?.name ?? chat.name}</span>
										{/*
										 * The runtime and the time are one group at the right edge. Left
										 * as three children of a `space-between` row, the badge had a gap
										 * on both sides and read as dangling after the name.
										 */}
										<span class="meta">
											<span class="runtime" data-kind={chat.kind} title={`Running on ${chat.kind}`}>
												{chat.kind}
											</span>
											<span class="when">{chat.lastAt ? when(chat.lastAt) : ""}</span>
										</span>
									</span>
									<span class="bottom">
										<span class="last">
											<Show when={chat.parentId}>
												<span class="tag">
													<Icon of={CornerDownRight} size={11} />
													{props.chats.find((other) => other.id === chat.parentId)?.name ?? "parent"}
												</span>{" "}
											</Show>
											{chat.state === "idle" ? (chat.lastLine ?? "no messages yet") : working(chat.state)}
										</span>
										<Show when={props.unread[chat.id]}>
											{(count) => <span class="unread">{count() > 9 ? "9+" : count()}</span>}
										</Show>
									</span>
								</span>
							</button>

							{/*
							 * A sibling of the row's button rather than a child of it — a button
							 * inside a button is invalid — but inside the wrapper, which is the box
							 * that draws the row and its highlight, so it reads as part of the row
							 * rather than something floating in the gutter beside it.
							 *
							 * The chat closes; the conversation does not. Its transcript is a session
							 * file on disk, which is why this needs no confirmation — and why the
							 * label says "close" rather than "delete".
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
					)}
				</For>
			</div>
		</section>
	);
}

function Avatar(props: { chat: AgentChat; identity: Identity | undefined }) {
	const colour = () => props.identity?.color ?? "var(--color-accent)";
	const avatar = () => props.identity?.avatar;
	return (
		<span class="avatar" data-state={props.chat.state} style={{ background: avatar() ? "transparent" : colour(), "--dot": colour() }}>
			<Show when={avatar()} fallback={(props.identity?.name ?? props.chat.name).slice(0, 1).toUpperCase()}>
				{(src) => <img src={src()} alt="" />}
			</Show>
		</span>
	);
}

/** "thinking", not "streaming": what the state means to someone watching. */
function working(state: AgentChat["state"]): string {
	switch (state) {
		case "tool":
			return "working…";
		case "waiting":
			return "waiting for you";
		default:
			return "thinking…";
	}
}

function when(at: number): string {
	const seconds = Math.max(0, (Date.now() - at) / 1000);
	if (seconds < 60) return "now";
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
