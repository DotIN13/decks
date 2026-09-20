import { randomUUID } from "node:crypto";
import type { Schedule, ScheduleSpec, ServerMessage, Task, TaskResult, TaskRosterEntry, TaskSpec } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { dispatch } from "./dispatch.ts";
import { nextRun, tick, validateWhen } from "./schedule.ts";
import { TaskStore } from "./store.ts";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "every day", "weekdays", or the days named, for a sentence about a schedule. */
function daysLabel(days: number[]): string {
	const sorted = [...new Set(days)].sort((a, b) => a - b);
	if (sorted.length === 7) return "every day";
	if (sorted.length === 5 && sorted.every((day, index) => day === index + 1)) return "weekdays";
	return sorted.map((day) => WEEKDAY[day] ?? String(day)).join(", ");
}

/**
 * What the service needs from the agent registry, and nothing else.
 *
 * The dashboard's dispatcher is a *rule*, and this interface is the seam that keeps
 * it a rule: a roster to read and a queue to write, both of which already existed.
 * The interface is deliberately narrower than `Registry` — the service has no
 * business spawning agents or reading their transcripts.
 */
export interface TaskRegistry {
	/**
	 * Ask the dispatcher agent to place a task. It answers through `assignedByDispatcher`
	 * (its `send` during the turn) and `decided` (the turn's end), not through a return.
	 */
	decide(task: { id: string; text: string; boards: string[]; workspace?: string; canvas?: string; promptPath?: string; schedule?: string }): { dispatcherId: string };
	/** Every agent, with the fields the rule ranks on. */
	roster(): TaskRosterEntry[];
	/**
	 * Put a task in an agent's queue. Throws with a sentence when the agent is gone,
	 * which the service turns into a `blocked` task rather than a crash.
	 */
	deliver(target: string, spec: DeliverSpec): { queued: true; position: number };
	/** Take a queued task back out — a cancellation must not leave work that then runs. */
	removeQueued(agentId: string, taskId: string): boolean;
}

/** The handover spec the service writes, an agent's `send` shape plus the task's own id. */
export interface DeliverSpec {
	task: string;
	boards?: string[];
	/** Joins the queued item to its task, so the drain can report back. */
	taskId: string;
	/** What the queue's arrival notice names as the sender. */
	fromName: string;
	/** The canvas the work is for, by id; the agent moves there before it starts. */
	canvas?: string;
}

/** A task the assignee finished — what the drain reports back through the same seam. */
export interface TaskFinish {
	taskId: string;
	/** Whether the run threw. */
	ok: boolean;
	report: string;
	/** Boards the turn wrote, for the task's `result`. */
	boards: string[];
}

/**
 * The dashboard's second half: tasks as a store, a state machine and a surface.
 *
 * One class owns both creates — the panel's and the cron scheduler's — so a schedule
 * makes exactly the task the dashboard makes, through the same dispatch, the same
 * queue and the same broadcast. Nothing here knows what buttons the browser has;
 * it answers frames (`wire/tasks.ts`) and a timer (`App.tickTasks`).
 *
 * The states and who moves them:
 *
 * - created → **assigned** or **blocked**, in the same tick: `create` dispatches
 *   immediately and pushes into the winner's queue (or records the honest "nobody"
 *   reason). A task is never left sitting in `open`.
 * - assigned → **running** when the drain pops it (`taskStarted`), → **done** or
 *   **failed** when its turn ends (`taskFinished`). *Done means the agent finished
 *   a turn on it*, and the `result` carries the report and the boards that turn
 *   wrote — the two readings of "done" the brief asks about, both captured.
 * - assigned → **cancelled** by a person (`cancel`). The queued item is removed
 *   too, so a cancelled task cannot run behind the person's back.
 * - assigned → **open** when the agent it was assigned to is removed
 *   (`agentRemoved`), and re-dispatched on the spot — the deck re-decides rather
 *   than stranding the work in a ghost's queue.
 * - blocked / failed / cancelled → **retried** by a person (`retry`), which reruns
 *   the rule. `done` and `running` are refused: done is done, and a running task is
 *   stopped in its chat.
 *
 * **A task cannot be assigned twice.** The dispatch writes `assigned` and calls
 * `deliver` in the same synchronous tick, and every path that would re-decide —
 * `retry`, `agentRemoved`, a cron tick overlapping the previous — reads the task's
 * current state from this same list first. The list is the lock.
 */
