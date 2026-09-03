import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import { createSignal, For, Show } from "solid-js";
import { AgentHoverCard } from "./AgentHoverCard.tsx";
import { AgentFace, AgentMenu } from "./AgentPill.tsx";
import { agentOrder, agentStatus, stackFaces, statusWords } from "./agent-order.ts";

/**
 * The faces in the top-right corner — and only the ones doing something.
 *
 * `agentOrder` is the policy and `agent-order.ts` argues for it; this is the drawing. Two
 * things it is worth restating here, because they are what makes this more than decoration:
 *
 * **Active only.** Figma's stack shows who is *present*, which on a canvas nobody else is
 * looking at is presence theatre. This shows who is *doing something* — a fact you cannot
 * get any other way today, since the only way to learn that a reviewer is waiting for you
 * is to open a panel and read it. And because working goes green, green goes away when you
 * look, and nothing else can put a face here, **the corner empties itself.** A sign that
 * only clears by being dealt with is a sign you can trust; a badge that needs a "mark all
 * read" is not.
 *
 * **A switcher, not an audience.** Clicking a face is `onFocus`, the same swap the dropdown
 * does — it moves the canvas, the camera, the panel and the transcript together. Which is
 * why this is consistent with one agent at a time: there is still no observe mode, no ring
 * round the window and no second camera. Switching *is* following.
 *
 * There is no unread badge. It said "something happened here", which is exactly what green
 * says, and two marks on a 24px circle for one fact is how a corner turns into a dashboard.
 */
export { agentOrder } from "./agent-order.ts";

export function AgentStack(props: {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	/** The `+n` chip opens the pill's dropdown, and that list ends in "New agent". */
	onNew: (kind?: AgentKind) => void;
	defaultKind: AgentKind;
}) {
	const ordered = () => agentOrder(props.chats, props.unread, props.focused);
	const split = () => stackFaces(ordered());

	/** Which face the pointer (or the keyboard) is on, and where it is on screen. */
	const [over, setOver] = createSignal<{ id: string; at: DOMRect } | undefined>();
	const hovered = () => props.chats.find((chat) => chat.id === over()?.id);

	const enter = (id: string, event: { currentTarget: Element }) => setOver({ id, at: event.currentTarget.getBoundingClientRect() });
	const leave = (id: string) => setOver((was) => (was?.id === id ? undefined : was));

	return (
		<Show when={ordered().length > 0}>
			{/*
			 * `aria-label` on the group rather than a heading: this is a list of switches in a
			 * strip of chrome, and the one thing a screen reader needs before it reads three
			 * buttons is what they are three of.
			 */}
			<span class="agent-stack" role="group" aria-label="Agents wanting your attention">
				<For each={split().shown}>
					{(chat) => {
						const status = () => agentStatus(chat.state, props.unread[chat.id] ?? 0);
						const name = () => props.identities[chat.id]?.name ?? chat.name;
						return (
							<button
								type="button"
								class="agent-facebtn"
								/* The words as well as the name: the ring is a colour, and a colour is
								   not a thing a screen reader can read out. */
								aria-label={`Switch to ${name()} — ${statusWords(status(), chat.state)}`}
								title={name()}
								onPointerEnter={(event) => enter(chat.id, event)}
								onPointerLeave={() => leave(chat.id)}
								/* Focus is hover's keyboard equivalent, so it summons the same card —
								   otherwise the one thing the card is for, deciding whether to switch,
								   would be mouse-only. */
								onFocus={(event) => enter(chat.id, event)}
								onBlur={() => leave(chat.id)}
								onClick={() => {
									// Switching to a green one is also what marks it read, so the face is
									// about to leave; a card still hanging under where it used to be
									// would be pointing at nothing.
									setOver(undefined);
									props.onFocus(chat.id);
								}}
							>
								<AgentFace chat={chat} identity={props.identities[chat.id]} unread={props.unread[chat.id] ?? 0} />
							</button>
						);
					}}
				</For>

				{/*
				 * `+n` opens the same dropdown the pill's chevron does. One list, two ways in —
				 * and more than three agents wanting you at once is a queue, which belongs in a
				 * list you can read rather than in 106px of chrome.
				 */}
				<Show when={split().more > 0}>
					<AgentMenu
						chats={props.chats}
						identities={props.identities}
						focused={props.focused}
						unread={props.unread}
						onFocus={props.onFocus}
						onNew={props.onNew}
						defaultKind={props.defaultKind}
						placement="bottom-end"
						label="Agents"
						trigger={(api) => (
							<button
								type="button"
								class="agent-more"
								ref={api.ref}
								aria-haspopup="menu"
								aria-expanded={api.open}
								title={`${split().more} more ${split().more === 1 ? "agent" : "agents"} wanting you`}
								aria-label={`${split().more} more ${split().more === 1 ? "agent" : "agents"} wanting you`}
								onClick={api.toggle}
							>
								+{split().more}
							</button>
						)}
					/>
				</Show>
			</span>

			<Show when={hovered()}>
				{(chat) => (
					<AgentHoverCard
						chat={chat()}
						identity={props.identities[chat().id]}
						unread={props.unread[chat().id] ?? 0}
						anchor={over()?.at ?? new DOMRect()}
					/>
				)}
			</Show>
		</Show>
	);
}
