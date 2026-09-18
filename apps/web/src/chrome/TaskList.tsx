/**
 * Every task as a card, in three groups: what is waiting on you, what is in flight, what is done.
 *
 * The band above the gallery is the summary; this is the record. A card is the sentence as
 * typed, one line saying where it went and the dispatcher's reason, and what came back
 * folded away: the report's first lines with the rest on a press, and a picture chip for
 * each board the turn wrote. The actions that fit the state are icons in the card's foot.
 * The groups are in the order a person needs them, and Done is folded to the latest few,
 * because the question this tab is opened for is "is anything on me".
 */
import type { AgentChat, Board, Task } from "@decks/protocol";
import MessageSquare from "lucide-solid/icons/message-square";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import ScrollText from "lucide-solid/icons/scroll-text";
import Square from "lucide-solid/icons/square";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Markdown } from "../chat/Markdown.tsx";
import { Icon } from "../ui/icons.tsx";
import { BoardChip } from "./BoardChip.tsx";
import { type StateWord, stateWord, whyRefused } from "./dispatch-view.ts";
import { relativeTime } from "./workspace-panel.ts";

export interface TaskListProps {
	tasks: Task[];
	/** The conversations that exist — "conversation" needs one to open. */
	chats: AgentChat[];
	/** Every board, so a board a task wrote can be drawn as its picture. */
	boards: Board[];
	onOpenAgent: (id: string) => void;
	onCancelTask: (id: string) => void;
	onRetryTask: (id: string) => void;
	/** Open a task's own dispatcher log: the conversation of the dispatcher spawned for it. */
	onOpenLog: (dispatcherId: string) => void;
	/** A board a task wrote, pressed: the preview panel. */
	onPreview?: (path: string) => void;
	/** A task somebody asked to see (a gallery card's "from a task"): scrolled to and marked. */
	spot?: string;
}

interface Group {
	key: "you" | "flight" | "done";
	title: string;
	words: StateWord[];
}

const GROUPS: Group[] = [
	{ key: "you", title: "Waiting on you", words: ["refused"] },
	{ key: "flight", title: "In flight", words: ["running", "queued"] },
	{ key: "done", title: "Done", words: ["done", "cancelled"] },
];

/** Done shows this many until asked for all of them. */
export const DONE_CAP = 6;

/**
 * The dispatcher's reason, once it has given one.
 *
 * The record says "The dispatcher chose X." from the moment of the send and takes the
 * dispatcher's closing sentence when its turn ends; the placeholder is not worth a line.
 * Records from before the change quoted the sent text after the name, so that is cut to
 * what followed the colon rather than drawn whole under the card.
 */
export function reasonOf(task: Pick<Task, "dispatch">): string | undefined {
	if (task.dispatch.outcome !== "agent") return undefined;
	const why = task.dispatch.why.trim();
	if (!why || /^The dispatcher chose [^.:]+\.?$/.test(why)) return undefined;
	return why.replace(/^The dispatcher chose [^:]+:\s*/, "");
}

function firstLines(text: string, n = 2): string {
	return text
		.trim()
		.split("\n")
		.filter((line) => line.trim())
		.slice(0, n)
		.join(" ");
}

/** The foot's left words: who has it, and since when. */
function whoLine(task: Task): string {
	switch (stateWord(task)) {
		case "refused":
			return "the dispatcher";
		case "queued":
			return task.agentName ? `queued with ${task.agentName}` : task.source ? "from a schedule" : "the dispatcher";
		case "running":
			return `${task.agentName ?? "an agent"}'s turn, ${relativeTime(task.updatedAt)}`;
		case "done":
			return `${task.agentName ?? "the dispatcher"}, ${relativeTime(task.result?.at ?? task.updatedAt)}`;
		case "cancelled":
			return `cancelled ${relativeTime(task.updatedAt)}`;
	}
}

