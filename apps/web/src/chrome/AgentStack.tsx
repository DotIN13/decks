import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import { createSignal, For, onCleanup, Show } from "solid-js";
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
	/*
	 * The last face it was on, kept after the pointer leaves.
	 *
	 * The card fades out rather than vanishing, and a card whose content is cleared the
	 * instant it starts fading is a card that fades out blank. So `over` says whether it is
	 * *shown* and this says what is *in* it.
	 */
	const [last, setLast] = createSignal<{ id: string; at: DOMRect } | undefined>();
	/*
	 * What the card holds: the face under the pointer, then the last one it was on, then —
	 * before any hover at all — the first face in the stack.
	 *
	 * The fallback is what makes "always mounted" true rather than nearly true. Without it
	 * the card is built on the *first* hover and only cheap on every one after, which is the
	 * hover that gets judged. With it the box exists and has been measured and placed before
	 * the pointer arrives, so the first show is the same as the fifth.
	 */
	const showing = () => {
		const id = (over() ?? last())?.id;
		return props.chats.find((chat) => chat.id === id) ?? split().shown[0];
	};

	/*
	 * Leaving is deferred by a frame or two; arriving cancels it.
	 *
	 * Moving the pointer from one face to the next fires `pointerleave` on the first *before*
	 * `pointerenter` on the second, so clearing on leave made the card blink out and back in
	 * between two adjacent faces — which is exactly the journey the transition exists to
	 * make smooth. Holding the exit for 80ms means a move between faces never hides it at
	 * all, and leaving the stack still puts it away promptly.
	 */
	/*
	 * Where the card sits before anyone has hovered: under the first face.
	 *
	 * Measured from the DOM rather than remembered, because the stack's own width changes as
	 * agents come and go. It only matters for the frames before the first `pointerenter`,
	 * and it is the difference between the first card appearing where it belongs and sliding
	 * in from the last place it happened to be placed.
	 */
	let strip: HTMLElement | undefined;
	const initialAnchor = () => strip?.querySelector("button")?.getBoundingClientRect() ?? new DOMRect();

	let exit: ReturnType<typeof setTimeout> | undefined;
	const enter = (id: string, event: { currentTarget: Element }) => {
		if (exit !== undefined) clearTimeout(exit);
		const at = { id, at: event.currentTarget.getBoundingClientRect() };
		setOver(at);
		setLast(at);
	};
	const leave = (id: string) => {
		if (exit !== undefined) clearTimeout(exit);
		exit = setTimeout(() => setOver((was) => (was?.id === id ? undefined : was)), 80);
	};
	onCleanup(() => {
		if (exit !== undefined) clearTimeout(exit);
	});

	return (
		<Show when={ordered().length > 0}>
			{/*
			 * `aria-label` on the group rather than a heading: this is a list of switches in a
			 * strip of chrome, and the one thing a screen reader needs before it reads three
			 * buttons is what they are three of.
			 */}
			<span class="agent-stack" role="group" aria-label="Agents wanting your attention" ref={strip}>
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
								<AgentFace chat={chat} identity={props.identities[chat.id]} unread={props.unread[chat.id] ?? 0} size={26} />
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

			{/*
				One card, mounted for as long as the stack is, and only unhidden on hover.
				*
				* Not `<Show when={hovered()}>`: that built the thing at the moment of pointing,
				* which is a component created, a box measured and two frames waited before
				* anything was on screen. No delay figure fixes that — it was 400ms, then 120,
				* and it still read as the app hesitating.
			*/}
			<Show when={showing()}>
				{(chat) => (
					<AgentHoverCard
						chat={chat()}
						identity={props.identities[chat().id]}
						unread={props.unread[chat().id] ?? 0}
						anchor={(over() ?? last())?.at ?? initialAnchor()}
						shown={over() !== undefined}
					/>
				)}
			</Show>
		</Show>
	);
}
