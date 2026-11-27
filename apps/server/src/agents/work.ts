import type { AgentKind, AgentMode, Camera, Identity, ThinkingLevel } from "@decks/protocol";

/**
 * Work between agents, as plain data: what one hands another, what is asked for when one is made,
 * what waits in a queue, and what an agent was holding at a moment in its conversation.
 */

/**
 * What one agent hands to another that already exists (the queue, not a spawn).
 *
 * No `model`: a delegation creates the agent it is about to run, so choosing its model is
 * part of creating it. A send lands in a conversation that is already somebody's, on
 * whatever model that conversation is having — changing it from outside would rewrite the
 * voice of a chat the user is reading. The same argument bars `kind`, `thinking` and
 * `mode`: they are all choices about how a piece of work is *created*, and a send creates
 * nothing.
 */
export interface SendSpec {
	task: string;
	/** Cards handed over: the receiver is given their source when the item runs. */
	cards?: string[];
	/**
	 * Tell the sender when the work is done.
	 *
	 * Off by default: most sends are genuinely *theirs* — you handed it over because you
	 * had nothing more to do with the answer, and a reply you did not ask for is an
	 * interruption. When set, the receiver's report is delivered to the sender as a notice
	 * in their transcript when the item runs — never as a queued task, because a task runs
	 * a turn of the sender's own, and a turn that answers a report with another report is
	 * two agents talking forever.
	 */
	reply?: boolean;
}

/**
 * A new agent made with no task, for a `send` to follow — `decks.create`.
 *
 * `delegate` makes an agent *and waits for it*, which is wrong for something that has to
 * hand work over and stop; `send` needs an agent that already exists. This is the gap
 * between them: an agent is made, idle, and the caller's next line is a send to it. It is
 * a peer, not a child: nobody is waiting for it, so it has no parent to report to.
 */
export interface CreateSpec {
	name: string;
	/** The workspace it opens in; the creator's when left out. */
	workspace?: string;
	/** What it is for, a few words each — set as its tags so the panel says so. */
	tags?: string[];
	kind?: AgentKind;
	/** `provider/model`. Left out, it opens on the creator's own model. */
	model?: string;
	thinking?: ThinkingLevel;
	mode?: AgentMode;
	/** Its home canvas, by folder name. */
	canvas?: string;
	/** With no `canvas`: give it a new, empty canvas of its own (`agent.create`). */
	newCanvas?: boolean;
}

/** One item waiting in an agent's queue. */
/** The sender of a hand-off the person made through the SDK, where an agent's id would go. */
export const PERSON = "person";

export interface QueuedWork {
	/** The agent that sent it, and what it was calling itself at the time. */
	from: string;
	fromName: string;
	task: string;
	cards: string[];
	at: number;
	/** The sender asked for the report back — see `SendSpec.reply`. */
	reply?: boolean;
	/** The person sent it, through the SDK: it reads as their message, with no report owed. */
	person?: true;
}

/**
 * What an agent was holding, showing and calling itself.
 *
 * Persisted by the shell rather than carried in the transcript (§6.2). Pi could ride it in
 * a tool result's `details` and rebuild from the session branch; the Claude SDK has no
 * equivalent — `structuredContent` looks like one but replaces the tool's own text — so
 * both runtimes now use one store and there is one code path to be wrong in.
 */
export interface CanvasSnapshot {
	context: string[];
	/** What was on the canvas — a set, so a rewind restores the whole view. */
	inPlay: string[];
	/**
	 * Where this canvas had put its cards, so a rewind restores the arrangement too.
	 *
	 * Optional, and the only member here that is: a snapshot written before this existed has no
	 * `positions`, and restoring one must leave the canvas to `arrange` rather than to nothing.
	 */
	positions?: Record<string, { x: number; y: number }>;
	camera: Camera;
	identity: Identity;
}