export class TaskService {
	private readonly tasks: Task[] = [];
	private readonly schedules: Schedule[] = [];

	constructor(
		private readonly store: TaskStore,
		private readonly registry: TaskRegistry,
		private readonly emit: (message: ServerMessage) => void,
	) {
		this.tasks = store.loadTasks();
		this.schedules = store.loadSchedules();
	}

	/** Everything the panel draws, newest first, with schedules by next run. */
	summary(): { tasks: Task[]; schedules: Schedule[] } {
		const tasks = [...this.tasks].sort((a, b) => b.createdAt - a.createdAt);
		const schedules = [...this.schedules].sort((a, b) => a.nextRunAt - b.nextRunAt || a.name.localeCompare(b.name));
		return { tasks, schedules };
	}

	/** One task, by id. */
	get(id: string): Task | undefined {
		return this.tasks.find((task) => task.id === id);
	}

	/**
	 * The deck's clock moved (Settings, Time): re-read every schedule that follows it.
	 *
	 * "08:00" now names a different instant. If that instant is earlier today, the rule in
	 * `tick` would fire it at once, as it does for a server that came back at 09:05. But
	 * nothing was down: the job ran today, at the hour the old clock gave it. So a run that
	 * is only due because the clock moved is counted as today's, and not made again. A
	 * schedule with a zone of its own did not move and is left alone.
	 */
	rezone(now = Date.now()): void {
		for (const schedule of this.schedules) {
			if (schedule.timezone) continue;
			const outcome = tick(schedule, schedule.lastRunAt ?? schedule.createdAt, now);
			if (outcome.due > 0) schedule.lastRunAt = outcome.due;
			schedule.nextRunAt = outcome.next;
		}
		this.persistSchedules();
		this.emitTasks();
	}

	/**
	 * A different deck is a different dashboard: drop what was held and re-read.
	 *
	 * Called by `App.openDeck`, which swaps the whole deck out from under everything. The
	 * old deck's tasks stay in its own `.decks/` and are read again if it is reopened;
	 * nothing is carried across, because a task names boards of one deck and has no
	 * meaning in another.
	 */
	reset(deck: Deck): void {
		this.tasks.length = 0;
		this.schedules.length = 0;
		this.store.setDeck(deck.path);
		this.tasks.push(...this.store.loadTasks());
		this.schedules.push(...this.store.loadSchedules());
		this.emitTasks();
	}

	/**
	 * Make a task and dispatch it in the same tick.
	 *
	 * Throws with a sentence when the text is empty; lets the *rule* say nobody when
	 * that is the answer, which becomes a blocked task rather than an error — a
	 * person sees the reason on the panel and can retry or cancel.
	 */
	create(spec: TaskSpec, source?: { scheduleId: string }, requestedBy?: string): TaskResult {
		const text = spec.text?.trim();
		if (!text) throw new Error("A task needs a description.");
		const now = Date.now();
		const task: Task = {
			id: randomUUID(),
			text,
			...(spec.workspace ? { workspace: spec.workspace } : {}),
			...(spec.canvas ? { canvas: spec.canvas } : {}),
			boards: spec.boards ?? [],
			dispatch: { at: now, outcome: "none", why: "" },
			state: "open",
			createdAt: now,
			updatedAt: now,
			...(source ? { source } : {}),
			...(requestedBy ? { requestedBy } : {}),
		};
		this.tasks.push(task);
		/*
		 * A person who named an agent has made the decision; the rule only checks the agent
		 * is still there. Everything else goes to the dispatcher agent, which reads the
		 * roster and hands the work over with `stage.send`; until it does the task is open,
		 * and the panel says who is deciding.
		 */
		if (spec.agentId) this.applyDecision(task, dispatch({ text, workspace: spec.workspace, boards: spec.boards, agentId: spec.agentId }, this.registry.roster()));
		else this.askDispatcher(task);
		this.persist();
		return resultOf(task);
	}

