import { Refused, events, type Infer, type shapes } from "../../protocol/index.ts";
import type { Context } from "../kernel/types.ts";
import type { Message } from "./mail.ts";
import { changesSince } from "./news.ts";
import type { People } from "./state.ts";

// How a message reaches an agent: to its connected host at once, which delivers it into a
// turn, or in the agent's next news, which brings the waiting mail with the canvas's changes.

type Work = { task: string; cards?: string[]; reply?: boolean };

/** send: to the host at once when one holds the agent. queue: always into the inbox. */
export async function deliver(people: People, ctx: Context, asked: string, work: Work, how: "send" | "queue"): Promise<Message> {
	const to = people.roster.find(asked);
	if (!work.task.trim()) throw new Refused("invalid", "A message needs a task: what to do.", `agent.${how}`);
	const message = people.mail.make(ctx.caller.name, to.id, work);
	const host = people.hosts.has(to.host) ? to.host : undefined;
	if (how === "send" && host) {
		const delivered = { ...message, state: "delivered" as const };
		people.tell(ctx, events.agentMailed, { ids: [to.id], message: delivered }, [host]);
		return delivered;
	}
	const kept = await people.mail.keep(message);
	if (host) people.tell(ctx, events.agentMailed, { ids: [to.id], message: kept }, [host]);
	else if (how === "send") ctx.note(`No harness holds ${to.name} now, so the message waits in its inbox.`);
	people.tell(ctx, events.agentChanged, { ids: [to.id], ...(to.state ? { state: to.state } : {}) });
	return kept;
}

/** What changed on the caller's canvas since its last ask, and its mail; the mark moves on. */
export async function takeNews(people: People, ctx: Context, asked: string | undefined): Promise<Infer<typeof shapes.News>> {
	const self = people.self(ctx);
	const canvas = asked ?? ctx.caller.canvas ?? self.canvas;
	let rev = 0;
	let changes: Infer<typeof shapes.News>["changes"] = [];
	if (canvas) {
		const mark = people.marks.mark(self.id, canvas);
		const since = changesSince(ctx.canvas(canvas), canvas, mark, self.id);
		changes = since.changes;
		rev = since.rev;
		if (since.rev !== mark) await people.marks.move(self.id, canvas, since.rev);
	}
	const mail = await people.mail.take(self.id);
	if (mail.length) people.tell(ctx, events.agentChanged, { ids: [self.id] });
	return { rev, changes, mail };
}
