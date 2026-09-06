import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentCapabilities, AgentMode, AgentModel, AgentUsage, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import type { AgentBackend, AgentBackendContext, ConversationPoint } from "../agents/backend.ts";
import { deckContext } from "../agents/context.ts";
import { helpText, parseSlash } from "../agents/slash.ts";
import { agyExecutable, agyModels, antigravityHomeDir, antigravityAvailability, prepareAntigravityHome } from "./install.ts";
import { AntigravityStream, type AntigravityResult, type AntigravityStep } from "./events.ts";

/**
 * Antigravity behind one Decks agent (DESIGN §6.1).
 *
 * **One `agy` process per agent, and the CLI's own sign-in.** The Python SDK was the
 * better *surface* and the worse *dependency*: it authenticates with a `GEMINI_API_KEY`
 * this machine does not have, and even past its pydantic validation the Go harness it
 * spawns demands the key in its environment and never reads the CLI's OAuth token. So the
 * route changed under this class rather than the class changing what it is for. The CLI
 * is a persistent process — one NDJSON prompt per line on stdin, events on stdout, one
 * `result` per turn — which is closer to Claude's shape than to pi's, and this backend is
 * the Node half of that protocol, exactly as it was for the sidecar it replaced.
 *
 * Two of the CLI's behaviours are worth stating before the code.
 *
 * **The canvas tool arrives over MCP, not as a registered function.** The CLI's own tool
 * list is fixed at its built-ins plus `call_mcp_tool`; the SDK's plain-python-callable
 * route is what died with the SDK. Decks points the CLI's `HOME` at a sandbox it owns
 * (`install.ts`), whose `mcp_config.json` names the canvas-tool server, and the MCP child
 * inherits this agent's token from the process environment.
 *
 * **Headless mode cannot ask, so Decks answers yes.** The CLI's permission engine would
 * soft-deny every tool it could not prompt for — including the MCP call and, with it, the
 * canvas. This process is one Decks spawned, trusted to the same degree pi and an
 * opencode agent in `auto` already are, so the CLI's own headless switch
 * (`--dangerously-skip-permissions`) is armed. The *modes* are a separate thing and still
 * mean something: `accept-edits` writes where it is told, `plan` plans, and both carry
 * the CLI's own behaviour on top of the permission decision.
 */

/** The CLI has two execution modes; the shell's four map down. `manual` would be a lie: headless agy cannot ask. */
export const ANTIGRAVITY_CAPABILITIES: AgentCapabilities = { modes: ["acceptEdits", "plan"] };

export const ANTIGRAVITY_COMMANDS: SlashCommand[] = [
	{ name: "cost", hint: "Open the usage panel: spend, tokens, context", source: "deck" },
	{ name: "status", hint: "Model, mode and conversation", source: "deck" },
	{ name: "models", hint: "Which models this bridge offers", source: "deck" },
	{ name: "help", hint: "The commands Decks understands", source: "deck" },
];

const DEFAULT_MODE: AgentMode = "acceptEdits";
/** The CLI's model slugs carry their reasoning level, so the middle rung is the default. */
const DEFAULT_MODEL = "gemini-3.8-flash-medium";

export class AntigravityBackend implements AgentBackend {
	readonly capabilities = ANTIGRAVITY_CAPABILITIES;

	private child: ChildProcess | undefined;
	private stream: AntigravityStream | undefined;
	private closed = false;
	private streamingNow = false;

	private conversationId: string | undefined;
	private currentModel: AgentModel | undefined;
	private currentMode: AgentMode = DEFAULT_MODE;
	private storedName: string | undefined;
	private lastUsage: AgentUsage | null = null;
	/**
	 * Whether the deck's briefing has gone into this conversation.
	 *
	 * The CLI has no instructions channel in print mode — rules, agents and env are all
	 * ignored, each measured — so the briefing rides in the first prompt, where the
	 * model cannot miss it and the transcript does not show it. One send per conversation;
	 * a respawn keeps the history, and a resumed chat already has it.
	 */
	private briefed = false;
	/** Why the child is being swapped, so its death is not reported as a crash. */
	private swapping = false;

	private constructor(private readonly context: AgentBackendContext) {}

	static async create(context: AgentBackendContext): Promise<AntigravityBackend> {
		const availability = antigravityAvailability();
		// Checked before spawning, so a missing binary or sign-in is a sentence rather than
		// a process that dies inside a turn.
		if (!availability.available) throw new Error(availability.reason);
		prepareAntigravityHome();
		const backend = new AntigravityBackend(context);
		backend.start();
		return backend;
	}

