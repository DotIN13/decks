import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import Check from "lucide-solid/icons/check";
import X from "lucide-solid/icons/x";
import CornerDownRight from "lucide-solid/icons/corner-down-right";
import Plus from "lucide-solid/icons/plus";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
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

	/**
	 * Whether the `+` is showing its two runtimes.
	 *
	 * Closed on a press anywhere else, because a menu that needs its own button pressed
	 * again to go away is a menu you have to remember you opened.
	 */
	const [picking, setPicking] = createSignal(false);
	onMount(() => {
		const away = (event: PointerEvent) => {
			if (!(event.target as HTMLElement | null)?.closest?.(".chats .new")) setPicking(false);
		};
		document.addEventListener("pointerdown", away);
		onCleanup(() => document.removeEventListener("pointerdown", away));
	});

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
				{/*
					One control, not two.
					
					There used to be a `+` beside a runtime chip, which is two controls for one
					decision: the `+` made an agent on the default runtime and the chip made one on
					whichever you picked, so the chip was a `+` that also chose and the `+` was a
					chip that could not. Two buttons, one of them a worse version of the other.

					So the `+` opens the choice. The runtime has to be picked before the agent
					exists — a live session cannot swap the process behind it, and pretending
					otherwise would silently start a new conversation — which makes "new agent" and
					"which runtime" the same question, asked once.
				*/}
				<span class="tools">
					<span class="new">
						<button
							type="button"
							aria-haspopup="menu"
							aria-expanded={picking()}
							data-open={picking()}
							title="Start another agent"
							aria-label="Start another agent"
							onClick={() => setPicking((was) => !was)}
						>
							<Icon of={Plus} size={16} />
						</button>

						<Show when={picking()}>
							{/*
								Below the button and to its right edge, in a panel of its own: the header
								is 200px wide and the menu is not, so anchoring it to the `+` keeps it
								from hanging off the panel on one side or the other.
							*/}
							{/*
								`menu` is not decoration: the header's own `+` is styled by
								`.chats .rail-head button`, a descendant selector that cannot tell a
								control from a control's contents, so the stylesheet excludes anything
								inside this — see the note there.
							*/}
							<div
								class="menu absolute top-[calc(100%+4px)] right-0 z-[12] flex w-max min-w-[136px] flex-col gap-0.5 rounded-panel border border-line bg-panel p-1 shadow-panel"
								role="menu"
								ref={(element) => queueMicrotask(() => element.querySelector("button")?.focus())}
								onKeyDown={(event) => {
									if (event.key === "Escape") setPicking(false);
								}}
							>
								<For each={["pi", "claude"] as AgentKind[]}>
									{(kind) => (
										<button
											// `w-full`: the highlight is the row, so the row is what the press
											// lands on — a button sized to its text is a menu you have to aim at.
											class="flex w-full cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2 py-1.5 text-left text-[12px] text-fg hover:bg-line"
											type="button"
											role="menuitem"
											onClick={() => {
												setPicking(false);
												props.onNew(kind);
											}}
										>
											{/* `flex-none`: an `<svg>` in a flex row will shrink to nothing beside a
											    `flex-1` label, and did — 0×13, a mark with a height and no width. */}
											<AgentMark class="flex-none" agent={kind} size={13} />
											<span class="flex-1">{kind}</span>
											{/* Which one the `+` would have made on its own, before it asked. */}
											<Show when={kind === props.defaultKind}>
												<Icon of={Check} class="text-faint" size={13} />
											</Show>
										</button>
									)}
								</For>
							</div>
						</Show>
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


