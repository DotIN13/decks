import type { Board, Identity, Schedule, Task, TaskState } from "@decks/protocol";
import { WORKSPACE_NONE, workspaceDigests } from "./workspace-panel.ts";

/**
 * The dashboard's arithmetic, without the dashboard.
 *
 * Everything `DispatchView.tsx` draws is derived from four lists the store already
 * holds — boards, identities, contexts, tasks — and every derivation is here, as a
 * plain function over plain arrays, so the answer to "what should the band show" can be
 * tested with `node --test` and no DOM. The components read these and add markup.
 *
 * The gallery of every board that used to be a tab of its own is gone: the sidebar's Boards
 * tab lists every board on both surfaces, and previews one on the dashboard. What stays here
 * is what the other panes and the sidebar still read — the news rule, the task words, the
 * schedule words.
 */

/** The three panes, in the order the tab strip draws them. */
export type DispatchTab = "canvases" | "tasks" | "cron";
export const DISPATCH_TABS: DispatchTab[] = ["canvases", "tasks", "cron"];

/** What each tab is called on its button. */
export const DISPATCH_TAB_LABEL: Record<DispatchTab, string> = { canvases: "Canvases", tasks: "Tasks", cron: "Cron" };

/**
 * The five words the UI has for a task's seven states.
 *
 * Seven is how the server thinks; five is how a reader does. `open` and `assigned` are
 * both "not started" from a chair, so both are *queued*. `blocked` and `failed` are both
 * "the dispatcher gave up and wants a person", so both are *refused* — and both carry a
 * sentence saying why (`whyRefused`).
 */
export type StateWord = "queued" | "running" | "done" | "refused" | "cancelled";

const WORD: Record<TaskState, StateWord> = {
	open: "queued",
	assigned: "queued",
	running: "running",
	done: "done",
	blocked: "refused",
	failed: "refused",
	cancelled: "cancelled",
};

export function stateWord(task: Pick<Task, "state">): StateWord {
	return WORD[task.state] ?? "queued";
}

/**
 * The sentence beside a refused task: the rule's own reason when it blocked, else what
 * the dispatcher recorded when it chose. Undefined for anything not refused, so a row
 * does not draw a "why" beside a task that is simply running.
 */
export function whyRefused(task: Task): string | undefined {
	if (stateWord(task) !== "refused") return undefined;
	return task.reason ?? task.dispatch.why;
}

/**
 * The order the in-flight band shows tasks in: what wants a person first.
 *
 * Refused tasks lead because they are the only ones where the reader is the next step.
 * Then running (something is happening now), then assigned (something is about to), then
 * open (nothing has been decided). Within a state, newest first.
 */
const FLIGHT_RANK: Partial<Record<TaskState, number>> = {
	blocked: 0,
	failed: 0,
	running: 1,
	assigned: 2,
	open: 3,
};

/** How many tasks are waiting on a person — the number on the Tasks tab, and on Home. */
export function wantsYou(tasks: Task[]): number {
	return tasks.filter((task) => task.state === "blocked" || task.state === "failed").length;
}

/** How recent "changed" is. A day: the digest's own cadence. */
const CHANGED_WITHIN = 24 * 60 * 60 * 1000;

/**
 * Whether a board is news: an agent named it, and the person had not read it since.
 *
 * Two times can be the newest one, and they mean different things. `namedAt` is the last act that
 * named a writer: an agent fitting, showing or reporting a board, or the person's own edit.
 * `modifiedAt` is the file, whoever moved it. The later of the two is what a reader is being told
 * about, with one exception — the person's own act, when it is also the newest, is not news to
 * them. `seenAt` is when they last looked, on any device.
 */
export function isNews(board: Board, now = Date.now()): boolean {
	const named = board.namedAt ?? 0;
	const file = board.modifiedAt ?? 0;
	/*
	 * The person's own act is not news to them. `named === 0` is a byline kept from before acts
	 * were timed, which is every record already on a deck: their own edit is the likeliest reason
	 * that file moved, and the mark clears on a read either way. A *timed* act older than the file
	 * is the other case — something else wrote it afterwards — and that is news.
	 */
	if (board.lastWrittenBy === "you" && (named === 0 || named >= file)) return false;
	const at = Math.max(named, file);
	return at > (board.seenAt ?? 0) && at > now - CHANGED_WITHIN;
}

/** How long ago a board was named, short enough for a chip: "now", "45m", "2h", "1d". */
export function agoLabel(at: number, now = Date.now()): string {
	const minutes = Math.max(0, Math.floor((now - at) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

/** The mark on the newest act, for a card whose board has one. */

/** The card's caption: `boards/plan.html` as `plan`. The prefix and the suffix say nothing the grid does not. */
export function fileName(path: string): string {
	return path.replace(/^boards\//, "").replace(/\.html$/, "");
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * A schedule's days as a phrase: "every day", "weekdays", "Mon Wed", "paused".
 *
 * Does not sort its argument in place — the wire's array is the store's array.
 */
export function daysLabel(days: number[]): string {
	const sorted = [...new Set(days)].sort((a, b) => a - b);
	if (sorted.length === 0) return "paused";
	if (sorted.length === 7) return "every day";
	if (sorted.length === 5 && sorted.every((day, index) => day === WEEKDAYS[index])) return "weekdays";
	return sorted.map((day) => WEEKDAY[day] ?? String(day)).join(" ");
}

/** A schedule that will not fire: switched off, or with no days left. */
export function schedulePaused(schedule: Pick<Schedule, "enabled" | "days">): boolean {
	return !schedule.enabled || schedule.days.length === 0;
}

/** The names of the agents holding a path, for "held by". */
export function holderNames(path: string, identities: Record<string, Identity>, contexts: Record<string, string[]>): string[] {
	return Object.entries(contexts)
		.filter(([, held]) => held.includes(path))
		.map(([id]) => identities[id]?.name ?? id);
}
