import type { AgentChat, Identity } from "@decks/protocol";
import { For, Show } from "solid-js";

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
	onNew: () => void;
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
				<span style={{ flex: 1 }} />
				<button type="button" title="Start another agent" onClick={() => props.onNew()}>
					+
				</button>
				<button
					class="pin"
					type="button"
					data-on={props.pinned}
					title={props.pinned ? "Let this panel hide again" : "Keep this panel open"}
					onClick={() => props.onPin(!props.pinned)}
				>
					{props.pinned ? "◉" : "○"}
				</button>
			</div>
			<div class="chat-rows">
				<For each={ordered()}>
					{(chat) => (
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
									<span class="when">{chat.lastAt ? when(chat.lastAt) : ""}</span>
								</span>
								<span class="bottom">
									<span class="last">
										<Show when={chat.parentId}>
											<span class="tag">↳ {props.chats.find((other) => other.id === chat.parentId)?.name ?? "parent"}</span>{" "}
										</Show>
										{chat.state === "idle" ? (chat.lastLine ?? "no messages yet") : working(chat.state)}
									</span>
									<Show when={props.unread[chat.id]}>
										{(count) => <span class="unread">{count() > 9 ? "9+" : count()}</span>}
									</Show>
								</span>
							</span>
						</button>
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
