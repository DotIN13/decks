import type { AgentBackendContext } from "../../agents/backend.ts";
import { isStaleSession } from "./stale-session.ts";
import { isTransientAuthFailure, MAX_TRANSIENT_RETRIES, retryDelayMs } from "./transient.ts";

/**
 * What a Claude agent does when a turn ends and the turn was not the whole story.
 *
 * Four things can ask for the query to be opened again, and they used to be four fields the
 * message loop checked in a row, in an order nobody wrote down: the session to resume was not
 * in this account's store (`stale-session.ts`), the login was busy being refreshed by another
 * process (`transient.ts`), the agent was moved to another account mid-turn, and a sign-in
 * landed mid-turn. Each was safe alone; two at once could start two restarts racing for the
 * same query. `afterTurn` reads all four and answers **one** action, so the order is written
 * here and a fifth reason has one place to go.
 *
 * - A stale session wins: it opens a fresh session, which is also on the agent's current
 *   account and lists the models anew, so it covers a pending account move or sign-in.
 * - Otherwise an account move or a sign-in resumes the same session in a new process; a busy
 *   login's retry still goes, into the new process.
 * - Otherwise a busy login is asked again after a wait.
 */
export type RecoveryAction =
	/** Forget the session, open a fresh one and ask this again in it. */
	| { kind: "fresh"; ask: string }
	/** Start the process again on the same session; and ask something again after a wait. */
	| { kind: "resume"; ask?: { text: string; after: number } }
	/** Ask the same thing again after a wait, in the same process. */
	| { kind: "ask"; text: string; after: number };

export class ClaudeRecovery {
	/** A switch arrived mid-turn on macOS: start again on the new account when the turn ends. */
	private accountMoved = false;
	/** A sign-in landed during a turn: start again after it, so the models are read for the new login. */
	private signInLanded = false;
	/** Who is waiting for the sign-in restart, told by `restarted`. */
	private signInWaiting: Array<() => void> = [];
	/** How many times this turn has been retried past a busy login (`transient.ts`). */
	private transientTries = 0;
	/**
	 * How many times this turn has been asked again after the session it was told to resume
	 * turned out not to be in this account's store (`stale-session.ts`). One, deliberately: a
	 * second restart would mean the fresh session is missing too, and that is a sentence for a
	 * person rather than another attempt.
	 */
	private staleTries = 0;

	constructor(
		private readonly context: Pick<AgentBackendContext, "translator" | "notice" | "historyChanged">,
		/** Whether the process was started on an account other than the one the agent is on now. */
		private readonly onOtherAccount: () => boolean,
	) {}

	/** The agent moved to another account during a turn; the restart waits for it to end. */
	accountMovedMidTurn(): void {
		this.accountMoved = true;
	}

	/** A sign-in landed during a turn; resolves once the restart after it has read the models. */
	signInMidTurn(): Promise<void> {
		this.signInLanded = true;
		return new Promise((resolve) => this.signInWaiting.push(resolve));
	}

	/** A restart this class asked for is done: whoever waited on a sign-in hears it. */
	restarted(): void {
		const waiting = this.signInWaiting;
		this.signInWaiting = [];
		for (const resolve of waiting) resolve();
	}

	/** A turn ended, and `said` was its reply: what, if anything, to do about it. */
	afterTurn(said: string | undefined): RecoveryAction | undefined {
		const stale = this.stale(said);
		// A turn the stale-session path took over is not also a busy login's.
		if (stale.handled) this.transientTries = 0;
		const ask = stale.handled ? undefined : this.transient();
		const moved = this.accountMoved && this.onOtherAccount();
		const restart = moved || this.signInLanded;
		this.accountMoved = false;
		this.signInLanded = false;
		if (stale.ask !== undefined) return { kind: "fresh", ask: stale.ask };
		if (restart) return { kind: "resume", ...(ask ? { ask } : {}) };
		return ask ? { kind: "ask", ...ask } : undefined;
	}

	/**
	 * The query failed outright. Only a stale session is recoverable from here: answers whether
	 * this class took the failure over, and the fresh start to make when there is one.
	 */
	afterFailure(message: string): { handled: boolean; action?: RecoveryAction } {
		const stale = this.stale(message);
		return { handled: stale.handled, ...(stale.ask !== undefined ? { action: { kind: "fresh", ask: stale.ask } } : {}) };
	}