	/** Hand a task to the dispatcher agent and mark it as being decided. */
	private askDispatcher(task: Task): void {
		task.state = "open";
		task.agentId = undefined;
		task.agentName = undefined;
		delete task.reason;
		task.dispatch = { at: Date.now(), outcome: "none", why: "The dispatcher is deciding who should take this." };
		try {
			// The message as a file first, so the briefing can point at it rather than
			// quote it when it is long, and so the text outlives the queue it rides in.
			const promptPath = this.store.savePrompt(task);
			// A task a cron job made says so, by the job's name: nobody typed it this morning.
			const schedule = task.source ? this.schedules.find((entry) => entry.id === task.source?.scheduleId)?.name : undefined;
			const { dispatcherId } = this.registry.decide({
				id: task.id,
				text: task.text,
				boards: task.boards,
				...(task.workspace ? { workspace: task.workspace } : {}),
				...(task.canvas ? { canvas: task.canvas } : {}),
				...(promptPath ? { promptPath } : {}),
				...(schedule ? { schedule } : {}),
			});
			task.dispatcherId = dispatcherId;
		} catch (error) {
			task.state = "blocked";
			task.reason = `The dispatcher could not be asked: ${(error as Error).message}`;
		}
	}

	/** The dispatcher handed the task to an agent: its `send` during the deciding turn. */
	assignedByDispatcher(placement: { taskId: string; agentId: string; agentName: string; why: string }): void {
		const task = this.find(placement.taskId);
		if (!task || task.state !== "open") return;
		task.state = "assigned";
		task.agentId = placement.agentId;
		task.agentName = placement.agentName;
		delete task.reason;
		/*
		 * The reason is the dispatcher's, and it says it when its turn ends (`decided`), so
		 * until then the row says who and not why. It used to quote the sent text here, which
		 * put a second copy of the work under every row and hid the one sentence that mattered.
		 */
		task.dispatch = { at: Date.now(), outcome: "agent", agentId: placement.agentId, agentName: placement.agentName, why: `The dispatcher chose ${placement.agentName}.` };
		task.updatedAt = Date.now();
		this.persist();
	}

	/**
	 * The dispatcher's turn ended. Nothing sent means nobody should take it, with its reason;
	 * something sent means its closing sentence is the reason the row shows beside the name.
	 */
	decided(outcome: { taskId: string; sent: boolean; report: string }): void {
		const task = this.find(outcome.taskId);
		if (!task) return;
		const said = outcome.report.trim().split("\n").find((line) => line.trim()) ?? "";
		if (outcome.sent) {
			if (task.dispatch.outcome !== "agent" || !said) return;
			task.dispatch = { ...task.dispatch, why: said.slice(0, 240) };
			task.updatedAt = Date.now();
			this.persist();
			return;
		}
		if (task.state !== "open") return;
		task.state = "blocked";
		task.reason = said ? said.slice(0, 240) : "The dispatcher did not hand it to anyone.";
		task.dispatch = { at: Date.now(), outcome: "none", why: task.reason };
		task.updatedAt = Date.now();
		this.persist();
	}

	/**
	 * The dispatcher answered a task by making a schedule: the person asked for something
	 * recurring, so the task is done and the schedule is what it produced.
	 */
	scheduled(outcome: { taskId: string; schedule: Schedule }): void {
		const task = this.find(outcome.taskId);
		if (!task || task.state !== "open") return;
		const when = `${daysLabel(outcome.schedule.days)} at ${outcome.schedule.at}`;
		task.state = "done";
		delete task.reason;
		task.dispatch = { at: Date.now(), outcome: "none", why: `Scheduled: ${outcome.schedule.name}, ${when}.` };
		task.result = { at: Date.now(), report: `Made the schedule "${outcome.schedule.name}", ${when}, for ${outcome.schedule.workspace}. It is on the Cron tab.`, boards: [] };
		task.updatedAt = Date.now();
		this.persist();
	}

	/** Take a task back, and out of its agent's queue. */
	cancel(id: string): { cancelled: boolean; reason?: string } {
		const task = this.find(id);
		if (!task) return { cancelled: false, reason: "That task is gone." };
		if (task.state === "done") return { cancelled: false, reason: "It is done; there is nothing to cancel." };
		if (task.state === "running") return { cancelled: false, reason: "It is running. Stop it in its chat." };
		if (task.agentId) this.registry.removeQueued(task.agentId, task.id);
		task.state = "cancelled";
		task.updatedAt = Date.now();
		this.persist();
		return { cancelled: true };
	}

