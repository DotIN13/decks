/**
 * What a task's dispatcher is told: the work, and how to hand it over.
 *
 * A dispatcher is a one-off agent spawned for one task. It is not handed the roster —
 * it has the canvas tool like every agent, and `stage.agents()` is the live answer to
 * who is on the deck, what they are working on (their tags and workspace) and what they
 * hold. So the brief says what to look up and where the API is documented, states the
 * one call that places the work, and stops. Pure, so a test can read what the model
 * is told.
 */

export interface DispatchBriefTask {
	id: string;
	text: string;
	boards: string[];
	workspace?: string;
	/** The name of the canvas the work is for, when it was asked from one. */
	canvasName?: string;
	/** Where the message is saved as a file (`.decks/tasks/<id>.md`), when it is. */
	promptPath?: string;
	/** The name of the cron job that started this task, when one did rather than a person. */
	schedule?: string;
	/** The time in the person's zone, as a sentence (`nowWords`). Passed in, so this stays pure. */
	now?: string;
}

/** A message longer than this, or with more lines, is pointed at rather than quoted. */
export const LONG_MESSAGE_CHARS = 600;
export const LONG_MESSAGE_LINES = 8;

export function isLongMessage(text: string): boolean {
	return text.length > LONG_MESSAGE_CHARS || text.split("\n").length > LONG_MESSAGE_LINES;
}