	/**
	 * A turn that was not an answer: try it again rather than leaving it as one.
	 *
	 * Several Claude Code processes on one machine share one credentials file, and when a
	 * token comes due they all want it refreshed at once. The CLI serialises that with a
	 * lock and tells the losers to come back — and with six agents open that is five turns
	 * lost to a sentence the CLI itself calls transient. Worse, the SDK reports the turn as
	 * a *success* whose content is that sentence, so it lands as the assistant's reply and
	 * the person watching has to read it and press send again.
	 *
	 * Three conditions, and all three are needed:
	 *
	 * - the reply **is** the failure (`transient.ts`, which matches on prose because there
	 *   is nothing structural to match on, and says so);
	 * - the turn **did nothing** — no tool call, no card write. Decks agents edit files, and
	 *   replaying a turn that got halfway could write the same card twice. The rate-limit
	 *   path used to resend under the same guard; it does not resend at all now;
	 * - there are retries left, so a refresh that is genuinely stuck ends in the message
	 *   standing rather than in a turn that never finishes.
	 *
	 * The old reply is taken back before the new attempt, so what the person sees is one
	 * line saying the login is busy and then the answer — rather than an error, an error,
	 * and an answer. Answers what to ask again, and after how long, or nothing.
	 */
	private transient(): { text: string; after: number } | undefined {
		const { translator, notice } = this.context;
		if (!isTransientAuthFailure(translator.lastAssistantText())) {
			this.transientTries = 0;
			return undefined;
		}
		if (translator.turnTouchedAnything()) return undefined;
		const again = translator.lastUserText();
		if (!again) return undefined;

		if (this.transientTries >= MAX_TRANSIENT_RETRIES) {
			this.transientTries = 0;
			notice("error", "Another Claude Code process is still refreshing this login. Send that again in a minute, or close some agents.");
			return undefined;
		}

		const attempt = ++this.transientTries;
		const wait = retryDelayMs(attempt);
		translator.dropLastAssistant();
		this.context.historyChanged?.();
		notice("warn", `Another Claude Code process is refreshing this login. Trying again in ${Math.round(wait / 1000)}s.`);
		return { text: again, after: wait };
	}

	/**
	 * A turn that failed because the session it was told to resume is not in this account's
	 * store. Asked again once, in a fresh session.
	 *
	 * The id can be right and the store still be the wrong one, with nothing about the person,
	 * the deck or the task at fault: `--resume` is looked up inside the config directory the
	 * process is handed (`claude/accounts.ts`), and that directory can have moved under a
	 * stored id. It did here: the id was written before the per-agent link existed, the account
	 * it ended up on kept a private `projects/` instead of the shared store, and the session was
	 * in the 53 transcripts that copy did not have. The morning's scheduled task ended as
	 * `error_during_execution` with a session id quoted back at somebody who could do nothing
	 * with it. `stale-session.ts` says why this reads prose rather than a field.
	 *
	 * What starting fresh costs is the conversation's memory of itself, and that was already
	 * the cost — the memory is unreachable either way, and this way the work still happens.
	 *
	 * Answers whether it took the failure over, so the caller does not also report a stop, and
	 * what to ask again in a fresh session when there is something.
	 */
	private stale(said: string | undefined): { handled: boolean; ask?: string } {
		const { translator, notice } = this.context;
		if (!isStaleSession(said)) {
			this.staleTries = 0;
			return { handled: false };
		}
		/*
		 * A turn that already changed a card is not repeated — the rule the busy-login retry
		 * follows too. Here it also means the failure stands: the turn did something, so "ask it
		 * again in a fresh session" is not a repair, it is a second attempt at work already done.
		 */
		const again = translator.turnTouchedAnything() ? undefined : translator.lastUserText();
		if (!again) return { handled: false };
		if (this.staleTries >= 1) {
			this.staleTries = 0;
			notice(
				"error",
				"Claude cannot find this conversation's session in this account's transcript store, so this turn cannot be asked again. Send it once more and it starts a fresh conversation.",
			);
			return { handled: true };
		}
		this.staleTries += 1;
		notice("warn", "Claude cannot find this conversation's session in this account's transcript store, so it starts a fresh one and asks again.");
		// The reply is not an answer, and leaving it in the transcript is what made this read
		// as a result rather than a failure.
		translator.dropLastAssistant();
		this.context.historyChanged?.();
		return { handled: true, ask: again };
	}
}
