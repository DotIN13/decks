import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Which agents are in the middle of a turn, written down so a restart knows whose turn it ended.
 *
 * A server that stops (an update, a crash, a full heap) takes every running turn with it, and until
 * now each of those agents then sat idle until someone noticed and told it to go on. The log is one
 * small file, `<deck>/.decks/working.json`: an agent is put in when its turn starts and taken out
 * when it ends, each change written at once, since the stop that matters gives no warning. What the
 * file holds when the deck opens is the turns the last stop cut (`interrupted`); the registry starts
 * those agents again with a line that says what happened (`resumeNote`).
 *
 * One guard: an agent whose turn is cut again within `LOOP_MS` of being started again is left for
 * the person, so a turn that is itself what brings the server down cannot do it for ever.
 */
export interface Working {
	/** When the turn started. */
	since: number;
	/** When this turn was started again after a restart, if it was. */
	resumed?: number;
}

/** A turn cut this soon after being resumed is not resumed a second time. */
export const LOOP_MS = 3 * 60_000;

export class WorkingLog {
	private now: Record<string, Working> = {};
	private closed = false;
	/** The turns the last stop cut, by agent: read once, when the deck opens. */
	readonly interrupted: Record<string, Working>;

	constructor(private readonly file: string) {
		this.interrupted = read(file);
		// A fresh start has nobody working. Written only when the file said otherwise.
		if (Object.keys(this.interrupted).length > 0) this.write();
	}

	/** An agent's turn started (`true`) or ended (`false`). */
	set(id: string, working: boolean, resumed?: number): void {
		if (this.closed) return;
		if (working === (id in this.now) && resumed === undefined) return;
		if (working) this.now[id] = { since: this.now[id]?.since ?? Date.now(), ...(resumed ? { resumed } : this.now[id]?.resumed ? { resumed: this.now[id].resumed } : {}) };
		else delete this.now[id];
		this.write();
	}

	/**
	 * The agents to start again, of those the last stop cut: every one except a turn that had itself
	 * just been resumed (the guard above). `at` is when the cut was noticed: now.
	 */
	toResume(at: number = Date.now()): Array<{ id: string; since: number }> {
		return Object.entries(this.interrupted)
			.filter(([, one]) => !(one.resumed && at - one.resumed < LOOP_MS))
			.map(([id, one]) => ({ id, since: one.since }));
	}

	/** The server is stopping: what is written stays as it is, whatever the dying runtimes report. */
	close(): void {
		this.closed = true;
	}

	private write(): void {
		try {
			mkdirSync(dirname(this.file), { recursive: true });
			writeFileSync(this.file, `${JSON.stringify(this.now)}\n`);
		} catch {
			// A deck that cannot be written to has larger problems; resuming is a convenience.
		}
	}
}

function read(file: string): Record<string, Working> {
	try {
		const saved = JSON.parse(readFileSync(file, "utf8")) as unknown;
		if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
		const kept: Record<string, Working> = {};
		for (const [id, one] of Object.entries(saved as Record<string, Partial<Working>>)) {
			if (one && typeof one.since === "number") kept[id] = { since: one.since, ...(typeof one.resumed === "number" ? { resumed: one.resumed } : {}) };
		}
		return kept;
	} catch {
		return {};
	}
}

const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** What an agent is told when its turn is started again. Not a slash command, and one paragraph. */
export function resumeNote(since: number, now: number = Date.now()): string {
	return `[From Decks, not the person] Decks restarted at ${clock(now)} and that ended the turn you began at ${clock(since)}. Nobody has written to you since. Go on from where you stopped: what you had saved is still there, a command that was running was stopped with the turn (check what it left before running it again), and anything you started in the background may be gone. If you had finished, say so in a line.`;
}
