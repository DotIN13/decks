import type { DeckState, RuntimeInfo } from "@decks/protocol";
import type { Acts } from "../agents/acts.ts";
import type { Registry } from "../agents/registry.ts";
import type { DeckAgent } from "../agents/session.ts";
import type { CanvasService } from "../canvas/service.ts";
import type { AccountList } from "../runtimes/claude/account-list.ts";
import { needAgent, personGesture, type PersonVerbs } from "./person-call.ts";

/**
 * The person's verbs about their agents (`agent.*`): focus one, add, attach, change, report on,
 * reset or remove it.
 */

/** What the agent verbs need of the harness: the agents, their canvases and runtimes, and the account list a new agent joins. */
export interface AgentTableHost {
	readonly agents: Registry;
	readonly stage: CanvasService;
	readonly acts: Acts;
	readonly accountList: AccountList;
	/** The canvas list again, to every page: an agent's home canvas changed. */
	publishStages(): void;
	/** The deck as this agent's canvas arranges it, for the screen that focused it. */
	stageState(agent?: DeckAgent): DeckState;
	runtimes(): RuntimeInfo[];
}

export function agentTable(host: AgentTableHost): PersonVerbs {
	const agents = host.agents;
	const need = (id: unknown) => needAgent(agents, id);
	return {
		"agent.focus": async ([id], call) => {
			// This screen first, then everyone: the agent.list the focus publishes is rendered for each line by its view (`forView`), and this one must already say the new agent.
			if (call.view) call.view.focused = String(id);
			agents.focus(String(id));
			if (call.view) call.tell({ type: "deck.changed", deck: host.stageState(agents.get(String(id))) });
		},
		"agent.remove": async ([id]) => {
			const outcome = agents.remove(String(id));
			if (outcome.removed) host.acts.forget(String(id));
			if (!outcome.removed && outcome.reason) throw new Error(outcome.reason);
		},
		"agent.add": async ([spec]) => {
			const given = (spec ?? {}) as { kind?: string; workspace?: string; near?: string };
			const agent = agents.create({ ...(given.workspace ? { workspace: given.workspace } : {}), ...(typeof given.near === "string" ? { near: given.near } : {}), ...(given.kind ? { kind: given.kind as never } : {}) });
			agents.focus(agent.id);
			const workspace = given.workspace ?? (typeof given.near === "string" ? agents.get(given.near)?.workspace : undefined);
			const latest = agents.latestCanvas(workspace, agent.id);
			try {
				if (latest) agent.seat.openStage(latest);
				else agent.seat.newStage?.(agent.chat().name, { provisional: true });
			} catch {
				/* a name clash or a canvas gone meanwhile: the agent still works, on a canvas of its own once it needs one */
			}
			void host.accountList.publish();
			host.publishStages();
			return { id: agent.id };
		},
		"agent.attach": async ([spec]) => {
			const given = (spec ?? {}) as { key?: string; client?: string; name?: string; workspace?: string; canvas?: string };
			const { agent, made, token } = agents.attach({ key: String(given.key ?? ""), ...(given.client ? { client: given.client } : {}), ...(given.name ? { name: given.name } : {}), ...(given.workspace ? { workspace: given.workspace } : {}) });
			if (!token) throw new Error("This harness hands out no agent tokens.");
			// Its home canvas: the one asked for, else as a new agent's is found, the latest of its workspace or one of its own.
			if (given.canvas || (made && !agent.seat.stageName())) {
				try {
					const latest = given.canvas ?? agents.latestCanvas(agent.workspace, agent.id);
					if (latest) agent.seat.openStage(latest);
					else agent.seat.newStage?.(agent.chat().name, { provisional: true });
				} catch {
					/* a canvas gone meanwhile: it has one once it draws */
				}
				host.publishStages();
			}
			const canvas = agent.seat.stageName();
			return { id: agent.id, name: agent.chat().name, token, made, ...(canvas ? { canvas } : {}) };
		},
		"agent.set": async ([id, patch], call) => {
			const agent = need(id);
			const change = (patch ?? {}) as { name?: string; tags?: string[]; workspace?: string | null; model?: { provider: string; model: string; thinking?: string }; thinking?: string; mode?: string; canvas?: string };
			if (change.name !== undefined) {
				const name = String(change.name).trim().slice(0, 40);
				if (!name) throw new Error("A name cannot be empty.");
				if (agents.nameTaken(name, agent.id)) {
					call.tell({ type: "agent.identity", id: agent.id, identity: agent.chat().identity });
					throw new Error(`Another agent is already called ${name}.`);
				}
				agent.rename(name);
			}
			if (change.tags !== undefined) agent.setUserTags(change.tags);
			if (change.workspace !== undefined) {
				if (change.workspace === null) agent.clearWorkspace();
				else agent.setWorkspace(change.workspace);
			}
			if (change.model) await agent.conversation.setModel(change.model.provider, change.model.model, change.model.thinking as never);
			if (change.thinking !== undefined) {
				try {
					await agent.conversation.setThinking(change.thinking as never);
				} catch (error) {
					throw new Error(`Could not change the thinking level: ${(error as Error).message}`);
				}
			}
			if (change.mode !== undefined) {
				try {
					await agent.conversation.setMode(change.mode as never);
					agents.publish();
				} catch (error) {
					throw new Error(`Could not change mode: ${(error as Error).message}`);
				}
			}
			if (change.canvas !== undefined) await personGesture(host, { agent: agent.id }, "open", [change.canvas]);
		},
		"agent.report": async ([id], call) => {
			const agent = agents.get(String(id));
			if (!agent) {
				call.tell({ type: "agent.report", id: String(id), error: "That agent is gone." });
				return;
			}
			void agent
				.conversation.report()
				.then((report) => call.tell({ type: "agent.report", id: agent.id, report }))
				.catch((error: unknown) => call.tell({ type: "agent.report", id: agent.id, error: (error as Error).message }));
		},
		"agent.answer": async ([answer]) => {
			for (const agent of agents.all()) agent.conversation.answerDialog(answer as never);
		},
		"agent.dialogs": async ([id]) => ({ dialogs: need(id).conversation.dialogs() }),
		"agent.settings": async ([id, options]) => {
			const agent = need(id);
			if ((options as { limits?: unknown } | undefined)?.limits) void host.accountList.refreshLimits();
			let accounts: { accounts?: unknown[]; active?: string } = {};
			if (agent.kind === "claude") await host.accountList.publish((frame) => frame.type === "account.list" && (accounts = frame));
			const runtime = host.runtimes().find((one) => one.kind === agent.kind);
			return {
				id: agent.id,
				kind: agent.kind,
				model: agent.conversation.model ?? null,
				models: runtime?.models ?? [],
				commands: agent.chat().commands ?? runtime?.commands ?? [],
				mode: agent.conversation.mode ?? null,
				usage: agent.conversation.usage ?? null,
				modes: runtime?.capabilities.modes ?? [],
				accounts: accounts.accounts ?? [],
				account: agent.conversation.accountId() ?? accounts.active ?? null,
				queued: agent.turns.queuedMine(),
			};
		},
		"agent.reset": async ([id]) => {
			await need(id).conversation.reset();
			agents.publish();
		},
	};
}
