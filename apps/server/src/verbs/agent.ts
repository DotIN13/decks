import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import { agentsVerbs } from "./agents.ts";
import type { VerbContext } from "./context.ts";

/**
 * Who works: you (`agent.me`, `agent.update`), the canvas a call means (`here`), the boards you
 * claim, your inbox, the other agents, and handing work over: `send` delivers now, `queue` waits
 * for the turn running to end, `create` makes an agent first.
 */
export function agentVerbs(ctx: VerbContext): Pick<Stage, "agent" | "here"> {
	const { service, agent, notes, canvasOf, canvasRow, askedWorkspace } = ctx;
	const old = agentsVerbs(ctx);

	/** One agent from the registry's summaries, as the `Agent` type has it. */
	const asAgent = (other: ReturnType<typeof agent.agents>[number]) => ({
		id: other.id,
		name: other.name,
		kind: other.kind,
		...(other.workspace ? { workspace: other.workspace } : {}),
		tags: other.tags,
		...(other.stage ? { canvas: other.stage } : {}),
		state: other.state,
		queued: other.queued ?? 0,
	});
	const find = (name: unknown) => {
		const asked = typeof name === "string" ? name.trim() : "";
		if (!asked) throw new Error("Name an agent, by name or id: decks agent list lists them.");
		const all = agent.agents();
		const byId = all.find((one) => one.id === asked);
		if (byId) return byId;
		const named = all.filter((one) => one.name.toLowerCase() === asked.toLowerCase());
		if (named.length > 1) throw new Error(`More than one agent is called ${asked}; use the id from decks agent list.`);
		if (!named[0]) throw new Error(`No agent ${asked}. decks agent list lists them.`);
		return named[0];
	};
	const me = () => {
		const identity = agent.identity();
		const row = agent.agents().find((one) => one.id === agent.id);
		const home = agent.stageName?.();
		return {
			...(agent.board ? {} : { id: agent.id }),
			name: identity.name,
			...(identity.avatar ? { avatar: identity.avatar } : {}),
			color: identity.color,
			...(row ? { kind: row.kind } : {}),
			...(identity.workspace ? { workspace: identity.workspace } : {}),
			tags: identity.tags ?? [],
			...(home ? { canvas: home } : {}),
		};
	};

	return {
		here: async () => canvasRow(canvasOf()),
		agent: {
			me: async () => me(),
			update: async (patch: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string; canvas?: string }) => {
				const { canvas, ...rest } = patch ?? {};
				const said = Object.keys(rest).length ? await old.me(rest) : undefined;
				if (canvas !== undefined) {
					if (!agent.setHome || agent.board || agent.person) throw new Error("Only an agent has a home canvas to change.");
					const name = canvasOf(canvas);
					agent.setHome(name);
					// Who is on which canvas is in every browser's canvas list.
					service.stagesChanged();
				}
				const avatarChanged = (said as { avatarChanged?: string } | undefined)?.avatarChanged;
				return { ...me(), ...(avatarChanged ? { avatarChanged } : {}) };
			},
			claim: async (boards: string | string[]) => {
				const paths = Array.isArray(boards) ? boards : [boards];
				for (const one of paths) if (!service.fileBoard(one)) throw new Error(`No such board: ${one}`);
				for (const one of paths) agent.worked?.(one);
				return paths;
			},
			inbox: async () => {
				const handed = agent.queue().map((item) => ({ from: item.fromName, task: item.task, boards: item.boards, at: item.at, ...(item.reply ? { reply: true } : {}) }));
				const events = agent.board || agent.person ? [] : (service.watches?.take(agent.id) ?? []).map((event) => ({ from: event.from, kind: event.kind, canvas: event.canvas, ...(event.item ? { item: event.item } : {}), boards: event.kind.startsWith("board.") && event.item ? [event.item] : [], at: event.at }));
				return [...handed, ...events].sort((a, b) => a.at - b.at);
			},
			list: async (options?: { workspace?: string }) => {
				const workspace = options?.workspace === undefined || options.workspace === null ? undefined : askedWorkspace(options.workspace);
				return agent
					.agents()
					.filter((other) => (workspace === undefined ? true : (other.workspace ?? "") === workspace))
					.map(asAgent);
			},
			get: async (name: string) => asAgent(find(name)),
			send: async (name: string, message: { task: string; boards?: string[] }) => {
				if (!message?.task?.trim()) throw new Error("A message needs a task: what to do.");
				const to = find(name);
				if (!agent.deliver) {
					// A caller with no way to deliver (a test host) queues, and says so.
					const queued = agent.send(to.id, { task: message.task, ...(message.boards ? { boards: message.boards } : {}) });
					return { delivered: false, turn: "queued" as const, position: queued.position, note: "This caller cannot deliver at once, so the work was queued." };
				}
				const answer = agent.deliver(to.id, { task: message.task, ...(message.boards ? { boards: message.boards } : {}) });
				if (answer.note) notes.push(answer.note);
				return answer;
			},
			queue: async (name: string, work: { task: string; boards?: string[]; reply?: boolean }) => {
				if (!work?.task?.trim()) throw new Error("Queued work needs a task: what to do.");
				const to = find(name);
				const { queued, position } = agent.send(to.id, { task: work.task, ...(work.boards ? { boards: work.boards } : {}), ...(work.reply ? { reply: true } : {}) });
				return { queued, position };
			},
			create: async (spec: { name: string; kind?: string; model?: string; thinking?: string; mode?: string; workspace?: string; tags?: string[]; canvas?: string }) => {
				if (!agent.create) throw new Error(agent.board ? "A board's button cannot make agents." : "This deck cannot make agents.");
				const name = String(spec?.name ?? "").trim();
				if (!name) throw new Error('A new agent needs a name: decks agent create --name Rune.');
				if (agent.agents().some((one) => one.name.toLowerCase() === name.toLowerCase())) throw new Error(`Another agent is already called ${name}. Pick a different name, or send it work.`);
				const canvas = spec.canvas === undefined || spec.canvas === null ? undefined : canvasOf(spec.canvas);
				const { canvas: _asked, ...rest } = spec;
				const made = await agent.create({ ...(rest as Record<string, unknown>), name, ...(canvas ? { canvas } : { newCanvas: true }) });
				const row = agent.agents().find((one) => one.id === made.agent);
				return {
					...(row ? asAgent(row) : { id: made.agent, name: made.name, tags: [] }),
					...(made.kind ? { kind: made.kind } : {}),
					...(made.model ? { model: made.model } : {}),
					...(made.thinking ? { thinking: made.thinking } : {}),
					...(made.mode ? { mode: made.mode } : {}),
					...(made.canvas ? { canvas: made.canvas } : {}),
				};
			},
		},
	};
}
