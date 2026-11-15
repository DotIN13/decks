import type { Caller, shapes, Infer } from "../../protocol/index.ts";
import { find } from "./find.ts";
import { DecksError } from "./http.ts";
import { Line, type Ask } from "./line.ts";

// The Host line: a client that answers the harness's own calls and starts
// agents. host() opens the socket, offers its kinds and calls with
// agent.host over it, answers each relayed ask, and hears agent.requested
// and agent.mailed. The offer lasts while the line is open.

export type Kind = Infer<typeof shapes.AgentKind>;
export type Message = Infer<typeof shapes.Message>;
export type Answerer = (args: Record<string, unknown>, caller: Caller) => unknown;

export type HostOptions = {
	url?: string;
	token?: string;
	kinds?: Kind[];
	/** The harness calls this host answers, by name: { "chat.list": (args, caller) => entries }. */
	answers?: Record<string, Answerer>;
	/** agent.create reached this host: start the agent the spec describes. */
	start?: (spec: unknown, agent: string) => void | Promise<void>;
	/** Mail for an agent this host runs: deliver it into a turn. */
	mail?: (message: Message, agent: string) => void | Promise<void>;
};

export type Host = { caller: Caller; line: Line; tell(name: string, payload: unknown): void; close(): void; closed: Promise<void> };

type Refusing = { code?: string; message?: string; hint?: string };

export async function host(options: HostOptions): Promise<Host> {
	const found = await find(options);
	if (!found.token) throw new DecksError({ code: "refused", message: "A host needs the person's token.", hint: "deck.pair" });
	const line = new Line(found.url, found.token);
	const answers = options.answers ?? {};
	line.onAsk((ask) => reply(answers, ask));
	const caller = await line.caller;
	line.on((event) => {
		const payload = event.payload as { ids?: string[]; spec?: unknown; message?: Message };
		const agent = payload.ids?.[0] ?? "";
		if (event.name === "agent.requested") void options.start?.(payload.spec, agent);
		if (event.name === "agent.mailed" && payload.message) void options.mail?.(payload.message, agent);
	});
	line.watch(["agent.requested", "agent.mailed"]);
	await line.call("agent.host", { kinds: options.kinds ?? [], calls: Object.keys(answers) });
	return { caller, line, tell: (name, payload) => line.tell(name, payload), close: () => line.close(), closed: line.closed };
}

async function reply(answers: Record<string, Answerer>, request: Ask) {
	const answer = answers[request.name];
	if (!answer) return { ok: false as const, error: { code: "unavailable" as const, message: `This host does not answer ${request.name}.` }, notes: [] };
	try {
		return { ok: true as const, value: await answer((request.args ?? {}) as Record<string, unknown>, request.caller), notes: [] };
	} catch (error) {
		const e = error as Refusing;
		const code = (["invalid", "not_found", "refused", "conflict", "unavailable"].includes(e.code ?? "") ? e.code : "unavailable") as "unavailable";
		return { ok: false as const, error: { code, message: e.message ?? String(error), ...(e.hint ? { hint: e.hint } : {}) }, notes: [] };
	}
}
