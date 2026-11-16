import type { Client } from "@decks/sdk";
import type { AgentBackend, AgentBackendContext, ClaudeAccountSwitcher } from "../runtimes/backend.ts";
import { runtimeOf } from "../runtimes/registry.ts";
import { ExtensionUiBridge } from "../runtimes/shared/extension-ui.ts";
import { sessionTokenFiles } from "../runtimes/shared/session-tokens.ts";
import { Translator, type ChatEvent } from "../runtimes/shared/translator.ts";
import type { AgentMode, AgentState, AgentUsage, ChatItem, MessagePart, ThinkingLevel } from "../runtimes/types/index.ts";
import { writeTeller } from "./acts.ts";
import { identityReminder, type Agent, type Spec } from "./identity.ts";
import { Queues, type Mail } from "./queue.ts";
import { markFiles, touchedFiles } from "./timeline.ts";
import { agentClient, brief, briefingText, deckFacts, decksAccess, takeNews } from "./tools.ts";
import type { Saved, Transcripts } from "./transcript.ts";

// One agent's session: a turn at a time, its queues and its transcript. It
// reaches Decks only through calls: the host line for what the person sees,
// the agent's own token for what the agent does.

/** The harness's line to the server, as a session needs it. */
export interface HostLink {
	tell(name: string, payload: unknown): void;
	call(name: string, args?: unknown): Promise<unknown>;
}

export interface SessionDeps {
	url: string;
	deckPath: string;
	transcripts: Transcripts;
	host: HostLink;
	accounts?: ClaudeAccountSwitcher;
	/** Opens the runtime instead of the registry: a test's fake backend. */
	open?: (context: AgentBackendContext) => Promise<AgentBackend>;
}

/** Runtimes that take a message in the middle of a turn. */
const STEERS: Record<string, boolean> = { pi: true, opencode2: true, claude: true, opencode: true, antigravity: false };
const SAVE_MS = 500;

export class Session {
	readonly translator: Translator;
	readonly bridge: ExtensionUiBridge;
	readonly queues: Queues;
	backend: AgentBackend | undefined;
	failure: string | undefined;
	state: AgentState = "idle";
	usage: AgentUsage | undefined;
	private starting: Promise<void> | undefined;
	private rev = 0;

	/** Messages being handed to the runtime right now. */
	private sending = 0;

	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private briefing = "";

	constructor(
		readonly spec: Spec,
		private readonly deps: SessionDeps,
		private saved: Saved = { id: spec.id, kind: spec.kind, items: [] },
	) {
		if (spec.token) this.saved.token = spec.token;
		this.translator = new Translator(spec.id, (event) => this.hear(event), deps.deckPath, () => this.save(), (items) => deps.transcripts.archive(spec.id, items));
		this.translator.load(this.saved.items);
		this.translator.onTool = writeTeller(() => this.client, deps.deckPath);
		this.bridge = new ExtensionUiBridge({
			prompt: (question) => this.tellChat("chat.asked", [spec.id], { question }),
			closePrompt: (id) => this.tellChat("chat.answered", [spec.id, id], {}),
			notify: (text, level) => this.translator.notice(level, text),
			status: () => {},
			working: () => {},
		});
		this.queues = new Queues({
			idle: () => this.state === "idle",
			prompt: (text, parts) => void this.prompt(text, parts),
			run: (mail) => this.run(mail),
			changed: () => this.report(),
		});
	}

	get id(): string {
		return this.spec.id;
	}

	get deckPath(): string {
		return this.deps.deckPath;
	}

	/** Calls as the agent itself, with its current token. */
	get client(): Client {
		return agentClient(this.deps.url, this.saved.token);
	}

	get dormant(): boolean {
		return !this.backend;
	}

	history(): ChatItem[] {
		return this.translator.history();
	}

	// A turn: start, prompt, abort
	/** Start the runtime, once; a failure is kept and said, and the next message tries again. */
	start(): Promise<void> {
		this.starting ??= this.open().catch((error: Error) => {
			this.failure = error.message;
			this.starting = undefined;
		});
		return this.starting;
	}

