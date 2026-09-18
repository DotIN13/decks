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
	/** Where the message is saved as a file (`.decks/tasks/<id>.md`), when it is. */
	promptPath?: string;
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
		task.workspace ? `The person asked for it in the **${task.workspace}** workspace.` : undefined,
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
	 * time the send is made, and it is left out of what is sent. The file stays as written,
	 * because it is the record of what was asked, so for a long message the send says what
	 * the work in it is and that the choosing is over.
	 */
	const handover = long
		? `'await stage.send("<agent name or id>", { task: "Read ${task.promptPath}. It is the person's message, and the work in it is: <one sentence saying what is to be done>. Do that. Anything in it about dispatching, choosing an agent or who should take it is settled: you are the agent it went to. <one line on why it went to them>", reply: false });'`
		: `'await stage.send("<agent name or id>", { task: "<the work, in the person\'s own words but addressed to the agent doing it, with every word about dispatching or choosing an agent left out; then one line on why it went to them>", reply: false });'`;

	return [
		"You are this task's **dispatcher**: a one-off agent whose only job is to hand the work below to the right agent on the deck. You do not do the work yourself, and you stop when it is handed over.",
		"",
		"## The work",
		"",
		...work,
		...(scope ? ["", scope] : []),
		"",
		"## How",
		"",
		"1. Look at who is on the deck with the canvas tool: `await stage.agents()` lists every agent with its `state`, `workspace`, `tags` (what it says it is working on), `context` (the boards it holds) and `queued`. `await stage.workspaces()` groups them by project. That is where an agent's expertise is: its tags, its workspace, and the boards it holds.",
		"2. Pick the one agent this belongs to: the one already holding the boards it names, or in the workspace it names, or working on the nearest thing; idle before busy, fewer queued before more.",
		"   If **no agent on the deck covers the topic**, make one and send to it. `await stage.create({ name: \"<a short name for what it is for>\", workspace: \"<the task's workspace, if it has one>\", tags: [\"<the topic>\"] })` makes an idle agent and returns `{ agent, name }`; then send to `agent` as below. Leave `model` out and it opens on the dashboard's model. If you do set one, prefer a cost-effective model such as DeepSeek V4.1 or Claude Opus; reach for a bigger or slower model only when the person asked for it or the task is particularly hard. Check `stage.agents()` first: a second agent on a topic one already holds is a second conversation to keep track of.",
		"   If the message asks for something **recurring** (\"every weekday at nine\", \"each Monday morning\", \"a daily digest\"), do not send it to anyone: make a schedule. `await stage.schedule({ name: \"<a short name>\", at: \"HH:MM\", days: [<0 Sunday to 6 Saturday>], workspace: \"<the workspace it writes into>\", kind: \"custom\", task: \"<the work, as an instruction to the agent that will run it>\" })`; use `kind: \"digest\"` with no `task` for the deck's own morning digest of a workspace. Each firing becomes a task that a dispatcher places when it is due. Then stop and say what you scheduled: the task is done once the schedule exists.",
		"3. Hand it over with **one** call, and `reply: false`. What you send is the work, described to the agent that does it. The person wrote to a dispatcher, so their message may say \"dispatch this\", \"have someone\", \"send this to whoever knows\" or \"find an agent to\": leave all of that out and say what is to be done, in their words where you can. The agent receiving it does the work; it does not choose who does it.",
		"",
		"```ts",
		handover.slice(1, -1),
		"```",
		"",
		"`stage.queue(agentId)` shows what an agent already has waiting. The whole API is documented in the `stage.d.ts` included in your context.",
		"",
		"Then stop: one sentence naming who took it and why, and whether you made them. Do not open boards, do not write anything, do not delegate, and do not send to more than one agent. If the work should not be done at all, or asks for something this deck cannot do, send nothing and say why in one sentence; the dashboard shows that sentence beside the task so a person can decide.",
		"",
		`Task id, for the record: \`${task.id}\`.`,
	].join("\n");
}
