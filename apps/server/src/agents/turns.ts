import type { AgentKind, AgentState, MessagePart, ServerMessage } from "@decks/protocol";
import type { LookingAt } from "./looking-at.ts";
import type { QueuedWork } from "./work.ts";
import { runtimeOf } from "../runtimes/registry.ts";

/**
 * An agent's turns: what it is asked to do, and in what order.
 *
 * Three lines of work wait here. What **you** queued with Ctrl+Enter while it was working goes
 * first, one message per turn, each as the turn before it ends. Work **another agent** handed over
 * waits behind that, for the agent to have been quiet a while, and runs a turn of its own. And an
 * agent that works **outside Decks** has no turn here at all: what is sent to it waits as its mail
 * until it asks (`inbox.ts`).
 */

/**
 * How long an agent must have been quiet before it starts on queued work.
 *
 * Ten seconds, because the number is not really about latency — it is about never running
 * a second thing while the first one is still settling. Long enough that a turn which has
 * just ended, a tool result still arriving, or a user halfway through typing gets there
 * first; short enough that a handover is not a thing you wait around for.
 */
function quietMs(): number {
	const configured = Number(process.env.DECKS_QUEUE_IDLE_MS);
	return Number.isFinite(configured) && configured > 0 ? configured : 10_000;
}

/**
 * How many items may be waiting for one agent.
 *
 * A legibility limit like `MAX_CHILDREN`, and for the same reason: eight tasks queued
 * against a chat is already more than anybody watching can follow, and the ninth is a sign
 * that the sender should have done the work or spawned somebody to.
 */
const QUEUE_LIMIT = 8;