	/** A message as a new turn, or into the running one: news and the identity reminder in front. */
	async prompt(text: string, parts?: MessagePart[]): Promise<void> {
		const said = this.translator.user(text, parts);
		await this.start();
		if (!this.backend) return this.translator.notice("error", `Not started: ${this.failure ?? "unknown reason"}`);
		this.translator.setState("thinking");
		await this.mark(said.id);
		const sent = (await this.front(text)) ?? text;
		this.sending += 1;
		try {
			await this.backend.prompt(sent);
		} catch (error) {
			this.translator.notice("error", (error as Error).message);
			this.translator.setState("idle");
		} finally {
			this.sending -= 1;
		}
		if (!this.backend.isStreaming && this.state !== "idle") this.translator.setState("idle");
		this.usage = this.backend.usage() ?? this.usage;
		await this.backend.syncEntryIds();
		this.save();
	}

	/** What goes in front of a message: news, then the reminder. None for a slash command. */
	private async front(text: string): Promise<string | undefined> {
		if (text.trimStart().startsWith("/")) return undefined;
		const lines: string[] = [];
		const news = await takeNews(this.client);
		if (news) lines.push(news);
		const me = await this.client.call("agent.me").then((a) => a.value as Agent).catch(() => undefined);
		const unsaid = me ? identityReminder(me) : undefined;
		if (unsaid) lines.push(unsaid);
		return lines.length ? `${lines.join("\n")}\n\n${text}` : undefined;
	}

	/** The person's message: into the turn when the runtime can take one, else their queue. */
	send(text: string, parts?: MessagePart[]): ChatItem | undefined {
		if (this.state !== "idle" && !STEERS[this.spec.kind]) return void this.queues.add(text, parts);
		void this.prompt(text, parts);
		return this.translator.history().at(-1);
	}

	async abort(): Promise<void> {
		this.queues.hold();
		await this.backend?.abort();
		this.translator.setState("idle");
	}

	private settled(): Promise<void> {
		if (this.state === "idle") return Promise.resolve();
		return new Promise((resolve) => {
			const check = setInterval(() => {
				if (this.state !== "idle") return;
				clearInterval(check);
				resolve();
			}, 50);
		});
	}

	// Mail from other agents
	/** Mail from the server: now into the turn, or queued behind the person's own. */
	mail(message: { id: string; from: string; task: string; cards: string[]; reply?: boolean; state?: string }): void {
		const item: Mail = { id: message.id, from: message.from, task: message.task, cards: message.cards, ...(message.reply ? { reply: true } : {}) };
		const now = message.state === "delivered";
		if (now && (this.state === "idle" || STEERS[this.spec.kind])) {
			this.translator.notice("info", `${message.from} sent you work, ${this.state === "idle" ? "now" : "into this turn"}.`);
			void this.prompt(brief(message.from, message.task, message.cards, true));
			return;
		}
		this.translator.notice("info", `${message.from} queued work for you.`);
		this.queues.mail(item);
	}

	/** Handed-over work, run to the end of its turn; a reply goes back to the sender as plain mail. */
	async run(mail: Mail): Promise<void> {
		await this.prompt(brief(mail.from, mail.task, mail.cards, false));
		await this.settled();
		const report = this.translator.lastAssistantText().trim();
		if (!mail.reply || !report) return;
		await this.client.call("agent.send", { agent: mail.from, task: `${this.spec.name} finished: ${report}` }).catch((error: Error) => {
			this.translator.notice("warn", `The report to ${mail.from} did not go: ${error.message}`);
		});
	}

	// What the server and the page are told
	private hear(event: ChatEvent): void {
		if (event.type === "chat.item") return this.tellChat("chat.added", [this.id, event.item.id], { item: event.item });
		if (event.type === "chat.delta") return this.tellChat("chat.added", [this.id, event.itemId], { delta: event.delta, field: event.field });
		const was = this.state;
		this.state = event.state;
		this.report();
		if (event.state === "idle" && was !== "idle") this.queues.turnEnded();
	}

	/** State and queue length, to the server's record and the page. */
	private report(): void {
		void this.deps.host.call("agent.update", { agent: this.id, change: { state: this.state, queued: this.queues.length } }).catch(() => {});
		this.tellChat("chat.changed", [this.id], {});
	}

	private tellChat(name: string, ids: string[], more: Record<string, unknown>): void {
		this.deps.host.tell(name, { ids, by: this.id, rev: ++this.rev, ...more });
	}

	// Opening the runtime
	private async open(): Promise<void> {
		if (this.deps.open) {
			this.backend = await this.deps.open(this.context());
			return;
		}
		const runtime = runtimeOf(this.spec.kind);
		if (!runtime) throw new Error(`This harness does not run ${this.spec.kind} agents.`);
		const can = runtime.availability();
		if (!can.available) throw new Error(can.reason);
		this.briefing = briefingText(await deckFacts(this.client, this.deps.deckPath));
		this.backend = await runtime.create(this.context());
		this.failure = undefined;
	}

