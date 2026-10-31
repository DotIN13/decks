import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import { escapeXml } from "./context.ts";
import type { VerbContext } from "./context.ts";

/**
 * Who works: you (`agent.me`, `agent.update`), the canvas a call means (`here`), the cards you
 * claim, your inbox, the other agents, and handing work over: `send` delivers now, `queue` waits
 * for the turn running to end, `create` makes an agent first.
 */
export function agentVerbs(ctx: VerbContext): Pick<Stage, "agent" | "here"> {
	const { service, agent, notes, canvasOf, canvasRow, askedWorkspace } = ctx;

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
		...(other.avatar ? { avatar: other.avatar } : {}),
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

	/** The cards a hand-off names, once each. */
	const namedCards = (work: { cards?: string[] }): string[] | undefined => (work.cards ? [...new Set(work.cards)] : undefined);

	return {
		here: async () => canvasRow(canvasOf()),
		agent: {
			me: async () => me(),
			update: async (patch: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string; canvas?: string }) => {
				const { canvas, ...rest } = patch ?? {};
				const said = Object.keys(rest).length ? await setIdentity(ctx, rest) : undefined;
				if (canvas !== undefined) {
					// The person may move a conversation to a canvas, as the canvas manager does; a board may not.
					if (!agent.setHome || agent.board) throw new Error("Only an agent has a home canvas to change.");
					const name = canvasOf(canvas);
					agent.setHome(name);
					// Who is on which canvas is in every browser's canvas list.
					service.stagesChanged();
				}
				const avatarChanged = (said as { avatarChanged?: string } | undefined)?.avatarChanged;
				return { ...me(), ...(avatarChanged ? { avatarChanged } : {}) };
			},
			claim: async (cards: string | string[]) => {
				const paths = Array.isArray(cards) ? cards : [cards];
				for (const one of paths) if (!service.fileBoard(one)) throw new Error(`No such card: ${one}`);
				for (const one of paths) agent.worked?.(one);
				return paths;
			},
			inbox: async () => {
				const handed = agent.queue().map((item) => ({ from: item.fromName, task: item.task, cards: item.boards, at: item.at, ...(item.reply ? { reply: true } : {}) }));
				return handed;
			},
			list: async (options?: { workspace?: string }) => {
				const workspace = options?.workspace === undefined || options.workspace === null ? undefined : askedWorkspace(options.workspace);
				return agent
					.agents()
					.filter((other) => (workspace === undefined ? true : (other.workspace ?? "") === workspace))
					.map(asAgent);
			},
			get: async (name: string) => asAgent(find(name)),
			send: async (name: string, message: { task: string; cards?: string[] }) => {
				if (!message?.task?.trim()) throw new Error("A message needs a task: what to do.");
				const to = find(name);
				const cards = namedCards(message);
				if (!agent.deliver) {
					// A caller with no way to deliver (a test host) queues, and says so.
					const queued = agent.send(to.id, { task: message.task, ...(cards ? { boards: cards } : {}) });
					return { delivered: false, turn: "queued" as const, position: queued.position, note: "This caller cannot deliver at once, so the work was queued." };
				}
				const answer = agent.deliver(to.id, { task: message.task, ...(cards ? { boards: cards } : {}) });
				if (answer.note) notes.push(answer.note);
				return answer;
			},
			queue: async (name: string, work: { task: string; cards?: string[]; reply?: boolean }) => {
				if (!work?.task?.trim()) throw new Error("Queued work needs a task: what to do.");
				const to = find(name);
				const cards = namedCards(work);
				const { queued, position } = agent.send(to.id, { task: work.task, ...(cards ? { boards: cards } : {}), ...(work.reply ? { reply: true } : {}) });
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

/**
 * Change who you are (`agent.update`): the name, avatar, tags and workspace, as stored. Tags are
 * slugged, deduped and capped, which is why what comes back is read off the identity, not the patch.
 */
async function setIdentity(ctx: VerbContext, patch: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string }) {
	const { service, agent } = ctx;
	if (patch?.name !== undefined) {
		const clean = String(patch.name).trim().slice(0, 40);
		if (!clean) throw new Error("A name cannot be empty");
		/*
		 * One name, one agent. A name is an address — the bar reads `@Sable` and the
		 * deck has to know which Sable — so a second agent taking one is refused rather
		 * than quietly numbered: the model picked a word, and it is the one who should
		 * pick the next one.
		 */
		const mine = agent.identity().name.trim().toLowerCase();
		const taken = clean.toLowerCase() !== mine && agent.agents().some((other) => other.id !== agent.id && other.name.trim().toLowerCase() === clean.toLowerCase());
		if (taken) throw new Error(`Another agent is already called ${clean}. Pick a different name.`);
		agent.rename(clean);
	}
	/*
	 * An avatar is checked and repaired where it is written (`stage/avatar.ts`), and what it
	 * had to repair comes back here. An agent whose drawing was changed is told so in the
	 * result: it is the only way a model finds out, and one that is never told draws the
	 * same broken shape next time — which is exactly how an avatar with no `xmlns` went
	 * unnoticed, rendering as nothing while every call answered as though it had worked.
	 */
	let avatarChanged: string | undefined;
	if (patch?.avatar !== undefined) {
		const avatar = patch.avatar;
		if ("emoji" in avatar) {
			// An emoji becomes a data URL rather than a special case in the browser: one
			// code path for "the agent has a picture".
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="44" font-size="44" text-anchor="middle">${escapeXml(String(avatar.emoji).slice(0, 4))}</text></svg>`;
			agent.setAvatar(service.writeAvatar(agent.id, svg).url);
		} else {
			const written = service.writeAvatar(agent.id, avatar.svg);
			agent.setAvatar(written.url);
			avatarChanged = written.changed;
		}
	}
	if (patch?.tags !== undefined) agent.setTags(patch.tags);
	if (patch?.workspace !== undefined) agent.setWorkspace(patch.workspace);
	return avatarChanged === undefined ? agent.identity() : { ...agent.identity(), avatarChanged };
}
