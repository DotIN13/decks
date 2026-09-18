/**
 * The band at the top of the Boards pane: what is in flight right now.
 *
 * Pinned above the gallery rather than a tab of its own, because the question it
 * answers — "is anything waiting on me" — is the one a person asks before looking at
 * any board. Six rows at most: past that it is a list, and the Tasks tab is the list.
 */
import type { AgentChat, Task } from "@decks/protocol";
import { createMemo, For, Show } from "solid-js";
import { type DispatchTab, inFlight, stateWord, whyRefused } from "./dispatch-view.ts";

export interface TaskBandProps {
	tasks: Task[];
	/** The conversations that exist — an agent's name is a link only while it has one. */
	chats: AgentChat[];
	onTab: (tab: DispatchTab) => void;
	onOpenAgent: (id: string) => void;
}

/** The band shows this many; the rest are a tap away on the Tasks tab. */
const BAND_CAP = 6;

export function TaskBand(props: TaskBandProps) {
	const flight = createMemo(() => inFlight(props.tasks));
	const hasChat = (id: string | undefined) => id !== undefined && props.chats.some((chat) => chat.id === id);

	return (
		<section class="dispatch-band" aria-label="In flight">
			<header class="dispatch-band-head">
				<span class="label">In flight</span>
				<Show when={flight().length > 0}>
					<span class="dispatch-n">{flight().length}</span>
				</Show>
				<span class="flex-1" />
				<button type="button" class="dispatch-link" onClick={() => props.onTab("tasks")}>
					all {props.tasks.length} task{props.tasks.length === 1 ? "" : "s"}
				</button>
			</header>
			<Show when={flight().length > 0} fallback={<p class="dispatch-empty">Nothing in flight.</p>}>
				<ul class="dispatch-rows">
					<For each={flight().slice(0, BAND_CAP)}>
						{(task) => (
							<li class="dispatch-row" data-state={task.state}>
								<span class="dispatch-row-text">{task.text}</span>
								<span class="dispatch-row-mid">
									<Show
										when={whyRefused(task)}
										fallback={
											<Show when={task.agentId && task.agentName} fallback={<span>waiting for the dispatcher</span>}>
												<span>to </span>
												<Show when={hasChat(task.agentId)} fallback={<span>{task.agentName}</span>}>
													<button type="button" class="dispatch-link" onClick={() => props.onOpenAgent(task.agentId!)}>
														{task.agentName}
													</button>
												</Show>
												<span> · by the dispatcher</span>
											</Show>
										}
									>
										{(why) => <span>{why()}</span>}
									</Show>
								</span>
								<span class="dispatch-chip" data-s={stateWord(task)}>
									{stateWord(task)}
								</span>
							</li>
						)}
					</For>
				</ul>
			</Show>
		</section>
	);
}