	private start(): void {
		// `thinking` rides in the model slug for this runtime, so the agent picks up only
		// the model; a thinking level is a -low/-medium/-high choice.
		const asked = this.context.model;
		this.currentModel = asked ?? { provider: "antigravity", model: DEFAULT_MODEL, thinking: "off" };
		this.currentMode = this.context.mode ?? DEFAULT_MODE;
		this.conversationId = this.context.resumeRef;

		// `init` arrives with the first turn, not at spawn, so there is nothing to wait
		// for here: the process is ready as soon as its stdin is open.
		this.spawn(undefined);
	}

	private spawn(resume: string | undefined): void {
		const { deck, notice, translator } = this.context;
		const executable = agyExecutable();
		if (!executable) throw new Error("The antigravity CLI is not installed. Put `agy` on PATH, or set DECKS_AGY_BIN to the binary.");
		const conversation = resume ?? this.context.resumeRef;
		const args = [
			"--input-format", "stream-json",
			"--output-format", "stream-json",
			"-p", "",
			// A board turn can take a while; the desktop default of five minutes is a
			// ceiling a long answer could brush. Ten is a ceiling the model will not.
			"--print-timeout", "10m",
			// Asking is impossible here, so the CLI's own answer-to-itself is armed —
			// scoped permission files would mean rewriting the user's settings.json.
			"--dangerously-skip-permissions",
			...(this.currentModel ? ["--model", this.currentModel.model] : []),
			...(this.currentMode === "acceptEdits" ? ["--mode", "accept-edits"] : this.currentMode === "plan" ? ["--mode", "plan"] : []),
			...(conversation ? ["--conversation", conversation] : []),
		];
		const child = spawn(executable, args, {
			cwd: deck.path,
			env: {
				...process.env,
				HOME: antigravityHomeDir(),
				DECKS_STAGE_URL: `http://127.0.0.1:${this.context.port}/api/stage/eval`,
				...(this.context.canvasToken ? { DECKS_STAGE_TOKEN: this.context.canvasToken } : {}),
				// The MCP child inherits this process's environment, so the identity rides
				// in env rather than in any per-agent config file.
				DECKS_AGENT: this.context.stageAgent.id,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;

		this.stream = new AntigravityStream(translator, {
			conversation: (id) => {
				this.conversationId = id;
			},
			idle: (usage, _status) => {
				this.streamingNow = false;
				this.lastUsage = usage;
				this.context.turnEnded?.();
			},
		});
		createInterface({ input: child.stdout! }).on("line", (line) => this.receive(line));
		child.stderr?.on("data", (chunk: Buffer) => {
			// The CLI talks to its person on stderr — permission notices, model warnings —
			// and nothing in a print session is actionable by Decks' user except the
			// failure itself, which arrives as a `result` anyway. So only something that
			// reads as an error earns a notice, and then only its last line.
			const said = chunk.toString().trim();
			if (!said || !/error|warn|fail|cannot|denied/i.test(said)) return;
			const line = said.split("\n").slice(-1)[0] ?? said;
			if (line.length <= 240) notice("warn", line);
		});
		child.on("exit", (code) => {
			if (this.closed || this.swapping) return;
			this.streamingNow = false;
			translator.setState("idle");
			notice("error", `The antigravity bridge exited (${code}). This chat needs restarting.`);
		});
	}

	/** One NDJSON line from the CLI, into the transcript's terms. */
	private receive(line: string): void {
		const stream = this.stream;
		if (!stream) return;
		let event: { event?: string; init?: { conversation_id?: string }; step_update?: AntigravityStep; result?: AntigravityResult };
		try {
			event = JSON.parse(line) as typeof event;
		} catch {
			// Anything the CLI printed that is not an event is diagnostics on stdout we did
			// not ask for; ignoring it is the forward-compatible thing.
			return;
		}
		switch (event.event) {
			case "init":
				stream.init(event.init);
				return;
			case "step_update":
				stream.step(event.step_update);
				return;
			case "result":
				stream.result(event.result);
				return;
			default:
				return;
		}
	}

	private say(message: Record<string, unknown>): void {
		this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
	}

	// --- the conversation -------------------------------------------------------------

	get isStreaming(): boolean {
		return this.streamingNow;
	}

	async prompt(text: string): Promise<void> {
		const command = parseSlash(text);
		if (command && ANTIGRAVITY_COMMANDS.some((known) => known.name === command.name)) {
			this.runSlash(command.name);
			return;
		}
		this.streamingNow = true;
		this.context.translator.setState("thinking");
		// Slash commands the deck does not claim are handed through: print mode expands
		// skills and its own command set out of a prompt, and that surface is its business.
		let sent = text;
		if (!this.briefed) {
			this.briefed = true;
			sent = `${this.briefing()}\n\n${text}`;
		}
		this.say({ event: "user", message: { content: sent } });
	}

	/**
	 * What the model should know about the deck before its first word.
	 *
	 * The same briefing the other backends hand their runtimes — a deck is a directory of
	 * absolutely- positioned HTML boards, and the canvas tool is the way to reach the
	 * user's view. It belongs in the prompt because that is the one channel print mode
	 * reads; it belongs in the *first* prompt because that is the one the model cannot
	 * miss, and a conversation that resumes already has it in its history.
	 */
	private briefing(): string {
		const { deck, tool } = this.context;
		return [deckContext(deck, tool.name), "", ...tool.guidelines.map((line) => `- ${line}`)].join("\n");
	}

	async abort(): Promise<void> {
		if (!this.streamingNow) return;
		this.streamingNow = false;
		this.context.translator.setState("idle");
		// The stream has no abort message — anything but a `user` event is skipped or ends
		// the session — so a turn is stopped the only way the CLI respects: the process is
		// replaced, and `--conversation` reopens the same conversation in the new one.
		this.respawn();
	}

	commands(): SlashCommand[] {
		return ANTIGRAVITY_COMMANDS;
	}

	private runSlash(name: string): void {
		const { notice } = this.context;
		switch (name) {
			case "cost":
				this.context.showUsage?.();
				return;
			case "status":
				notice(
					"info",
					`antigravity · model ${this.currentModel?.model ?? "default"} · mode ${this.currentMode} · conversation ${this.conversationId ?? "none"}`,
				);
				return;
			case "models":
				notice("info", agyModels().map((model) => `${model.model} — ${model.label}`).join("\n"));
				return;
			default:
				notice("info", helpText(ANTIGRAVITY_COMMANDS));
		}
	}

	// --- models and modes -------------------------------------------------------------

	model(): AgentModel | undefined {
		return this.currentModel;
	}

	async models(): Promise<ModelOption[]> {
		return agyModels().map((model) => ({
			provider: "antigravity",
			model: model.model,
			label: model.label,
			// The slug carries the reasoning level (`-low`/`-medium`/`-high`), so there is
			// no separate dial: "which model" and "how hard it thinks" are one choice.
			reasoning: false,
		}));
	}

	async setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void> {
		this.currentModel = { provider, model, thinking: thinking ?? this.currentModel?.thinking ?? "off" };
		// The model is a launch flag, and respawning with `--conversation` keeps the
		// history — the same bargain the sidecar made when it reopened the agent.
		this.respawn();
	}

	setThinking(level: ThinkingLevel): void {
		// Decks' scale has no counterpart in the CLI: the model slug is the effort. A dial
		// that changed nothing would be worse than no dial, and `models()` says so.
		this.context.notice("info", "Antigravity's reasoning level is part of the model choice — pick a -low/-medium/-high model instead.");
	}

	mode(): AgentMode | undefined {
		return this.currentMode;
	}

	async setMode(mode: AgentMode): Promise<void> {
		this.currentMode = mode;
		// A launch flag, like the model; unlike the model it is changed rarely enough that
		// killing a running reply to apply it is the wrong trade.
		this.context.notice("info", `Mode is ${mode}. It applies when this chat next restarts or changes model.`);
	}

	usage(): AgentUsage | null {
		return this.lastUsage;
	}

	// --- identity and the session tree --------------------------------------------------

	name(): string | undefined {
		return this.storedName;
	}

	setName(name: string): void {
		this.storedName = name;
	}

	sessionRef(): string | undefined {
		return this.conversationId;
	}

	/** No session tree to walk: the CLI resumes a conversation but does not branch one. */
	timeline(): ConversationPoint[] {
		return [];
	}

	async syncEntryIds(): Promise<void> {}

	revisionsAt(): Record<string, string> {
		return {};
	}

	async rewindTo(): Promise<{ cancelled: boolean }> {
		return { cancelled: true };
	}

	async forkFrom(): Promise<string | undefined> {
		return undefined;
	}

	dispose(): void {
		this.closed = true;
		const child = this.child;
		this.child = undefined;
		if (child) {
			// Closing stdin is the CLI's own "session over" signal; a moment for it to
			// finish its bookkeeping, then not.
			try {
				child.stdin?.end();
			} catch {
				/* already gone */
			}
			setTimeout(() => child.kill(), 1_000).unref?.();
		}
	}

	/**
	 * Replace the process, keeping the conversation.
	 *
	 * The model change and abort both land here: kill the old `agy` — silently, because
	 * this exit is ours — and start another with `--conversation` so the next prompt
	 * answers with everything before it still in hand. The briefing is *not* resent: the
	 * conversation already has it.
	 */
	private respawn(): void {
		const child = this.child;
		if (!child) return;
		this.swapping = true;
		this.child = undefined;
		this.stream = undefined;
		// A turn in flight ends where it is; the transcript keeps what it had.
		if (this.streamingNow) {
			this.streamingNow = false;
			this.context.translator.setState("idle");
		}
		try {
			child.stdin?.end();
		} catch {
			/* already gone */
		}
		setTimeout(() => child.kill(), 500).unref?.();
		this.spawn(this.conversationId);
	}
}