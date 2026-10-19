import type { CreateSpec, SendSpec } from "../stage/tool.ts";
import { escapeXml } from "./context.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** Who you are, who else is here, and handing work over. */
export function agentsVerbs(ctx: VerbContext): Pick<Stage, "me" | "send" | "queue" | "agents"> {
	const { service, agent, here, askedWorkspace } = ctx;
	return {
		/**
		 * Who you are, and what you are doing: read it with nothing, change it with a patch.
		 *
		 * One verb where there were five, because they were one act with five names — and the
		 * patch is what a model can hold in its head: `decks.agent.update({ name: "Sable", tags: ["panel"] })`.
		 * What comes back is the identity **as stored**, which is not always what was passed:
		 * tags are slugged, deduped and capped at four, so `["Reading panel.css and measuring"]`
		 * comes back as `["reading-panel-css-and"]`. Returning it is the only way a model finds
		 * that out, and the alternative — silently storing something other than what it thinks it
		 * set — is how an agent ends up setting the same tags forever.
		 *
		 * `workspace` is the project it works in, as a slug: `"Political LLM"` comes back as
		 * `political-llm`, the word the others on that project use too.
		 */
		me: async (patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string }) => {
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
		},

		/**
		 * Hand work to somebody else, and carry on.
		 *
		 * One verb for the two that were: a **name or id** sends to an agent that exists, and a
		 * **shape** — `{ name, kind }` — makes the agent and sends to it. It always
		 * returns at once, because it has to: a stage run is abandoned after twenty seconds and
		 * a turn is minutes, so there is no honest way to wait for an answer inside a call.
		 * `reply: true` is how the answer reaches you — their report lands in your transcript
		 * and you read it on your next turn.
		 *
		 * The receiver starts when it has been quiet for a while, so nothing interrupts a turn in
		 * progress, and it is handed the board *source* when it runs rather than when you sent it,
		 * so a board that changes in between is read as it is.
		 */
		send: async (target: string | CreateSpec, spec: SendSpec) => {
			if (!spec?.task?.trim()) throw new Error("Sent work needs a description");
			const work = {
				task: spec.task,
				...(spec.boards ? { boards: spec.boards } : {}),
				...(spec.reply ? { reply: true } : {}),
			};
			/*
			 * A shape rather than a name: the agent is made first, on your runtime, account and
			 * workspace unless it says otherwise, and the work goes into its queue. This is what
			 * `create` and `delegate` were, minus the wait that could not be kept.
			 */
			if (target && typeof target === "object") {
				if (!agent.create) throw new Error("This deck cannot make agents.");
				const name = String(target.name ?? "").trim();
				if (!name) throw new Error('A new agent needs a name: decks send \'{"name":"Rune"}\' --task …');
				const made = await agent.create({ ...target, name });
				return { ...agent.send(made.agent, work), agent: made.agent, name: made.name };
			}
			const to = String(target ?? "").trim();
			if (!to) throw new Error("Say who: a name or id from decks agents, or { name } to make one.");
			return agent.send(to, work);
		},
		/** What is waiting for an agent: yours, or another's if you name it. */
		queue: async (agentId?: string) => agent.queue(agentId),

		/** Every agent, or with `filter.workspace` the ones that say they work on that project. */
		agents: async (options?: { filter?: { workspace?: string } }) => {
			const filter = options?.filter;
			const workspace = filter?.workspace === undefined ? undefined : askedWorkspace(filter.workspace);
			return agent
				.agents()
				.filter((other) => (workspace === undefined ? true : (other.workspace ?? "") === workspace))
				.map((other) => ({
					id: other.id,
					name: other.name,
					me: other.id === agent.id,
					state: other.state,
					kind: other.kind,
					context: other.context,
					// The true total rides beside the twenty shown, so a reader can tell a slice
					// from everything (agents/registry.ts caps; this passes the cap through).
					holding: other.holding,
					tags: other.tags,
					// Which project they are on, so "who else is on this" is one call rather than two.
					workspace: other.workspace,
					/** How much is already waiting for them — a queue of six is a reason to send elsewhere. */
					queued: other.queued ?? 0,
				}));
		},
	};
}
