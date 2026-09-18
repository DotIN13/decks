import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Schedule, Task, TaskDispatch, TaskState } from "@decks/protocol";

/**
 * The dashboard's durable state: `.decks/tasks.json` and `.decks/schedules.json`.
 *
 * **Per deck, both of them.** A task names boards and agents of one deck, so it has
 * nowhere else to live; a schedule is argued to belong to the install — "a habit of
 * the person" — but it creates a task *in a deck*, naming a workspace of that deck,
 * and an install-level file would need a deck field and a filter for exactly the
 * same reads. The two files are one pipeline, so they sit beside each other on the
 * same argument the wire joins them on.
 *
 * **Whole-array rewrites, atomically**, like the agent store: a task list is short
 * and every task mutates (state, result, dispatch), which an append log would have
 * to rewrite in place anyway. Each write goes to a temporary file and is renamed
 * over the target, so a restart mid-write leaves the previous version rather than
 * half of the new one.
 *
 * **A corrupt file is renamed, not deleted.** The file is the deck's record of work
 * a person asked for, and silently replacing it would bury the question of what was
 * lost. Renaming it to `tasks.json.corrupt-<stamp>` keeps the bytes for a reader
 * and lets the store start clean, with a warning on the wire where a person will
 * see it.
 *
 * Writes fail silently, as the agent store does: a deck on a read-only volume is
 * still a deck, and the work should proceed in memory rather than take the process
 * down. The warning path is the one place the failure becomes visible.
 */

/** The version carried in each file, so an older shape is read as empty rather than trusted. */
const VERSION = 1;

export class TaskStore {
	constructor(
		private deckPath: string,
		private readonly warn: (text: string) => void,
	) {}

	/** A different deck is a different set of tasks — see `TaskService.reset`. */
	setDeck(deckPath: string): void {
		this.deckPath = deckPath;
	}

	private dir(): string {
		return join(this.deckPath, ".decks");
	}

	private file(name: string): string {
		return join(this.dir(), name);
	}

	/** The tasks on disk, read once and held by the service — or `[]` from a bad file. */
	loadTasks(): Task[] {
		return this.read("tasks.json", cleanTasks);
	}

	/** The schedules on disk, read once and held by the service — or `[]` from a bad file. */
	loadSchedules(): Schedule[] {
		return this.read("schedules.json", cleanSchedules);
	}

	saveTasks(tasks: Task[]): void {
		this.write("tasks.json", { version: VERSION, tasks });
	}

	/**
	 * The person's message, as a file of its own: `.decks/tasks/<id>.md`, the text verbatim.
	 *
	 * A task's text rides in the dispatcher's briefing and then in the receiving agent's
	 * queue item, and a long one (a pasted document, a page of notes) is the wrong thing
	 * to inline twice. The file is the durable copy either way, and the briefing points a
	 * dispatcher at it rather than quoting it when the message is long (`brief.ts`).
	 * Returns the absolute path, or nothing when the deck cannot be written to.
	 */
	savePrompt(task: Pick<Task, "id" | "text">): string | undefined {
		try {
			const dir = join(this.dir(), "tasks");
			mkdirSync(dir, { recursive: true });
			const file = join(dir, `${task.id}.md`);
			const temporary = `${file}.tmp`;
			writeFileSync(temporary, task.text.endsWith("\n") ? task.text : `${task.text}\n`);
			renameSync(temporary, file);
			return file;
		} catch {
			return undefined;
		}
	}

	saveSchedules(schedules: Schedule[]): void {
		this.write("schedules.json", { version: VERSION, schedules });
	}

	private read<T>(name: string, clean: (raw: unknown) => T[]): T[] {
		const file = this.file(name);
		if (!existsSync(file)) return [];
		try {
			return clean(JSON.parse(readFileSync(file, "utf8")) as unknown);
		} catch {
			/* not today's JSON — keep the bytes, say so, and start clean */
			try {
				renameSync(file, `${file}.corrupt-${Date.now()}`);
			} catch {
				/* the rename failed too: nothing to do but not crash */
			}
			this.warn(`The ${name} file could not be read; its bytes were kept as ${name}.corrupt-<time>.`);
			return [];
		}
	}

