/**
 * The dashboard's two stores: tasks, and the schedules that make them.
 *
 * One module for both because they are one pipeline — a schedule creates a task on
 * the same path the panel does (`TaskService.create`), so the wire, the store and
 * the browser all see the same shapes. A task is a *thing to be done later*, by an
 * agent that may not exist yet; a schedule is the reason one keeps appearing.
 */

/**
 * What a task is doing right now.
 *
 * The ends are the interesting ones. `done` means the assigned agent finished a turn
 * on it, so its `result` is the report and the boards that turn wrote. `blocked` means
 * the rule found nobody to give it to, or the agent it was given to is gone — a
 * person has to act. `failed` means the assigned agent's turn threw. `cancelled`
 * means a person took it back; a cancelled task is also removed from the agent's
 * queue, so it cannot run after the moment it was cancelled.
 */
export type TaskState = "open" | "assigned" | "running" | "done" | "failed" | "blocked" | "cancelled";

/** What the dispatcher decided, recorded on the task so a later reader can see why it went where it went. */
export interface TaskDispatch {
	at: number;
	outcome: "agent" | "none";
	agentId?: string;
	agentName?: string;
	why: string;
}

/** One task, as the dashboard creates it and the browser draws it. */
export interface Task {
	id: string;
	/** The words handed to the assigned agent, verbatim. */
	text: string;
	/** The workspace it was asked for, if any — the first filter the rule applies. */
	workspace?: string;
	/** Boards handed to the assigned agent with the task, for the brief. */
	boards: string[];
	/**
	 * The rule's answer, recorded at dispatch time.
	 *
	 * The announcement of "the word doing the work in 'assign to the right agent' is
	 * right": a decision nobody can see is a decision nobody can correct. The panel
	 * draws the `why` beside the task.
	 */
	dispatch: TaskDispatch;
	state: TaskState;
	createdAt: number;
	updatedAt: number;
	/** Where the task went: the assigned agent, once the rule chose one. */
	agentId?: string;
	agentName?: string;
	/** Why it is blocked, when it is — the exact sentence the rule returned. */
	reason?: string;
	/** What the assigned agent's turn produced: its report and the boards it wrote. */
	result?: { at: number; report: string; boards: string[] };
	/** The schedule that created this task, when one did. */
	source?: { scheduleId: string };
	/** Who asked for it by hand: an agent id, or "you" for the panel. */
	requestedBy?: string;
	/**
	 * The dispatcher that placed this task: an agent spawned for it alone, whose transcript
	 * is the task's own log. Absent for a task that named its agent, which no dispatcher saw.
	 */
	dispatcherId?: string;
}

/** What the panel (or an agent) hands in to create a task. */
export interface TaskSpec {
	text: string;
	workspace?: string;
	boards?: string[];
	/**
	 * An agent named by a person. Wins over the rule: somebody who said who should do
	 * it has already made the decision the rule exists to make.
	 */
	agentId?: string;
}

/** What the dispatcher's rule reads about an agent. */
export interface TaskRosterEntry {
	id: string;
	name: string;
	state: string;
	workspace?: string;
	tags: string[];
	context: string[];
	queued: number;
}

/** The answer to `stage.task` and the panel's create — everything the caller needs to know where it went. */
export interface TaskResult {
	id: string;
	state: TaskState;
	agentId?: string;
	agentName?: string;
	why: string;
}

/**
 * When a schedule fires.
 *
 * `at` is "HH:MM" in the server's local time — the digest's "every morning at nine"
 * is a person's habit, and a person's habits live in their timezone. `days` uses
 * `Date.getDay()`, so 0 is Sunday and 6 is Saturday; `[]` means never, which is how
 * a schedule is paused without deleting it.
 */
export interface ScheduleWhen {
	at: string;
	days: number[];
}

/** The two kinds of task a schedule can make. */
export type ScheduleKind = "digest" | "custom";

/** What the panel hands in to create a schedule. */
export interface ScheduleSpec {
	name: string;
	at: string;
	/** `Date.getDay()`: 0 Sunday .. 6 Saturday. */
	days: number[];
	/**
	 * The workspace whose agent writes the task.
	 *
	 * On the schedule rather than invented by the rule: a scheduling decision is a
	 * person's, and it is the one field that decides where the digest lands.
	 */
	workspace: string;
	/**
	 * `digest` makes the task from the digest template (`tasks/digest.ts`); `custom`
	 * runs the text in `task` verbatim. One kind is a habit, the other is a job.
	 */
	kind: ScheduleKind;
	/** The task text, for `custom`. */
	task?: string;
	boards?: string[];
}

/** A schedule as it is stored and drawn. */
export interface Schedule extends ScheduleWhen {
	id: string;
	name: string;
	workspace: string;
	kind: ScheduleKind;
	task?: string;
	boards: string[];
	createdAt: number;
	/**
	 * The instant of the last run that *fired*. Also the cursor the scheduler
	 * advances past a run it decides is too old to replay — a cursor, not a claim,
	 * which is why a missed run leaves `lastRunAt` pointing at it anyway.
	 */
	lastRunAt?: number;
	/** The next instant, computed, so the panel can draw "next at" without arithmetic. */
	nextRunAt: number;
	/** Runs the server was down for, counted, so the panel can say "3 missed". */
	missed: number;
	enabled: boolean;
}