/** The first line of a task, for a notice that has to fit on one. */
function firstLine(task: string): string {
	const line = task.trim().split("\n")[0] ?? "";
	return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/** What the turns need of the agent they are the turns of. */
export interface TurnsHost {
	readonly id: string;
	readonly kind: AgentKind;
	emit(message: ServerMessage): void;
	name(): string;
	state(): AgentState;
	/** Say a message to the agent, as a turn (`DeckAgent.prompt`). */
	prompt(text: string, parts?: MessagePart[], at?: LookingAt): Promise<void>;
	/** Run one turn of handed-over work to its end, and answer its report (`DeckAgent.run`). */
	run(text: string): Promise<{ report: string; boards: string[] }>;
	/** A line in the conversation that is nobody's message. */
	notice(level: "info" | "warn" | "error", text: string): void;
	/** The briefing a handed-over task is run with, composed when it runs (`Registry`). */
	brief(task: string, boards: string[], person?: boolean): string;
	/** Deliver a finished item's report to the agent that asked for it, as a notice. */
	report(agentId: string, text: string): void;
	/** Set for an agent that works outside Decks: the app it runs in. */
	outside(): { client: string } | undefined;
	/** An outside agent's mail changed: its row counts what waits, and its record keeps it. */
	mailChanged(): void;
}

export class Turns {
	/**
	 * Work another agent handed over, waiting for this one to be quiet.
	 *
	 * Beside `pending` rather than in it, because they are different things arriving by
	 * different routes. A nudge is a *fact* about a board that rides along with whatever the
	 * user says next and never wakes anybody; an item here is a *task*, and it runs a turn of
	 * its own once nothing else is happening. Sharing one list would have meant either a task
	 * that waits forever for a user who has gone to lunch, or a board edit that starts a turn
	 * nobody asked for.
	 */
	private work: QueuedWork[] = [];
	/**
	 * The quiet period before the queue is drained.
	 *
	 * Armed on the way into `idle` and cancelled on the way out, so it measures *silence*
	 * rather than elapsed time: an agent that is thinking, streaming, running a tool, or —
	 * the case that matters — `waiting` on a question it asked the user is not idle, and the
	 * timer cannot fire under any of them.
	 */
	private drainTimer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * What you queued with Ctrl+Enter while the agent was working, oldest first: sent one per turn,
	 * each as the turn before it ends, and before any work another agent handed over. `mineHeld` is
	 * Stop's: a stopped turn holds the queue until you send it.
	 */
	private mine: Array<{ id: string; text: string; parts?: MessagePart[]; /** What the person was looking at when they wrote it, kept until it is sent. */ at?: LookingAt }> = [];
	private mineHeld = false;

	constructor(
		private readonly of: TurnsHost,
		/** An outside agent's mail, as its record kept it. */
		mail: readonly QueuedWork[] = [],
	) {
		this.work.push(...mail);
	}

	/** Take every waiting item, for an outside agent reading its mail. */
	takeAll(): QueuedWork[] {
		return this.work.splice(0);
	}

	/** Leave an item to wait with no turn to follow and nothing said: the person's own words to an outside agent. */
	leave(item: QueuedWork): void {
		this.work.push(item);
	}

	/** The agent went quiet: your queue first, at once; then, after the quiet period, work handed over. */
	wentIdle(): void {
		if (!this.sendNextMine()) this.armDrain();
	}

	/** The agent is working, or waiting on an answer: no handed-over work starts under that. */
	wentBusy(): void {
		this.cancelDrain();
	}

	/** Stop was pressed: now is not the moment for more work, and your queue waits for you. */
	stopped(): void {
		this.cancelDrain();
		if (this.mine.length > 0 && !this.mineHeld) {
			this.mineHeld = true;
			this.sayMine();
		}
	}

	/** The agent is going: nothing waits to start any more. */
	dispose(): void {
		this.cancelDrain();
	}

	/** What a new browser needs of the queue: your messages waiting, which no row carries. */
	greet(reply: (message: ServerMessage) => void): void {
		if (this.mine.length > 0) reply({ type: "agent.queued", agentId: this.of.id, items: this.mine.map((one) => ({ ...one })), held: this.mineHeld });
	}

	// --- work handed over by another agent -------------------------------------------

	/**
	 * Take an item into this agent's queue, and say so where the user can see it.
	 *
	 * The notice is not decoration. A queue that fills silently and then starts a turn on its
	 * own is a chat that appears to talk to itself, and the first time it happens the honest
	 * reading is that something is broken — so the arrival is in the transcript at the moment
	 * it arrives, named with who sent it, and the work itself lands as an ordinary message
	 * when it runs.
	 *
	 * Returns the position it landed at: an agent that queued something behind five other
	 * items should know that before it decides to wait.
	 */
	enqueue(item: QueuedWork): number {
		if (this.work.length >= QUEUE_LIMIT) {
			throw new Error(`${this.of.name()} already has ${QUEUE_LIMIT} items waiting; nothing was queued.`);
		}
		this.work.push(item);
		this.of.notice("info", `${item.fromName} queued work for you: ${firstLine(item.task)}`);
		// An outside agent's inbox is part of its record, and its row counts what waits.
		if (this.of.outside()) this.of.mailChanged();
		// Nothing is started here. A dormant chat stays dormant until its item actually runs,
		// and `prompt()` already opens with `await this.start()` — waking a runtime at queue
		// time would mean a restored chat with something waiting behind six other items holds
		// a model process open for as long as the queue is long.
		this.armDrain();
		return this.work.length;
	}

	/**
	 * Work handed over to be read now (`agent.send`), not after the turn running.
	 *
	 * Idle (or dormant), it starts a turn of its own. Mid-turn, it goes into that turn where the
	 * runtime can take a message there (`capabilities.steers`): Pi and opencode 2 steer the turn, and Claude's
	 * stream and opencode 1's running loop take the message at the turn's next step. Antigravity has
	 * no way in mid-turn, so the work is queued, as `agent.queue` would, and the answer says so.
	 */
	deliver(item: QueuedWork): { delivered: boolean; turn: "running" | "new" | "queued"; position?: number; note?: string } {
		if (this.of.outside()) {
			const position = this.enqueue(item);
			return { delivered: false, turn: "queued", position, note: `${this.of.name()} works in ${this.of.outside()!.client}, outside Decks, so Decks cannot start a turn for it: the message waits in its inbox and reaches it with its next call.` };
		}
		const text = this.of.brief(item.task, item.boards, item.person);
		// The person's message is theirs, as if typed in the chat; an agent's says who it is from.
		const sent = item.person ? text : `${item.fromName} sent you this, to act on now:\n\n${text}`;
		if (this.of.state() === "idle") {
			if (!item.person) this.of.notice("info", `${item.fromName} sent you work, now: ${firstLine(item.task)}`);
			void this.of.prompt(sent);
			return { delivered: true, turn: "new" };
		}
		// Whether the runtime takes a message mid-turn, and when, is the runtime's to say (`capabilities.steers`).
		const steers = runtimeOf(this.of.kind).capabilities.steers;
		if (steers) {
			if (!item.person) this.of.notice("info", `${item.fromName} sent you work, into this turn: ${firstLine(item.task)}`);
			void this.of.prompt(sent);
			return { delivered: true, turn: "running", ...(steers === "next-step" ? { note: `${this.of.kind} takes a message mid-turn at its next step, after the model call or tool call it is in.` } : {}) };
		}
		const position = this.enqueue(item);
		return { delivered: false, turn: "queued", position, note: `${this.of.kind} cannot take a message in the middle of a turn, so it waits in ${this.of.name()}'s queue (position ${position}) and runs when this turn ends.` };
	}

	/** What is waiting, oldest first. A copy: the queue is drained here and nowhere else. */
	queue(): QueuedWork[] {
		return [...this.work];
	}

	/** How much is waiting, for the chat list and for `decks.agent.list()`. */
	get queued(): number {
		return this.work.length;
	}

	// --- what you queued yourself (Ctrl+Enter) ------------------------------------------

	/** Queue a message for when this turn ends; with no turn running, it is simply sent. */
	/** The person's own messages waiting for this turn to end, and whether Stop is holding them. */
	queuedMine(): { items: Array<{ id: string; text: string }>; held: boolean } {
		return { items: this.mine.map((one) => ({ id: one.id, text: one.text })), held: this.mineHeld };
	}

	queueMine(text: string, parts?: MessagePart[], at?: LookingAt): void {
		const said = text.trim();
		if (!said) return;
		if (this.of.state() === "idle" && this.mine.length === 0) {
			void this.of.prompt(said, parts, at);
			return;
		}
		this.mine.push({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: said, ...(parts?.length ? { parts } : {}), ...(at ? { at } : {}) });
		this.sayMine();
	}

	unqueueMine(item: string): void {
		const before = this.mine.length;
		this.mine = this.mine.filter((one) => one.id !== item);
		if (this.mine.length === 0) this.mineHeld = false;
		if (this.mine.length !== before) this.sayMine();
	}

	/** One queued message, now: a steer of the turn running, or a turn of its own if none is. */
	sendMineNow(item: string): void {
		const found = this.mine.find((one) => one.id === item);
		if (!found) return;
		this.unqueueMine(item);
		void this.of.prompt(found.text, found.parts, found.at);
	}

	/** A queue Stop held, let go: the next message goes now if nothing is running. */
	releaseMine(): void {
		this.mineHeld = false;
		this.sayMine();
		if (this.of.state() === "idle") this.sendNextMine();
	}

	/** Send the next queued message, if there is one and Stop is not holding them. Says whether it did. */
	private sendNextMine(): boolean {
		if (this.mineHeld || this.mine.length === 0) return false;
		const next = this.mine.shift()!;
		this.sayMine();
		void this.of.prompt(next.text, next.parts, next.at);
		return true;
	}

	private sayMine(): void {
		this.of.emit({ type: "agent.queued", agentId: this.of.id, items: this.mine.map((one) => ({ id: one.id, text: one.text })), held: this.mineHeld });
	}

	private armDrain(): void {
		// An outside agent takes its own mail (`takeNews`): there is no turn here to run it in.
		if (this.of.outside()) return;
		// Work handed over waits behind what you queued yourself.
		if (this.mine.length > 0 && !this.mineHeld) return;
		if (this.drainTimer || this.work.length === 0 || this.of.state() !== "idle") return;
		this.drainTimer = setTimeout(() => {
			this.drainTimer = undefined;
			void this.drain();
		}, quietMs());
		// So a queue waiting to drain never holds the process open — a server with nothing
		// else to do should still be able to exit, and a test should not hang for ten seconds.
		this.drainTimer.unref?.();
	}

	private cancelDrain(): void {
		if (this.drainTimer) clearTimeout(this.drainTimer);
		this.drainTimer = undefined;
	}

	/**
	 * Run one item, then let the state hook decide whether to run another.
	 *
	 * Popped *before* it runs, not after: an item that fails, or a turn the user aborts
	 * halfway, must not come back round and be tried again forever. One item at a time, and
	 * the re-arm rides on the return to idle, so a drain can never overlap a turn.
	 */
	private async drain(): Promise<void> {
		if (this.of.state() !== "idle") return;
		const item = this.work.shift();
		if (!item) return;
		try {
			const result = await this.of.run(this.of.brief(item.task, item.boards, item.person));
			// A report the sender asked for is delivered to them as a notice, not as a queued
			// task. The distinction is the whole of the no-loop rule: an item in a queue runs a
			// turn when it drains, and a turn that answers a report with another report is two
			// agents talking forever. A notice lands in the sender's transcript and is read on
			// their next turn instead.
			if (item.reply) {
				const report = result.report.trim();
				if (report) this.of.report(item.from, `${this.of.name()} finished "${firstLine(item.task)}": ${report}`);
			}
		} catch (error) {
			this.of.notice("error", `Queued work from ${item.fromName} failed: ${(error as Error).message}`);
		}
		// Belt and braces: the state hook re-arms on the way back to idle, but a turn that
		// never moved the state at all (a backend that failed to start) would otherwise leave
		// the rest of the queue stranded.
		this.armDrain();
	}
}
