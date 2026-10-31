import { THINKING_LEVELS, type ExtensionUiAnswer, type ThinkingLevel } from "@decks/protocol";
import { asyncRoute, type RouteDeps } from "./shared.ts";
import type { Router } from "express";

/**
 * An agent's routes for another front end (Studio): its conversation, its settings, and a person's acts on it.
 */
export function register(api: Router, { app }: RouteDeps): void {
	/**
	 * What another front end's composer offers for one agent (Studio's model menu): the model it is on
	 * with its thinking level, the models its runtime offers here, and, for a Claude agent, the
	 * subscriptions it could spend and the one it does. `?limits=1` reads the accounts' 5-hour
	 * figures again, as this app's picker does on opening; they arrive with the next read.
	 */
	/*
	 * An agent's conversation, for another front end's transcript (Studio): the window a browser is
	 * given when it opens a chat (`chat.open`), a page before an item (`chat.earlier`), and one tool
	 * call's whole result (`chat.tool`). What happens next arrives on the event stream as
	 * `chat.item`, `chat.delta` and `chat.history`.
	 */
	api.get("/agents/:id/history", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		if (!agent) {
			res.status(404).json({ error: "No agent here has that id." });
			return;
		}
		const message = agent.historyMessage() as { items: unknown[]; more?: boolean };
		res.set("cache-control", "no-store").json({ items: message.items, more: message.more ?? false });
	});
	api.get("/agents/:id/earlier", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		if (!agent) {
			res.status(404).json({ error: "No agent here has that id." });
			return;
		}
		const page = agent.earlier(String(req.query.before ?? ""), Math.min(Math.max(Number(req.query.limit) || 60, 1), 200));
		res.set("cache-control", "no-store").json({ items: page.items, more: page.more });
	});
	api.get("/agents/:id/tool/:item", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		res.set("cache-control", "no-store").json({ result: agent?.toolResult(String(req.params.item)) ?? "" });
	});

	/** The questions an agent is waiting on, for a front end that arrives after they were asked. */
	api.get("/agents/:id/dialogs", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		if (!agent) {
			res.status(404).json({ error: "No agent here has that id." });
			return;
		}
		res.set("cache-control", "no-store").json({ dialogs: agent.dialogs() });
	});

	api.get(
		"/agents/:id/settings",
		asyncRoute(async (req, res) => {
			const agent = app.agents.get(String(req.params.id));
			if (!agent) {
				res.status(404).json({ error: "No agent here has that id." });
				return;
			}
			if (req.query.limits) void app.refreshLimits();
			let accounts: { accounts?: unknown[]; active?: string } = {};
			if (agent.kind === "claude") await app.publishAccounts((frame) => frame.type === "claude.accounts" && (accounts = frame));
			res.set("cache-control", "no-store").json({
				id: agent.id,
				kind: agent.kind,
				model: agent.model ?? null,
				models: app.runtimes().find((runtime) => runtime.kind === agent.kind)?.models ?? [],
				// How much it asks before acting, and the modes its runtime offers (none for Pi).
				// What `/` completes to: the session's own list once it has run, else its runtime's.
				commands: agent.chat().commands ?? app.runtimes().find((runtime) => runtime.kind === agent.kind)?.commands ?? [],
				mode: agent.mode ?? null,
				// How full its context is and what the session has cost: the composer's dial.
				usage: agent.usage ?? null,
				modes: app.runtimes().find((runtime) => runtime.kind === agent.kind)?.capabilities.modes ?? [],
				accounts: accounts.accounts ?? [],
				account: agent.accountId() ?? accounts.active ?? null,
				// The person's own messages waiting for the turn to end (Ctrl+Enter), and whether Stop holds them.
				queued: agent.queuedMine(),
			});
		}),
	);

	/**
	 * A person's acts on an agent from another front end, such as Studio's agent rows: what this
	 * app's own page sends on its socket (`wire/agents.ts`). `rename` takes `{ name }`, refused when
	 * another agent has it; `stop` ends the turn it is running; `remove` takes it off this deck.
	 */
	api.post("/agents/:id/:act", (req, res) => {
		const agent = app.agents.get(String(req.params.id));
		if (!agent) {
			res.status(404).json({ error: "No agent here has that id." });
			return;
		}
		const act = String(req.params.act);
		/*
		 * What a person types, as this app's own composer sends it (`agent.prompt` on the socket):
		 * untouched, so a `/` command runs as one. Answered at once; what it does arrives as events.
		 */
		if (act === "prompt") {
			const text = String(((req.body ?? {}) as { text?: unknown }).text ?? "");
			if (!text.trim()) {
				res.status(400).json({ error: "Say something to send." });
				return;
			}
			// Said from a canvas (Studio's composer): the agent works on that one, as an agent talked
			// to from this app's own canvas does, rather than being told which in the words.
			const canvas = ((req.body ?? {}) as { canvas?: unknown }).canvas;
			if (typeof canvas === "string" && canvas && agent.stageName() !== canvas) {
				try {
					agent.openStage(canvas);
				} catch {
					// A canvas this harness has not synced yet: the words still go.
				}
			}
			void agent.prompt(text);
			agent.sayRow();
			res.json({ id: agent.id, sent: true });
			return;
		}
		/*
		 * The time machine, from a message's buttons in another front end (Studio), as this app's
		 * own socket does it (`rewind.to`, `fork.from` in `wire/agents.ts`). A rewind may ask first,
		 * on the agent's dialog; the words it took back come back for the composer.
		 */
		if (act === "rewind" || act === "fork") {
			const entryId = String(((req.body ?? {}) as { entryId?: unknown }).entryId ?? "");
			if (!entryId) {
				res.status(400).json({ error: "Name the message, by its entry." });
				return;
			}
			// A dormant agent has no session in memory to go back in: wake it first, as sending to it would.
			const ready = agent.start().catch(() => undefined);
			if (act === "rewind") {
				ready.then(() => agent.rewindTo(entryId)).then(
					(result) => {
						app.agents.publish();
						res.json(result.cancelled ? { cancelled: true } : { rewound: true, ...(result.editorText ? { editorText: result.editorText } : {}) });
					},
					(error: unknown) => res.status(400).json({ error: (error as Error).message }),
				);
				return;
			}
			ready.then(() => agent.forkFrom(entryId)).then(
				(resumeRef) => {
					if (!resumeRef) {
						res.status(409).json({ error: "There is nothing before that message to fork from." });
						return;
					}
					const at = agent.entryTime(entryId);
					const child = app.agents.create({
						name: `${agent.chat().name} (fork)`,
						resumeRef,
						kind: agent.kind,
						...(at ? { forkedFrom: { agentId: agent.id, at } } : {}),
						...(agent.model ? { model: agent.model } : {}),
						...(agent.mode ? { mode: agent.mode } : {}),
					});
					res.json({ id: child.id, name: child.chat().name });
				},
				(error: unknown) => res.status(400).json({ error: (error as Error).message }),
			);
			return;
		}
		/** Start the agent afresh: a new conversation, the same agent (`session.reset`). */
		if (act === "reset") {
			agent.reset().then(
				() => {
					app.agents.publish();
					res.json({ id: agent.id, reset: true });
				},
				(error: unknown) => res.status(400).json({ error: (error as Error).message }),
			);
			return;
		}
		/** The project an agent is filed under, from another front end's agent list (Studio); null takes it out of any. */
		if (act === "workspace") {
			const workspace = ((req.body ?? {}) as { workspace?: unknown }).workspace;
			if (workspace === null || workspace === "") agent.clearWorkspace();
			else if (typeof workspace === "string") agent.setWorkspace(workspace.trim());
			else {
				res.status(400).json({ error: "A workspace is a name, or null for none." });
				return;
			}
			app.agents.publish();
			res.json({ id: agent.id, workspace: agent.workspace ?? null });
			return;
		}
		/** The answer to a question the agent asked (`/login`'s method and code, a choice, a confirm). */
		if (act === "dialog") {
			const answer = (req.body ?? {}) as ExtensionUiAnswer;
			if (typeof answer?.id !== "string") {
				res.status(400).json({ error: "An answer names the question it answers." });
				return;
			}
			agent.answerDialog(answer);
			res.json({ answered: answer.id });
			return;
		}
		if (act === "rename") {
			const name = String(((req.body ?? {}) as { name?: unknown }).name ?? "").trim().slice(0, 40);
			if (!name) {
				res.status(400).json({ error: "A name cannot be empty." });
				return;
			}
			if (app.agents.nameTaken(name, agent.id)) {
				res.status(409).json({ error: `Another agent is already called ${name}.` });
				return;
			}
			agent.rename(name);
			res.json({ id: agent.id, name });
			return;
		}
		/*
		 * The person's own queue, as this app's composer works it over the socket (`agent.queue`):
		 * `add` a message for when the turn ends, `remove` one, `send` one now (it steers the turn),
		 * `release` what Stop held. The new queue comes back, and as `agent.queued` on the events.
		 */
		if (act === "queue") {
			const body = (req.body ?? {}) as { action?: unknown; text?: unknown; item?: unknown };
			const { action, text, item } = body;
			if (action === "add" && typeof text === "string" && text.trim()) agent.queueMine(text);
			else if (action === "remove" && typeof item === "string") agent.unqueueMine(item);
			else if (action === "send" && typeof item === "string") agent.sendMineNow(item);
			else if (action === "release") agent.releaseMine();
			else {
				res.status(400).json({ error: "Say what to do with the queue: add (with text), remove or send (with item), or release." });
				return;
			}
			agent.sayRow();
			res.json({ id: agent.id, ...agent.queuedMine() });
			return;
		}
		if (act === "stop") {
			void agent.abort();
			res.json({ id: agent.id, stopped: true });
			return;
		}
		if (act === "remove") {
			const outcome = app.agents.remove(agent.id);
			if (!outcome.removed) {
				res.status(409).json({ error: outcome.reason ?? "That agent cannot be removed." });
				return;
			}
			res.json({ id: agent.id, removed: true });
			return;
		}
		const body = (req.body ?? {}) as { provider?: unknown; model?: unknown; thinking?: unknown; id?: unknown; mode?: unknown };
		const level = THINKING_LEVELS.find((one) => one === body.thinking) as ThinkingLevel | undefined;
		// The model, with the level the picker kept for it; the thinking level alone; the subscription it spends.
		if (act === "model") {
			if (typeof body.provider !== "string" || typeof body.model !== "string") {
				res.status(400).json({ error: "Say which provider and model." });
				return;
			}
			agent.setModel(body.provider, body.model, level).then(
				() => res.json({ id: agent.id, model: agent.model ?? null }),
				(error: unknown) => res.status(400).json({ error: (error as Error).message }),
			);
			return;
		}
		if (act === "thinking") {
			if (!level) {
				res.status(400).json({ error: `A thinking level is one of ${THINKING_LEVELS.join(", ")}.` });
				return;
			}
			agent.setThinking(level).then(
				() => res.json({ id: agent.id, model: agent.model ?? null }),
				(error: unknown) => res.status(400).json({ error: `Could not change the thinking level: ${(error as Error).message}` }),
			);
			return;
		}
		if (act === "mode") {
			const modes = app.runtimes().find((runtime) => runtime.kind === agent.kind)?.capabilities.modes ?? [];
			const mode = modes.find((one) => one === body.mode);
			if (!mode) {
				res.status(400).json({ error: modes.length ? `A mode here is one of ${modes.join(", ")}.` : "This agent's runtime has no modes." });
				return;
			}
			agent.setMode(mode).then(
				() => {
					app.agents.publish();
					res.json({ id: agent.id, mode: agent.mode ?? mode });
				},
				(error: unknown) => res.status(400).json({ error: `Could not change mode: ${(error as Error).message}` }),
			);
			return;
		}
		if (act === "account") {
			if (agent.kind !== "claude" || typeof body.id !== "string" || !agent.useAccount(body.id)) {
				res.status(409).json({ error: "That account is not on the list, or this agent has no Claude account." });
				return;
			}
			// The runtime starts, so the subscription is in force at once (`wire/accounts.ts`).
			void agent.start();
			void app.publishAccounts();
			res.json({ id: agent.id, account: body.id });
			return;
		}
		res.status(404).json({ error: "An agent can be renamed, stopped, removed, or given a model, a thinking level, a mode or an account." });
	});
}