function firstLine(text: string, max = 160): string {
	const line = text.trim().split("\n").find((one) => one.trim()) ?? "";
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function dispatcherBrief(task: DispatchBriefTask): string {
	const scope = [
		task.schedule
			? `The cron job \`${task.schedule}\` started this task${task.workspace ? ` in the **${task.workspace}** workspace` : ""}.`
			: task.workspace
				? `The person asked for it in the **${task.workspace}** workspace.`
				: undefined,
		/*
		 * The canvas it was asked from. Whoever takes the work is moved onto it before they
		 * start, so their boards land where the person is looking — which makes an agent that
		 * is already there the better choice, because it has read what is on it.
		 */
		task.canvasName
			? `It was asked for on the **${task.canvasName}** canvas. Prefer an agent already working there (the \`workspace\` field of \`stage.agents()\`); whoever you send it to will work on that canvas.`
			: undefined,
		task.boards.length > 0 ? `It names these boards: ${task.boards.map((path) => `\`${path}\``).join(", ")}.` : undefined,
	]
		.filter(Boolean)
		.join(" ");

	/*
	 * A short message is quoted, so the dispatcher reads it without a tool call. A long
	 * one (a pasted document, a page of notes) is pointed at: the file is the message, the
	 * dispatcher reads it there, and hands the *path* on so the agent that does the work
	 * reads the whole thing rather than a copy squeezed into a queue item.
	 */
	const long = task.promptPath !== undefined && isLongMessage(task.text);
	const work = long
		? [
				`The person's message is long, so it is saved as a file: \`${task.promptPath}\`. Read it with the canvas tool or your file tools before deciding. It begins:`,
				"",
				`> ${firstLine(task.text)}`,
			]
		: [`> ${task.text.split("\n").join("\n> ")}`, ...(task.promptPath ? ["", `It is also saved at \`${task.promptPath}\`.`] : [])];
	/*
	 * The person wrote to a dispatcher, so their message may be about dispatching: "have
	 * someone", "send this to whoever knows the panel", "find an agent to". The agent that
	 * receives the work is doing it, not choosing who does; that framing is settled by the
	 * time the send is made, and it is left out of what is sent. For a long message the
	 * dispatcher takes it out of the prompt file too (step 3, and the stop rule's one
	 * exception), and the send still says what the work is and that the choosing is over,
	 * in case a phrase was missed.
	 */
	const handover = long
		? `'await stage.send("<agent name or id>", { task: "Read ${task.promptPath}. It is the person's message, and the work in it is: <one sentence saying what is to be done>. Do that. Anything in it about dispatching, choosing an agent or who should take it is settled: you are the agent it went to. <one line on why it went to them>", reply: false });'`
		: `'await stage.send("<agent name or id>", { task: "<the work, in the person\'s own words but addressed to the agent doing it, with every word about dispatching or choosing an agent left out; then one line on why it went to them>", reply: false });'`;

	/*
	 * The fork comes first and each path is numbered on its own. When the schedule was a
	 * paragraph inside step 2 it ended in "stop" with a step 3 still below it, and a
	 * model following numbers goes on to the next number: a send after a schedule is not
	 * refused, only a second send is.
	 *
	 * A task a cron job made gets no fork at all. The schedule that made it usually
	 * carries its own recurring words ("each morning, find the papers"), and a dispatcher
	 * offered branch A reads them as a request and enlists a second cron — every firing
	 * of which enlists a third. So for these tasks the brief says the schedule already
	 * exists and points only at the hand-over; the registry refuses `stage.schedule`
	 * during such a turn too, in case the sentence is missed.
	 */
	const fork = task.schedule
		? [
				`This task is one firing of the cron job \`${task.schedule}\`: the schedule already exists and will fire again on its own. Recurring words in the message ("each morning", "every day") are that job's own text, not a request for a schedule — do not call \`stage.schedule\`, which would enlist a second cron doing the same work. Place this one run:`,
			]
		: [
				"First decide which of two things this is.",
				"",
				"**A. Something recurring** (\"every weekday at nine\", \"each Monday morning\", \"a daily digest\"): make a schedule with `await stage.schedule()` and send it to nobody. Each firing becomes a task that a dispatcher places when it is due. When done, stop and say what you scheduled.",
				"",
				"**B. Anything else:**",
			];

	return [
		"You are the **dispatcher**: your job is to hand the work below to the right agent on the deck. You do not do the work yourself, and you stop when it is handed over.",
		"",
		// Every agent is given the deck's standing instructions, which describe agents that
		// answer on boards. Said once, here, which of the two wins for this turn.
		"The rest of your instructions describe agents that answer on boards. You are not one of them for this task: you write no board, set no name, tags or workspace, and your whole answer is the one sentence at the end.",
		"",
		"## The work",
		"",
		...work,
		...(scope ? ["", scope] : []),
		...(task.now ? ["", `It is now ${task.now}. A time of day in the message is in that timezone, and so is a schedule you make unless you pass \`timezone\`.`] : []),
		"",
		"## How",
		"",
		...fork,
		"",
		"1. Use `await stage.agents()` and `await stage.canvases()` to search for the best candidate to run this task; both take `{ filter: { workspace } }` to narrow to one project. Beware of long agent lists.",
		"2. Pick the one agent this belongs to: the one already holding the boards it names, or in the workspace it names, or working on the nearest thing; idle before busy, fewer queued before more.",
		"   If **no agent on the deck covers the topic**, make one by sending to a shape, `await stage.send({ name, kind }, { task })`. Leave `model` out, so it opens on the model chosen in the dashboard's bar; name a bigger one only when the person asked for it or the task is particularly hard.",
		"3. Hand over the work using `reply: false`. The message you received was written to a dispatcher, so it may say \"dispatch this\", \"have someone\", \"send this to whoever knows\" or \"schedule every morning\": remove all of that from the message or the prompt file when you hand off.",
		"",
		"```ts",
		handover.slice(1, -1),
		"```",
		"",
		"`stage.queue(agentId)` shows what an agent already has waiting. The whole API is documented in the `stage.d.ts` included in your context.",
		"",
		"Then stop: one sentence naming who took it and why, and whether you made them. Do not open boards, do not delegate, and do not send to more than one agent. The one thing you may write is the prompt file, and only to take the words about dispatching out of it. If the work should not be done at all, or asks for something this deck cannot do, send nothing and say why in one sentence; the dashboard shows that sentence beside the task so a person can decide.",
		"",
		`Task id, for the record: \`${task.id}\`.`,
	].join("\n");
}