export function TaskList(props: TaskListProps) {
	const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set());
	const [allDone, setAllDone] = createSignal(false);
	let list: HTMLDivElement | undefined;
	/*
	 * Asked to show one task: unfold Done if the cap is hiding it, then bring it into view. After
	 * a frame, because the row may not exist until the fold opens.
	 */
	createEffect(() => {
		const id = props.spot;
		if (!id) return;
		setAllDone(true);
		requestAnimationFrame(() => list?.querySelector(`[data-task="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
	});
	const ordered = createMemo(() => [...props.tasks].sort((a, b) => b.createdAt - a.createdAt));
	const grouped = createMemo(() => GROUPS.map((group) => ({ ...group, tasks: ordered().filter((task) => group.words.includes(stateWord(task))) })));
	const hasChat = (id: string | undefined) => id !== undefined && props.chats.some((chat) => chat.id === id);
	const canStop = (task: Task) => stateWord(task) === "queued" || stateWord(task) === "running";
	const canRetry = (task: Task) => stateWord(task) === "refused" || stateWord(task) === "cancelled";
	const toggle = (id: string) =>
		setOpened((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<div ref={list} style={{ display: "contents" }}>
			<Show when={props.tasks.length > 0} fallback={<p class="dispatch-empty">No tasks yet. Ask for one from the bar, or an agent can with stage.task.</p>}>
				<For each={grouped()}>
					{(group) => (
						<Show when={group.tasks.length > 0}>
							<div class="dispatch-sec">
								<b>{group.title}</b>
								<span class="dispatch-n">{group.tasks.length}</span>
								<Show when={group.key === "done" && group.tasks.length > DONE_CAP}>
									<button type="button" class="dispatch-link" onClick={() => setAllDone((v) => !v)}>
										{allDone() ? "show fewer" : `show all ${group.tasks.length}`}
									</button>
								</Show>
							</div>
							<ul class="dispatch-rows dispatch-tasks">
								<For each={group.key === "done" && !allDone() ? group.tasks.slice(0, DONE_CAP) : group.tasks}>
									{(task) => (
										<li class="dispatch-task" data-task={task.id} data-spot={props.spot === task.id ? "true" : undefined} data-state={task.state} data-s={stateWord(task)}>
											<div class="dispatch-task-head">
												<span class="dispatch-chip" data-s={stateWord(task)}>
													{stateWord(task)}
												</span>
												<Show when={task.source}>
													<span class="dispatch-chip" data-s="plain">
														scheduled
													</span>
												</Show>
												<span class="dispatch-task-when">{relativeTime(task.createdAt)}</span>
											</div>
											{/* The sentence as typed, three lines of it; a press shows the rest. */}
											<p
												class="dispatch-task-text"
												data-open={opened().has(task.id) || undefined}
												title={opened().has(task.id) ? undefined : "Show the whole message"}
												onClick={() => toggle(task.id)}
											>
												{task.text}
											</p>
											<div class="dispatch-task-route" data-tone={whyRefused(task) ? "warn" : undefined}>
												<Show
													when={whyRefused(task)}
													fallback={
														<Show
															when={task.agentName}
															fallback={
																<span>
																	{task.state === "open"
																		? task.dispatch.why || "The dispatcher is deciding who should take this."
																		: task.dispatch.outcome === "none" && task.dispatch.why
																			? task.dispatch.why
																			: task.workspace
																				? `for ${task.workspace}`
																				: ""}
																</span>
															}
														>
															<span>to </span>
															<Show when={hasChat(task.agentId)} fallback={<b>{task.agentName}</b>}>
																<button type="button" class="dispatch-link" onClick={() => props.onOpenAgent(task.agentId!)}>
																	{task.agentName}
																</button>
															</Show>
															<Show when={reasonOf(task)}>{(why) => <span> · {why()}</span>}</Show>
														</Show>
													}
												>
													{(why) => <span>{why()}</span>}
												</Show>
											</div>
											<Show when={task.result && (task.result.report.trim() || task.result.boards.length > 0) ? task.result : undefined}>
												{(result) => (
													<div class="dispatch-task-out">
														<Show when={result().report.trim()}>
															<details class="dispatch-task-report">
																<summary>
																	<b>Report</b>
																	<span>{firstLines(result().report)}</span>
																</summary>
																<div class="dispatch-task-report-body">
																	<Markdown text={result().report} />
																</div>
															</details>
														</Show>
														<Show when={result().boards.length > 0}>
															<div class="dispatch-task-wrote">
																<For each={result().boards}>{(path) => <BoardChip path={path} boards={props.boards} onPreview={props.onPreview} />}</For>
															</div>
														</Show>
													</div>
												)}
											</Show>
											<div class="dispatch-task-foot">
												<span class="dispatch-task-who">{whoLine(task)}</span>
												<span class="flex-1" />
												<Show when={hasChat(task.agentId)}>
													<button type="button" class="dispatch-ib" aria-label="conversation" title="Open the conversation" onClick={() => props.onOpenAgent(task.agentId!)}>
														<Icon of={MessageSquare} size={14} />
													</button>
												</Show>
												<Show when={task.dispatcherId}>
													{(id) => (
														<button type="button" class="dispatch-ib" aria-label="dispatcher log" title="Dispatcher log" onClick={() => props.onOpenLog(id())}>
															<Icon of={ScrollText} size={14} />
														</button>
													)}
												</Show>
												<Show when={canStop(task)}>
													<button type="button" class="dispatch-ib" data-tone="danger" aria-label="stop" title="Stop" onClick={() => props.onCancelTask(task.id)}>
														<Icon of={Square} size={13} />
													</button>
												</Show>
												<Show when={canRetry(task)}>
													<button type="button" class="dispatch-ib" aria-label="retry" title="Retry: ask the dispatcher again" onClick={() => props.onRetryTask(task.id)}>
														<Icon of={RotateCcw} size={14} />
													</button>
												</Show>
											</div>
										</li>
									)}
								</For>
							</ul>
						</Show>
					)}
				</For>
			</Show>
		</div>
	);
}