	/**
	 * Run the dispatcher again on a task a person wants back in play.
	 *
	 * Blocked, failed and cancelled tasks re-enter the race; a done or running one
	 * is refused with the reason — there is no way to safely un-run a turn, and a
	 * running task is stopped where it runs, not here.
	 */
	retry(id: string): { task: TaskResult } | { error: string } {
		const task = this.find(id);
		if (!task) return { error: "That task is gone." };
		if (task.state === "done") return { error: "It is done. Make a new task." };
		if (task.state === "running") return { error: "It is running. Stop it in its chat." };
		task.updatedAt = Date.now();
		this.askDispatcher(task);
		this.persist();
		return { task: resultOf(task) };
	}

	// --- schedules ---------------------------------------------------------------

	createSchedule(spec: ScheduleSpec): Schedule | { error: string } {
		try {
			validateWhen({ at: spec.at, days: spec.days, ...(spec.timezone ? { timezone: spec.timezone } : {}) });
		} catch (error) {
			return { error: (error as Error).message };
		}
		if (!spec.name?.trim()) return { error: "A schedule needs a name." };
		if (!spec.workspace) return { error: "A schedule needs a workspace to write into." };
		if (!spec.task?.trim()) return { error: "A schedule needs the text of the task it makes." };
		const now = Date.now();
		const schedule: Schedule = {
			id: randomUUID(),
			name: spec.name.trim(),
			at: spec.at,
			days: spec.days,
			...(spec.timezone ? { timezone: spec.timezone } : {}),
			workspace: spec.workspace,
			task: spec.task.trim(),
			boards: spec.boards ?? [],
			createdAt: now,
			nextRunAt: nextRun({ at: spec.at, days: spec.days, ...(spec.timezone ? { timezone: spec.timezone } : {}) }, now),
			missed: 0,
			enabled: true,
		};
		this.schedules.push(schedule);
		this.persistSchedules();
		return schedule;
	}

	cancelSchedule(id: string): boolean {
		const index = this.schedules.findIndex((schedule) => schedule.id === id);
		if (index === -1) return false;
		const [schedule] = this.schedules.splice(index, 1);
		if (!schedule) return false;
		this.persistSchedules();
		this.persist();
		// A schedule that goes is a task that should not: cancel whatever it is still waiting on.
		for (const task of this.tasks) {
			if (task.source?.scheduleId !== schedule.id || task.state === "done" || task.state === "cancelled") continue;
			if (task.agentId) this.registry.removeQueued(task.agentId, task.id);
			task.state = "cancelled";
			task.updatedAt = Date.now();
		}
		this.persist();
		return true;
	}

	/** Make and dispatch the task a schedule would have made, on demand — the Run button. */
	runNow(id: string): TaskResult | { error: string } {
		const schedule = this.schedules.find((entry) => entry.id === id);
		if (!schedule) return { error: "That schedule is gone." };
		return this.create(scheduleTask(schedule), { scheduleId: schedule.id });
	}

	/**
	 * The scheduler's own look at the clock.
	 *
	 * Called by the app on an interval (the same shape as the board resync). Runs a
	 * schedule whose instant has arrived, once; skips and counts anything older than
	 * today; and does not stack a second task while the first is still in flight —
	 * a daily digest that takes a day to write is a digest that should wait.
	 */
	tick(now = Date.now()): void {
		let schedulesMoved = false;
		let tasksMoved = false;
		for (const schedule of this.schedules) {
			if (!schedule.enabled) continue;
			// Never run: the cursor is when it was made, so a job made at ten for nine waits for tomorrow.
			const outcome = tick(schedule, schedule.lastRunAt ?? schedule.createdAt, now);
			if (outcome.missed > 0 || schedule.nextRunAt !== outcome.next || (outcome.due > 0 && schedule.lastRunAt !== outcome.due)) schedulesMoved = true;
			if (outcome.due === 0) {
				schedule.nextRunAt = outcome.next;
				continue;
			}
			// One in flight is one too many — the previous task from this schedule has
			// not reached an end, so this due instant is consumed without a new task.
			const inFlight = this.tasks.some(
				(task) => task.source?.scheduleId === schedule.id && (task.state === "open" || task.state === "assigned" || task.state === "running"),
			);
			schedule.lastRunAt = outcome.due;
			schedule.nextRunAt = outcome.next;
			schedule.missed += outcome.missed;
			if (inFlight) continue;
			tasksMoved = true;
			this.create(scheduleTask(schedule), { scheduleId: schedule.id });
		}
		if (schedulesMoved) this.persistSchedules();
		if (tasksMoved) this.persist();
		this.emitTasks();
	}

