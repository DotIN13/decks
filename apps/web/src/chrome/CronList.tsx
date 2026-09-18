/**
 * Every schedule as a card: when it fires, what it makes, and what happened last time.
 *
 * No create form. A schedule is made by saying it in the bar ("every weekday at nine,
 * digest for alpha"), and the server checks the sentence; a form here would be a second
 * grammar for the same request. A card reads like a task's with the time where the state
 * chip was: the time of day large with the name beside it, the job sentence, the last run,
 * the boards it carries as picture chips, and run now and remove in the foot.
 */
import type { Board, Schedule } from "@decks/protocol";
import Play from "lucide-solid/icons/play";
import Trash2 from "lucide-solid/icons/trash-2";
import { For, Show } from "solid-js";
import { Icon } from "../ui/icons.tsx";
import { BoardChip } from "./BoardChip.tsx";
import { daysLabel, schedulePaused } from "./dispatch-view.ts";
import { relativeTime, untilTime } from "./workspace-panel.ts";

export interface CronListProps {
	schedules: Schedule[];
	/** Every board, so a board a job carries can be drawn as its picture. */
	boards: Board[];
	onRunSchedule: (id: string) => void;
	onCancelSchedule: (id: string) => void;
	/** A board a schedule carries, pressed: the preview panel. */
	onPreview?: (path: string) => void;
}

export function CronList(props: CronListProps) {
	const n = () => props.schedules.length;
	return (
		<>
			<div class="dispatch-note">
				<span class="flex-1" />
				<span class="dispatch-hint">Ask in the bar: "every weekday at nine, digest for alpha". The dispatcher makes the schedule.</span>
			</div>
			<Show when={n() > 0} fallback={<p class="dispatch-empty">Nothing scheduled. Say when in the bar and the morning digest starts here.</p>}>
				<div class="dispatch-sec">
					<b>Scheduled</b>
					<span class="dispatch-n">{n()}</span>
				</div>
				<ul class="dispatch-rows dispatch-cron">
					<For each={props.schedules}>
						{(schedule) => (
							<li class="dispatch-task dispatch-sched" data-s={schedulePaused(schedule) ? "cancelled" : "queued"}>
								<div class="dispatch-task-head">
									<Show when={!schedulePaused(schedule)} fallback={<span class="dispatch-chip" data-s="cancelled">paused</span>}>
										<span class="dispatch-chip" data-s="queued">
											next {untilTime(schedule.nextRunAt)}
										</span>
									</Show>
									<span class="dispatch-task-when">{daysLabel(schedule.days)}</span>
								</div>
								<div class="dispatch-sched-time">
									{schedule.at}
									<small>{schedule.name}</small>
								</div>
								<p class="dispatch-task-text" data-open data-plain>
									{schedule.kind === "digest" ? `The morning digest for ${schedule.workspace}.` : schedule.task || "A custom task."}
								</p>
								<div class="dispatch-task-route">
									<Show when={schedule.lastRunAt} fallback={<span>has not run yet</span>}>
										{(at) => (
											<span>
												last {relativeTime(at())}
												{schedule.missed > 0 ? ` · ${schedule.missed} skipped` : ""}
											</span>
										)}
									</Show>
								</div>
								<Show when={schedule.boards.length > 0}>
									<div class="dispatch-task-out">
										<div class="dispatch-task-wrote">
											<For each={schedule.boards}>{(path) => <BoardChip path={path} boards={props.boards} onPreview={props.onPreview} />}</For>
										</div>
									</div>
								</Show>
								<div class="dispatch-task-foot">
									<span class="dispatch-task-who">
										{schedule.kind === "digest" ? "digest" : "task"} · {schedule.workspace}
									</span>
									<span class="flex-1" />
									<button type="button" class="dispatch-ib" aria-label="run now" title="Run now: the same job, once, this minute" onClick={() => props.onRunSchedule(schedule.id)}>
										<Icon of={Play} size={14} />
									</button>
									<button type="button" class="dispatch-ib" data-tone="danger" aria-label="remove" title="Remove this schedule" onClick={() => props.onCancelSchedule(schedule.id)}>
										<Icon of={Trash2} size={14} />
									</button>
								</div>
							</li>
						)}
					</For>
				</ul>
			</Show>
		</>
	);
}
