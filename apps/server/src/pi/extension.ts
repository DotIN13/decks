import type { Camera, Identity } from "@decks/protocol";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { BOARD_KINDS, isBoardKind } from "../boards/templates.ts";
import { runEval, safeJson } from "../stage/eval.ts";
import type { StageService } from "../stage/service.ts";

/**
 * `decks-stage`: one extension, one tool.
 *
 * Inline rather than a file on disk, for the reason Picone builds its permission
 * layer inline: Pi hands a factory only `ExtensionAPI`, so an extension found on
 * disk could only reach the canvas by reading a config file and guessing. Built
 * here, it closes over the stage service and the agent it belongs to.
 *
 * It is also where the state that must survive a rewind is written. Every eval
 * records its outcome — context, what is shown, the camera, the identity — in the
 * tool result's `details`, and `session_start` rebuilds from the newest one on the
 * branch. That is Pi's own advice for extension state, and here it buys something
 * specific: rewinding the conversation rewinds the canvas with it, because the
 * transcript is the record of both.
 */

/** What a parent asks for when it hands work over (§6.2). */
export interface DelegateSpec {
	name?: string;
	task: string;
	/** Boards handed over: the child is given their source, not a description. */
	boards?: string[];
	/** "provider/model", if the child should run on something other than the default. */
	model?: string;
}

export interface DelegateReport {
	agent: string;
	name: string;
	report: string;
	/** Boards the child created or changed. */
	boards: string[];
}

export interface StageAgentHooks {
	id: string;
	identity(): Identity;
	context(): string[];
	setContext(paths: string[]): void;
	inPlay(): string[];
	setInPlay(paths: string[]): void;
	rename(name: string): void;
	setAvatar(url: string): void;
	agents(): Array<{ id: string; name: string; state: string; context: string[] }>;
	/** Where the browser last said it was looking. */
	camera(): Camera;
	/** Hand work to a new agent and wait for it. */
	spawn(spec: DelegateSpec): Promise<DelegateReport>;
	/**
	 * Store the board's current bytes as a revision and return its id.
	 *
	 * Called right after a write, so the session can record *which* version of a
	 * board existed at that point in the conversation (§6.7). Idempotent: the same
	 * bytes are the same revision.
	 */
	recordRevision(path: string): string | undefined;
	/** Deck-relative path for an absolute one, or undefined if it is not a board. */
	boardPathOf(file: string): string | undefined;
}

interface StageSnapshot {
	context: string[];
	/** What was on the canvas — a set, so a rewind restores the whole view. */
	inPlay: string[];
	camera: Camera;
	identity: Identity;
}

const DESCRIPTION = `Run TypeScript against the canvas the user is looking at.

Your code is the body of an async function with \`stage\` in scope; whatever you return comes back as JSON, and whatever you console.log comes back with it. The full API is in the stage.d.ts included in your context — if something is not in it, it does not exist.

**Boards are how you answer.** A question, a design, or a finished piece of work goes on a board rather than into the chat column — the user should not have to read the chat to know what is happening. \`stage.newBoard({ title, kind })\` writes the document shell (kinds: answer, design, report, plan, blank) and returns a path to fill in with write/edit, so a board costs one call instead of fifteen lines of boilerplate.

**Keep the canvas to what matters.** \`stage.show(paths)\` sets what is on the canvas and fits the camera to it. \`stage.hide(paths)\` takes a board off the canvas but keeps it in your context. \`stage.attach\` / \`stage.detach\` are the context itself, which is what the rail beside the canvas lists. The camera never moves unless you call \`show\`.

Also here: look at the deck (\`stage.boards\`, \`stage.read\`), place boards (\`stage.move\`), resolve a path to embed (\`stage.resolve\`), get a URL to screenshot with Playwright (\`stage.url\`), name yourself and draw your own avatar (\`stage.me\`).

Hand work to a subagent with \`stage.delegate({ task, boards })\`: it gets the source of the boards you name, so it starts from the same plan you are working to, and it reports by changing them.

Board *content* is files — write and edit it with your ordinary tools, not through this.`;