	// --- the assignee's queue reporting back --------------------------------------

	/** The agent's queue popped the item: the task is now somebody's turn. */
	taskStarted(id: string): void {
		const task = this.find(id);
		if (!task || task.state !== "assigned") return;
		task.state = "running";
		task.updatedAt = Date.now();
		this.persist();
		this.emitTasks();
	}

	/** The turn ended — `result` is the task's own account of what happened. */
	taskFinished(finish: TaskFinish): void {
		const task = this.find(finish.taskId);
		if (!task || task.state !== "running") return;
		task.state = finish.ok ? "done" : "failed";
		task.result = { at: Date.now(), report: finish.report, boards: finish.boards };
		task.updatedAt = Date.now();
		this.persist();
		this.emitTasks();
	}

	/**
	 * The agent a task was assigned to is gone. The deck re-decides on the spot.
	 *
	 * This is the "assigned agent goes away mid-task" answer: the work comes back
	 * out of its queue, the rule runs again, and the task either lands somewhere
	 * real or blocks with a reason. Nothing is left pointing at a ghost.
	 */
	agentRemoved(id: string): void {
		let moved = false;
		for (const task of this.tasks) {
			if (task.agentId !== id) continue;
			if (task.state === "done" || task.state === "cancelled") continue;
			if (task.agentId) this.registry.removeQueued(task.agentId, task.id);
			task.updatedAt = Date.now();
			this.askDispatcher(task);
			moved = true;
		}
		if (!moved) return;
		this.persist();
		this.emitTasks();
	}

	// --- private -----------------------------------------------------------------

	private find(id: string): Task | undefined {
		return this.get(id);
	}

	/** Write the rule's answer onto a task: who, why, or blocked with the reason. */
	private applyDecision(task: Task, decision: ReturnType<typeof dispatch>): void {
		task.dispatch =
			decision.outcome === "agent"
				? { at: Date.now(), outcome: "agent" as const, agentId: decision.agentId, agentName: decision.agentName, why: decision.why }
				: { at: Date.now(), outcome: "none" as const, why: decision.reason };
		task.updatedAt = Date.now();
		if (decision.outcome === "none") {
			task.state = "blocked";
			task.reason = decision.reason;
			return;
		}
		task.agentId = decision.agentId;
		task.agentName = decision.agentName;
		delete task.reason;
		try {
			this.registry.deliver(decision.agentId, {
				task: task.text,
				boards: task.boards.length > 0 ? task.boards : undefined,
				taskId: task.id,
				fromName: "The dashboard",
				...(task.canvas ? { canvas: task.canvas } : {}),
			});
			task.state = "assigned";
		} catch (error) {
			// The roster named an agent and the queue refused it between the two calls —
			// a removal racing the dispatch. Blocked is the honest end state, with why.
			task.agentId = undefined;
			task.agentName = undefined;
			task.state = "blocked";
			task.reason = `The agent is gone: ${(error as Error).message}`;
		}
	}

	private persist(): void {
		this.store.saveTasks(this.tasks);
		this.emitTasks();
	}

	private persistSchedules(): void {
		this.store.saveSchedules(this.schedules);
		this.emitTasks();
	}

	private emitTasks(): void {
		this.emit({ type: "tasks", ...this.summary() });
	}
}

/** The task a schedule makes: its own words. */
function scheduleTask(schedule: Schedule): TaskSpec {
	return {
		text: schedule.task.trim(),
		workspace: schedule.workspace,
		boards: schedule.boards,
	};
}

function resultOf(task: Task): TaskResult {
	return {
		id: task.id,
		state: task.state,
		...(task.agentId ? { agentId: task.agentId } : {}),
		...(task.agentName ? { agentName: task.agentName } : {}),
		why: task.state === "blocked" && task.reason ? task.reason : task.dispatch.why,
	};
}