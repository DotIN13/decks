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
 * Two readings share one rule. `galleryGroups` groups boards by workspace with exactly
 * `workspaceDigests`'s semantics (a board belongs to the workspace whose agents hold
 * it), so the gallery and the panel's agent list never disagree about which project a
 * board is in. It then adds the one thing the digest leaves out: boards nobody holds,
 * which still exist and still change, and go last.
 */

/** The four panes, in the order the tab strip draws them. */
export type DispatchTab = "canvases" | "boards" | "tasks" | "cron";
export const DISPATCH_TABS: DispatchTab[] = ["canvases", "boards", "tasks", "cron"];

/** What each tab is called on its button. */
export const DISPATCH_TAB_LABEL: Record<DispatchTab, string> = { canvases: "Canvases", boards: "Boards", tasks: "Tasks", cron: "Cron" };

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

/** Every task that is not finished, in the band's order. */
export function inFlight(tasks: Task[]): Task[] {
	return tasks
		.filter((task) => FLIGHT_RANK[task.state] !== undefined)
		.sort((a, b) => {
			const rank = (FLIGHT_RANK[a.state] ?? 9) - (FLIGHT_RANK[b.state] ?? 9);
			return rank !== 0 ? rank : b.updatedAt - a.updatedAt;
		});
}

/** How many tasks are waiting on a person — the number on the Boards tab. */
export function wantsYou(tasks: Task[]): number {
	return tasks.filter((task) => task.state === "blocked" || task.state === "failed").length;
}

/** One board in the gallery, with what the card says under it. */
export interface GalleryCard {
	board: Board;
	/** The writer's name — an agent's, or "you" — for the "by" chip. */
	writtenBy?: string;
	/** The writer's agent id, when the writer is an agent this deck still has: what the chip opens. */
	writerId?: string;
	/** The newest finished task that wrote this board, when one did. */
	fromTask?: Task;
	/** Named by somebody else since the person last read it. */
	changed: boolean;
	/** How long ago that was, as "45m" or "2h", for the mark on the card. */
	changedAgo?: string;
}

/** One workspace's shelf of the gallery. */
export interface GalleryGroup {
	name: string;
	/** False for the "No workspace" shelf. */
	real: boolean;
	/** Who is in it, by name. */
	agents: string[];
	/** Newest first, capped. */
	cards: GalleryCard[];
	/** How many cards the cap hid. */
	more: number;
	/** Cards changed in the last day — counted before the cap, so the header is true. */
	changed: number;
	/** Whether the shelf starts folded. Only the "No workspace" shelf does. */
	collapsed: boolean;
}

/** A shelf shows this many before "N more" — three rows of the three-column grid. */
export const GROUP_CAP = 9;

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
function actAt(board: Board): number {
	return Math.max(board.namedAt ?? 0, board.modifiedAt ?? 0);
}

/** The writer's byline: the agent's name for an id, "you" for the person, else the id itself. */
export function writerName(identities: Record<string, Identity>, who: string | undefined): string | undefined {
	if (!who) return undefined;
	if (who === "you") return "you";
	return identities[who]?.name ?? who;
}

/** The newest finished task whose turn wrote this path. */
export function taskThatWrote(tasks: Task[], path: string): Task | undefined {
	let best: Task | undefined;
	for (const task of tasks) {
		if (task.state !== "done" || !task.result?.boards.includes(path)) continue;
		if (!best || task.result.at > (best.result?.at ?? 0)) best = task;
	}
	return best;
}

/**
 * The gallery, grouped by workspace.
 *
 * Holders decide the group, exactly as `workspaceDigests` does; a board held by two
 * workspaces is on both shelves. Boards nobody holds join the "No workspace" shelf,
 * which is last and starts folded: they are the deck's long tail, and unfolding it is a
 * click rather than a scroll past forty tiles.
 */
export function galleryGroups(
	boards: Board[],
	identities: Record<string, Identity>,
	contexts: Record<string, string[]>,
	tasks: Task[],
	now = Date.now(),
	cap = GROUP_CAP,
): GalleryGroup[] {
	const byPath = new Map(boards.map((board) => [board.path, board]));
	const card = (board: Board): GalleryCard => {
		const fromTask = taskThatWrote(tasks, board.path);
		const writtenBy = writerName(identities, board.lastWrittenBy);
		const changed = isNews(board, now);
		return {
			board,
			...(writtenBy ? { writtenBy } : {}),
			...(board.lastWrittenBy && identities[board.lastWrittenBy] ? { writerId: board.lastWrittenBy } : {}),
			...(fromTask ? { fromTask } : {}),
			changed,
			...(changed ? { changedAgo: agoLabel(actAt(board), now) } : {}),
		};
	};
	// Uncapped: the cap is applied here, after the unheld boards have joined the tail.
	const digests = workspaceDigests(boards, identities, contexts, Number.POSITIVE_INFINITY, now);
	const shelves = new Map<string, { agents: string[]; boards: Board[] }>();
	for (const digest of digests) {
		shelves.set(digest.name, {
			agents: digest.agents,
			boards: digest.boards.map((one) => byPath.get(one.path)).filter((one): one is Board => one !== undefined),
		});
	}
	const held = new Set(Object.values(contexts).flat());
	const unheld = boards.filter((board) => !held.has(board.path));
	if (unheld.length > 0) {
		const tail = shelves.get(WORKSPACE_NONE()) ?? { agents: [], boards: [] };
		for (const board of unheld) if (!tail.boards.some((one) => one.path === board.path)) tail.boards.push(board);
		shelves.set(WORKSPACE_NONE(), tail);
	}
	return [...shelves.entries()]
		.sort(([left], [right]) => {
			if (left === WORKSPACE_NONE()) return 1;
			if (right === WORKSPACE_NONE()) return -1;
			return left.localeCompare(right);
		})
		.map(([name, shelf]) => {
			const cards = shelf.boards
				.map(card)
				/* Newest act first, which is not the same as the newest file: a board an agent reported
				   was named later than it was last written, and it belongs at the top of its shelf. */
				.sort((a, b) => actAt(b.board) - actAt(a.board) || a.board.path.localeCompare(b.board.path));
			const real = name !== WORKSPACE_NONE();
			return {
				name,
				real,
				agents: shelf.agents,
				cards: cards.slice(0, cap),
				more: Math.max(0, cards.length - cap),
				changed: cards.filter((one) => one.changed).length,
				collapsed: !real,
			};
		})
		.filter((group) => group.cards.length > 0 || group.agents.length > 0)
		/* Nobody's boards fold away only when there is a real workspace above them to read
		   first. A deck with no workspaces yet is all tail, and a dashboard that opens on a
		   folded shelf and nothing else looks empty. */
		.map((group, _index, all) => ({ ...group, collapsed: group.collapsed && all.some((one) => one.real) }));
}

/** The three chips above the gallery. */
export type GalleryFilter = "all" | "changed" | "from-tasks";

/** The chips, then the search field — both narrow the same list. */
export function filterCards(cards: GalleryCard[], filter: GalleryFilter, query: string): GalleryCard[] {
	const needle = query.trim().toLowerCase();
	return cards.filter((card) => {
		if (filter === "changed" && !card.changed) return false;
		if (filter === "from-tasks" && !card.fromTask) return false;
		if (!needle) return true;
		return card.board.path.toLowerCase().includes(needle) || card.board.title.toLowerCase().includes(needle);
	});
}

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