export function decksStage(deps: {
	stage: StageService;
	agent: StageAgentHooks;
	port: number;
	/**
	 * Handed a way to tell the agent something between turns.
	 *
	 * Only an extension can do this — `pi.sendMessage` is on `ExtensionAPI` — so the
	 * app cannot reach the model directly and should not try. This is how a user's
	 * edit to a board becomes something the agent knows (§6.5).
	 */
	bind?: (tell: (text: string) => void) => void;
}): InlineExtension {
	const { stage: service, agent, port } = deps;

	const asList = (path: string | string[]) => (Array.isArray(path) ? path : [path]);

	const stage = {
		// --- reads ---------------------------------------------------------------
		boards: async () => service.boards(),
		read: async (path: string) => service.read(path),
		roots: async () => service.roots(),
		resolve: async (file: string) => service.resolve(file),
		url: async (path: string) => service.url(path, port),

		/**
		 * Start a board: the shell, written for you, so you write only the content.
		 *
		 * Attaches it and puts it on the canvas — without moving the camera, which stays
		 * where the user left it until `show` is called. Returns the deck-relative path to
		 * edit.
		 */
		newBoard: async (options: { title: string; kind?: string; w?: number; h?: number }) => {
			const title = options?.title?.trim();
			if (!title) throw new Error("A board needs a title");
			const kind = options.kind ?? "blank";
			if (!isBoardKind(kind)) throw new Error(`Unknown kind ${kind}; use one of ${BOARD_KINDS.join(", ")}`);

			const path = service.newBoard({ title, kind, size: { ...(options.w ? { w: options.w } : {}), ...(options.h ? { h: options.h } : {}) } });
			agent.setContext([...agent.context(), path]);
			agent.setInPlay([...agent.inPlay(), path]);
			return path;
		},

		// --- context -------------------------------------------------------------
		attach: async (path: string | string[]) => {
			const wanted = asList(path);
			for (const one of wanted) {
				if (!service.boards().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			// Attach order is kept: it is the order the rail shows, and the order a
			// subagent is handed them in.
			const next = [...agent.context()];
			for (const one of wanted) if (!next.includes(one)) next.push(one);
			agent.setContext(next);
			// A board taken up is a board put on the canvas: attaching something the user
			// then cannot see would make the rail the only evidence it happened.
			agent.setInPlay([...agent.inPlay(), ...wanted]);
			return service.boards().filter((board) => next.includes(board.path));
		},
		detach: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			const next = agent.context().filter((held) => !dropping.has(held));
			agent.setContext(next);
			return service.boards().filter((board) => next.includes(board.path));
		},
		context: async () => {
			const held = agent.context();
			return service.boards().filter((board) => held.includes(board.path));
		},
		inPlay: async () => {
			const playing = agent.inPlay();
			return service.boards().filter((board) => playing.includes(board.path));
		},

		// --- the canvas ------------------------------------------------------------
		/**
		 * Put these boards on the canvas, and nothing else.
		 *
		 * `show` is the narrowing gesture: the canvas becomes exactly what is named, the
		 * camera fits it, and anything not already held is attached — showing a board is
		 * working on it, and requiring a separate attach would be a step to forget.
		 * `show(await stage.context())` puts everything back.
		 */
		show: async (path: string | string[], options?: { fit?: "board" | "all"; highlight?: string }) => {
			const paths = asList(path);
			for (const one of paths) {
				if (!service.boards().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			agent.setInPlay(paths);
			await service.show(paths, options ?? {});
		},
		/** Take boards off the canvas, keeping them in context. */
		hide: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			agent.setInPlay(agent.inPlay().filter((playing) => !dropping.has(playing)));
		},
		move: async (path: string, at: { x: number; y: number }) => service.move(path, at),
		camera: (async (at?: Camera) => {
			if (!at) return agent.camera();
			await service.setCamera(at);
			return undefined;
		}) as {
			(): Promise<Camera>;
			(at: Camera): Promise<void>;
		},
		reload: async (path: string) => service.reload(path),
		cursor: async (path: string, at: { x: number; y: number } | null) =>
			service.cursor(path, at, agent.identity().name, agent.identity().color),
		toast: async (text: string) => service.toast(text),

		// --- identity -------------------------------------------------------------
		me: {
			setName: async (name: string) => {
				const clean = name.trim().slice(0, 40);
				if (!clean) throw new Error("A name cannot be empty");
				agent.rename(clean);
			},
			setAvatar: async (avatar: { emoji: string } | { svg: string }) => {
				if ("emoji" in avatar) {
					// An emoji becomes a data URL rather than a special case in the
					// browser: one code path for "the agent has a picture".
					const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="44" font-size="44" text-anchor="middle">${escapeXml(avatar.emoji.slice(0, 4))}</text></svg>`;
					agent.setAvatar(service.writeAvatar(agent.id, svg));
					return;
				}
				if (!/^\s*<svg[\s>]/i.test(avatar.svg)) throw new Error("An SVG avatar must start with <svg>");
				agent.setAvatar(service.writeAvatar(agent.id, avatar.svg));
			},
			get: async () => agent.identity(),
		},

		/**
		 * Hand work to a subagent, with the boards it needs (§6.2).
		 *
		 * The child gets the *source* of each board rather than a summary, and the
		 * instruction that those boards are the plan of record. That is the whole
		 * point of boards being files: alignment is a paste, not a briefing.
		 */
		delegate: async (spec: DelegateSpec) => {
			if (!spec?.task?.trim()) throw new Error("A delegated task needs a description");
			return agent.spawn({
				...spec,
				// The parent's own context is the default handover: if it did not say
				// which boards, it means the ones it is working on.
				boards: spec.boards ?? agent.context(),
			});
		},

		agents: async () =>
			agent.agents().map((other) => ({
				id: other.id,
				name: other.name,
				me: other.id === agent.id,
				state: other.state,
				context: other.context,
			})),
	};

	const snapshot = (): StageSnapshot => ({
		context: agent.context(),
		inPlay: agent.inPlay(),
		camera: agent.camera(),
		identity: agent.identity(),
	});

	return {
		name: "decks-stage",
		factory: (pi: ExtensionAPI) => {
			/*
			 * `nextTurn`, not `steer`: the user changing a board is not an interruption.
			 * It rides along with whatever they say next, which is when it matters —
			 * and if they say nothing, the agent finds it at the top of its next turn
			 * instead of being woken up by it.
			 */
			deps.bind?.((text) =>
				pi.sendMessage(
					{ customType: "decks-user-edit", content: text, display: false },
					{ deliverAs: "nextTurn" },
				),
			);

			pi.registerTool({
				name: "stage_eval",
				label: "Stage",
				description: DESCRIPTION,
				promptSnippet: "Run TypeScript against the canvas: show boards, hold them in context, name yourself",
				promptGuidelines: [
					"Answer on a board: stage.newBoard for the shell, write/edit for the content, stage.show to put it in front of the user.",
					"The board carries the answer; the chat reply names it and may recap or add to it. What is never acceptable is the substance in chat with a stub on the board, or a board that only makes sense after reading the chat.",
					"When work is finished, report on a board — method, result, what is left — rather than describing it in the chat column.",
					"Keep the canvas to what matters now: stage.show narrows it, stage.hide takes a board off it without dropping it from your context.",
				],
				parameters: Type.Object({
					code: Type.String({
						description: "TypeScript, run as an async function body with `stage` in scope. Return a value to see it.",
					}),
				}),
				async execute(_toolCallId, params) {
					const outcome = await runEval(params.code, stage);
					const parts: string[] = [];
					if (outcome.logs.length > 0) parts.push(outcome.logs.join("\n"));
					if (outcome.error) parts.push(`Error: ${outcome.error}`);
					else if (outcome.value !== undefined) parts.push(safeJson(outcome.value));
					else parts.push("(done)");

					// A failed eval is a failed tool call: thrown, so Pi marks it as an
					// error and the model sees it as one rather than as a result that
					// happens to contain the word "Error".
					if (outcome.error && !outcome.timedOut) throw new Error(`${outcome.error}${outcome.logs.length ? `\n${outcome.logs.join("\n")}` : ""}`);

					return { content: [{ type: "text", text: parts.join("\n") }], details: snapshot() };
				},
			});

			/**
			 * Write down which version of a board this turn produced (§6.7).
			 *
			 * A custom entry, so it costs no LLM context and travels in the session
			 * tree — which is what lets the timeline show a board as it was at a point
			 * in the conversation, rather than only as it is now.
			 *
			 * Keyed off the tool result rather than the watcher because the watcher
			 * cannot say *who* wrote the file or *when* in the conversation.
			 */
			pi.on("tool_result", async (event) => {
				// The event carries the tool's name, its input and whether it failed —
				// flat, not wrapped in a message. Reading it as a message was why no
				// revision was ever recorded into a session.
				const result = event as { toolName?: string; isError?: boolean; input?: Record<string, unknown> };
				if (!result.toolName || result.isError) return;
				if (!["write", "edit", "multi_edit"].includes(result.toolName)) return;

				const args = result.input ?? {};
				const candidate = typeof args.path === "string" ? args.path : typeof args.file === "string" ? args.file : undefined;
				if (!candidate) return;
				const board = agent.boardPathOf(candidate);
				if (!board) return;

				const sha = agent.recordRevision(board);
				if (sha) pi.appendEntry("board-rev", { path: board, sha, by: agent.id });
			});

			/**
			 * Rebuild from the branch, not from memory.
			 *
			 * On a fresh session this finds nothing and the defaults stand. On a resumed
			 * or rewound one it finds the newest `stage_eval` result on the current path
			 * and restores what the agent was holding and calling itself at that point.
			 */
			pi.on("session_start", async (_event, ctx) => {
				for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
					if (entry.type !== "message") continue;
					const message = entry.message as { role?: string; toolName?: string; details?: unknown };
					if (message.role !== "toolResult" || message.toolName !== "stage_eval") continue;
					const details = message.details as Partial<StageSnapshot> | undefined;
					if (!details) continue;
					if (Array.isArray(details.context)) agent.setContext(details.context.filter((path) => typeof path === "string"));
					if (Array.isArray(details.inPlay)) agent.setInPlay(details.inPlay.filter((path) => typeof path === "string"));
					if (details.identity?.name) agent.rename(details.identity.name);
					if (details.identity?.avatar) agent.setAvatar(details.identity.avatar);
					break;
				}
			});
		},
	};
}

function escapeXml(text: string): string {
	return text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