	private write(name: string, data: unknown): void {
		try {
			const dir = this.dir();
			mkdirSync(dir, { recursive: true });
			const file = this.file(name);
			const temporary = `${file}.tmp`;
			writeFileSync(temporary, JSON.stringify(data, null, 2));
			// `rename` within one filesystem is atomic, so a reader sees either the old
			// file or the new one — the same argument the agent store makes.
			renameSync(temporary, file);
		} catch {
			/* a read-only deck, or a disk that is full: the task list still lives for this run */
		}
	}
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

const STATES: TaskState[] = ["open", "assigned", "running", "done", "failed", "blocked", "cancelled"];

/** Take only what is the right shape, and drop the rest — a row that fails does not fail the file. */
function cleanTasks(raw: unknown): Task[] {
	if (!raw || typeof raw !== "object") return [];
	const list = (raw as { tasks?: unknown }).tasks;
	if (!Array.isArray(list)) return [];
	const out: Task[] = [];
	for (const entry of list) {
		if (!entry || typeof entry !== "object") continue;
		const task = entry as Record<string, unknown>;
		if (typeof task.id !== "string" || typeof task.text !== "string") continue;
		const state = STATES.includes(task.state as TaskState) ? (task.state as TaskState) : "open";
		const dispatch = cleanDispatch(task.dispatch);
		const numberAt = (value: unknown, fallback: number): number => {
			const digits = Number(value);
			return Number.isFinite(digits) ? digits : fallback;
		};
		const agentId = typeof task.agentId === "string" ? task.agentId : undefined;
		const agentName = typeof task.agentName === "string" ? task.agentName : undefined;
		const result =
			task.result && typeof task.result === "object"
				? (() => {
						const source = task.result as Record<string, unknown>;
						return {
							at: numberAt(source.at, 0),
							report: typeof source.report === "string" ? source.report : "",
							boards: strings(source.boards),
						};
					})()
				: undefined;
		out.push({
			id: task.id,
			text: task.text,
			...(typeof task.workspace === "string" ? { workspace: task.workspace } : {}),
			boards: strings(task.boards),
			dispatch,
			state,
			createdAt: numberAt(task.createdAt, 0),
			updatedAt: numberAt(task.updatedAt, numberAt(task.createdAt, 0)),
			...(agentId ? { agentId } : {}),
			...(agentName ? { agentName } : {}),
			...(typeof task.reason === "string" ? { reason: task.reason } : {}),
			...(result ? { result } : {}),
			...(task.source && typeof task.source === "object" && typeof (task.source as Record<string, unknown>).scheduleId === "string"
				? { source: { scheduleId: (task.source as Record<string, unknown>).scheduleId as string } }
				: {}),
			...(typeof task.requestedBy === "string" ? { requestedBy: task.requestedBy } : {}),
			// The dispatcher spawned for it: its log is the row's, and it outlives the task's turn.
			...(typeof task.dispatcherId === "string" ? { dispatcherId: task.dispatcherId } : {}),
		});
	}
	return out;
}

/** A dispatch record that failed to parse still leaves a task usable: the state says what happened next. */
function cleanDispatch(raw: unknown): TaskDispatch {
	const fallback: TaskDispatch = { at: 0, outcome: "none", why: "" };
	if (!raw || typeof raw !== "object") return fallback;
	const dispatch = raw as Record<string, unknown>;
	const at = Number(dispatch.at);
	const agentId = typeof dispatch.agentId === "string" ? dispatch.agentId : undefined;
	const agentName = typeof dispatch.agentName === "string" ? dispatch.agentName : undefined;
	return {
		at: Number.isFinite(at) ? at : 0,
		outcome: dispatch.outcome === "agent" ? "agent" : "none",
		...(agentId ? { agentId } : {}),
		...(agentName ? { agentName } : {}),
		why: typeof dispatch.why === "string" ? dispatch.why : "",
	};
}

/** Take only schedules that are real schedules; a bad day list or time stops a row, not the file. */
function cleanSchedules(raw: unknown): Schedule[] {
	if (!raw || typeof raw !== "object") return [];
	const list = (raw as { schedules?: unknown }).schedules;
	if (!Array.isArray(list)) return [];
	const out: Schedule[] = [];
	for (const entry of list) {
		if (!entry || typeof entry !== "object") continue;
		const schedule = entry as Record<string, unknown>;
		if (typeof schedule.id !== "string" || typeof schedule.name !== "string") continue;
		const days = Array.isArray(schedule.days)
		? schedule.days.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
		: [];
		const at = typeof schedule.at === "string" ? schedule.at : "";
		const numberAt = (value: unknown, fallback: number): number => {
			const digits = Number(value);
			return Number.isFinite(digits) ? digits : fallback;
		};
		out.push({
			id: schedule.id,
			name: schedule.name,
			at,
			days,
			...(typeof schedule.timezone === "string" && schedule.timezone ? { timezone: schedule.timezone } : {}),
			workspace: typeof schedule.workspace === "string" ? schedule.workspace : "",
			/*
			 * A schedule stored before digests stopped being a kind of their own has
			 * `kind: "digest"` and no text. It is kept, as the task it always meant.
			 */
			task:
				typeof schedule.task === "string" && schedule.task.trim()
					? schedule.task
					: "Write a digest board for this workspace: one line for each board changed since yesterday, saying who wrote it. Then stage.show it.",
			boards: strings(schedule.boards),
			createdAt: numberAt(schedule.createdAt, 0),
			...(numberAt(schedule.lastRunAt, 0) > 0 ? { lastRunAt: numberAt(schedule.lastRunAt, 0) } : {}),
			nextRunAt: numberAt(schedule.nextRunAt, 0),
			missed: numberAt(schedule.missed, 0),
			enabled: schedule.enabled !== false,
		});
	}
	return out;
}