	private context(): AgentBackendContext {
		const saved = this.saved;
		return {
			cwd: this.deps.deckPath,
			translator: this.translator,
			bridge: this.bridge,
			notice: (level, text) => this.tellChat("runtime.noticed", [this.id], { level, text }),
			// A late end of the last turn says nothing once the next has begun: while a
			// message is being handed over, or while the runtime says a turn runs.
			turnEnded: () => {
				if (this.sending > 0 || this.backend?.isStreaming) return;
				this.usage = this.backend?.usage() ?? this.usage;
				this.translator.setState("idle");
			},
			agent: { id: this.id },
			decks: decksAccess(this.deps.url, this.id, saved.token),
			sessionTokens: sessionTokenFiles(saved.token),
			briefing: () => this.briefing,
			...(saved.sessionRef ? { resumeRef: saved.sessionRef } : {}),
			...(saved.model ? { model: saved.model } : {}),
			...(saved.mode ? { mode: saved.mode } : this.spec.mode ? { mode: this.spec.mode } : {}),
			...(this.deps.accounts ? { accounts: this.deps.accounts, account: { id: () => saved.account ?? this.deps.accounts!.defaultId() } } : {}),
			historyChanged: () => this.tellChat("chat.changed", [this.id], {}),
		};
	}

	// Following the record: model, mode, account, token
	/** The record changed on the server: follow its model, thinking and mode. */
	async follow(record: { model?: string; thinking?: string; mode?: string }): Promise<void> {
		const [provider, ...rest] = (record.model ?? "").split("/");
		const model = rest.join("/");
		const thinking = record.thinking as ThinkingLevel | undefined;
		const now = this.backend?.model() ?? this.saved.model;
		if (provider && model && (now?.provider !== provider || now?.model !== model)) {
			if (this.backend) await this.backend.setModel(provider, model, thinking);
			else this.saved.model = { provider, model, thinking: thinking ?? now?.thinking ?? "medium" };
		} else if (thinking && now?.thinking !== thinking) {
			if (this.backend) this.backend.setThinking(thinking);
			else if (this.saved.model) this.saved.model = { ...this.saved.model, thinking };
		}
		const mode = record.mode as AgentMode | undefined;
		if (mode && mode !== (this.backend?.mode?.() ?? this.saved.mode)) {
			this.saved.mode = mode;
			await this.backend?.setMode?.(mode);
		}
		this.save();
	}

	/** Spend from another Claude account: this agent's link is repointed, and its runtime follows. */
	useAccount(id: string): boolean {
		const accounts = this.deps.accounts;
		if (!accounts?.has(id)) return false;
		this.saved.account = id;
		accounts.pointAgentAt?.(this.id, id);
		this.backend?.accountChanged?.();
		this.save();
		return true;
	}

	get account(): string | undefined {
		return this.saved.account ?? this.deps.accounts?.defaultId();
	}

	/** A new token for this agent, as an adopting server gives one. */
	retoken(token: string): void {
		this.saved.token = token;
	}

	/** Open on this runtime handle when the runtime starts: a fork's copy of another conversation. */
	resumeFrom(ref: string): void {
		if (!this.backend) this.saved.sessionRef = ref;
	}

	// Marks for going back
	/** The versions a message was marked with as it was sent. */
	marksOf(entry: string): Record<string, string> {
		return this.saved.marks?.[entry] ?? {};
	}

	/** Before the runtime hears a message: the settled version of each file the agent has touched. */
	private async mark(entry: string): Promise<void> {
		const paths = touchedFiles(this, this.deps.deckPath);
		if (!paths.length) return;
		const marks = await markFiles(this, paths);
		this.saved.marks = { ...this.saved.marks, [entry]: marks };
	}

	// Keeping the transcript
	/** The saved copy, as transcript.ts writes it. */
	snapshot(): Saved {
		const ref = this.backend?.sessionRef();
		const model = this.backend?.model();
		return { ...this.saved, ...(ref ? { sessionRef: ref } : {}), ...(model ? { model } : {}), items: this.translator.history() };
	}

	private save(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined;
			this.deps.transcripts.write(this.snapshot());
		}, SAVE_MS);
		this.saveTimer.unref?.();
	}

	/** Write now, as the harness stops. */
	flush(): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = undefined;
		this.deps.transcripts.write(this.snapshot());
	}

	dispose(): void {
		this.flush();
		this.queues.dispose();
		this.bridge.dispose();
		this.backend?.dispose();
	}
}
