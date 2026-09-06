import type { AgentKind, AgentMode, Camera, Identity, ThinkingLevel } from "@decks/protocol";
import { BOARD_KINDS, isBoardKind } from "../boards/templates.ts";
import { runEval, safeJson } from "./eval.ts";
import type { StageService } from "./service.ts";

/**
 * The canvas tool, defined once for every runtime (DESIGN §6.3).
 *
 * This file is the tool: its description, its guidelines, the `stage` object the code runs
 * against, and what a run returns. What it deliberately does not know is how a runtime is
 * told about a tool — Pi takes a definition with a TypeBox schema, the Claude SDK takes an
 * in-process MCP server with a Zod one — so each backend has a thin adapter and neither
 * owns the wording.
 *
 * The wording is the part that matters. Two runtimes drifting apart on what a board is for
 * would be two products.
 */

/** What a parent asks for when it hands work over (§6.2). */
export interface DelegateSpec {
	name?: string;
	task: string;
	/** Boards handed over: the child is given their source, not a description. */
	boards?: string[];
	/** "provider/model", if the child should run on something other than the default. */
	model?: string;
	/**
	 * The runtime the child is: fixed at creation, exactly as the `+` button fixes it.
	 *
	 * Omit it and the child gets the server's default. It is the one field that can never
	 * change afterwards, so asking for it here is the only way to get it.
	 */
	kind?: AgentKind;
	/**
	 * The thinking level, on its own scale from the model — the same reason the composer
	 * draws it as a separate control below the model list.
	 */
	thinking?: ThinkingLevel;
	/**
	 * How much the child asks before acting, from its runtime's own set.
	 *
	 * The runtimes do not all offer all four — pi has none at all, antigravity two — and
	 * asking for one a runtime does not have is not an error: the child does the work on
	 * its default mode and the parent is told it did not get what it asked for.
	 */
	mode?: AgentMode;
}

/**
 * What one agent hands to another that already exists (the queue, not a spawn).
 *
 * No `model`: a delegation creates the agent it is about to run, so choosing its model is
 * part of creating it. A send lands in a conversation that is already somebody's, on
 * whatever model that conversation is having — changing it from outside would rewrite the
 * voice of a chat the user is reading. The same argument bars `kind`, `thinking` and
 * `mode`: they are all choices about how a piece of work is *created*, and a send creates
 * nothing.
 */
export interface SendSpec {
	task: string;
	/** Boards handed over: the receiver is given their source when the item runs. */
	boards?: string[];
	/**
	 * Tell the sender when the work is done.
	 *
	 * Off by default: most sends are genuinely *theirs* — you handed it over because you
	 * had nothing more to do with the answer, and a reply you did not ask for is an
	 * interruption. When set, the receiver's report is delivered to the sender as a notice
	 * in their transcript when the item runs — never as a queued task, because a task runs
	 * a turn of the sender's own, and a turn that answers a report with another report is
	 * two agents talking forever.
	 */
	reply?: boolean;
}

/** One item waiting in an agent's queue. */
export interface QueuedWork {
	/** The agent that sent it, and what it was calling itself at the time. */
	from: string;
	fromName: string;
	task: string;
	boards: string[];
	at: number;
	/** The sender asked for the report back — see `SendSpec.reply`. */
	reply?: boolean;
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
	/** Replaces the agent's own tags and returns them as stored — see `agents/tags.ts`. */
	setTags(tags: unknown): string[];
	agents(): Array<{ id: string; name: string; state: string; context: string[]; holding: number; kind: AgentKind; tags: string[]; queued?: number }>;
	/** Where the browser last said it was looking. */
	camera(): Camera;
	/** Hand work to a new agent and wait for it. */
	spawn(spec: DelegateSpec): Promise<DelegateReport>;
	/** Queue work for an agent that already exists, and return without waiting. */
	send(target: string, spec: SendSpec): { queued: true; position: number };
	/** What is waiting for an agent — this one, unless another is named. */
	queue(agentId?: string): QueuedWork[];
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

/**
 * What an agent was holding, showing and calling itself.
 *
 * Persisted by the shell rather than carried in the transcript (§6.2). Pi could ride it in
 * a tool result's `details` and rebuild from the session branch; the Claude SDK has no
 * equivalent — `structuredContent` looks like one but replaces the tool's own text — so
 * both runtimes now use one store and there is one code path to be wrong in.
 */
export interface StageSnapshot {
	context: string[];
	/** What was on the canvas — a set, so a rewind restores the whole view. */
	inPlay: string[];
	camera: Camera;
	identity: Identity;
}

export interface StageToolResult {
	/** What the model reads. */
	text: string;
	/** Whether the run failed, which each runtime signals in its own way. */
	isError: boolean;
}

export interface StageTool {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly promptSnippet: string;
	readonly guidelines: string[];
	readonly parameterDescription: string;
	run(code: string): Promise<StageToolResult>;
	snapshot(): StageSnapshot;
}

export const STAGE_TOOL_NAME = "stage_eval";

const DESCRIPTION = `Run TypeScript against the canvas the user is looking at.

Your code is the body of an async function with \`stage\` in scope; whatever you return comes back as JSON, and whatever you console.log comes back with it. The full API is in the stage.d.ts included in your context — if something is not in it, it does not exist.

**Boards are how you answer.** A question, a design, or a finished piece of work goes on a board rather than into the chat column — the user should not have to read the chat to know what is happening. \`stage.newBoard({ title, kind })\` writes the document shell (kinds: answer, design, report, plan, blank) and returns a path to fill in with write/edit, so a board costs one call instead of fifteen lines of boilerplate; it also tells you the viewport, so you can see what the size you chose will look like.

**Keep the canvas to what matters.** \`stage.show(paths)\` sets what is on the canvas and fits the camera to it. \`stage.hide(paths)\` takes a board off the canvas but keeps it in your context. \`stage.attach\` / \`stage.detach\` are the context itself, which is what the rail beside the canvas lists. The camera never moves unless you call \`show\`.

**A board does not scroll, so a board that is too small clips — silently.** \`stage.fit(path)\` sizes it to what is on it: write the content, \`show\` it, then fit. The measurement is taken in the frame showing the board, so it has to be on the canvas; \`stage.boards()\` carries the same reading as \`content\` and \`clipped\`. \`stage.resize(path, { w, h })\` sets a size outright.

Also here: look at the deck (\`stage.boards\`, \`stage.read\`), place boards (\`stage.move\`), resolve a path to embed (\`stage.resolve\`), get a URL to screenshot with Playwright (\`stage.url\`), name yourself and draw your own avatar (\`stage.me\`).

Two ways to hand work over. \`stage.delegate({ task, boards })\` makes a subagent and waits for its report — it gets the source of the boards you name, so it starts from the same plan you are working to. \`stage.send(who, { task, boards })\` queues work for an agent that **already exists** and returns immediately; they run it once they have been quiet for a moment. Delegate when the answer is a step in what you are doing; send when the work is theirs.

Board *content* is files — write and edit it with your ordinary tools, not through this.`;

const GUIDELINES = [
	"Answer on a board: stage.newBoard for the shell, write/edit for the content, stage.show to put it in front of the user.",
	"The board carries the answer; the chat reply names it and may recap or add to it. What is never acceptable is the substance in chat with a stub on the board, or a board that only makes sense after reading the chat.",
	"When work is finished, report on a board — method, result, what is left — rather than describing it in the chat column.",
	"Keep the canvas to what matters now: stage.show narrows it, stage.hide takes a board off it without dropping it from your context.",
	"Board files are edited in place — Write, Edit, cat > file. Never a temp-file-and-rename (sed -i, an atomic save): it replaces the file the canvas is watching.",
	"After writing a board, stage.fit it rather than guessing whether it clips. A board does not scroll, so content past its edge is simply not drawn.",
	/*
	 * The one guideline that is about the *chat list* rather than the canvas.
	 *
	 * It is here as well as in `stage.d.ts` because the two are read differently: the d.ts is
	 * reference, consulted when reaching for a call, and these are instructions read once at
	 * the top. An API documented only in reference material is an API nobody remembers exists
	 * — which for tags means a row that is permanently empty, and the feature not existing.
	 */
	"Say what you are working on: stage.me.setTags(['panel-css', 'measuring']) when you start on something, and setTags([]) when you stop. It is how the user sees what each agent is up to without opening every conversation. Short nouns, not sentences.",
];

export function createStageTool(deps: {
	stage: StageService;
	agent: StageAgentHooks;
	port: number;
	/** Where the snapshot goes after every run, so a resume or a rewind can restore it. */
	persist?: (snapshot: StageSnapshot) => void;
}): StageTool {
	const { stage: service, agent, port } = deps;
	const asList = (path: string | string[]) => (Array.isArray(path) ? path : [path]);

	/**
	 * Lines added to the tool's result that the code did not return.
	 *
	 * There is exactly one today — the viewport, after `newBoard` — and it is here rather
	 * than in the return value because the return value is an API: `const path = await
	 * stage.newBoard(...)` is in every board this deck has written, and a call that started
	 * answering with an object instead of a path would break all of them. The model reads
	 * the result text, so that is where a number it should notice belongs.
	 */
	let notes: string[] = [];

	/** The canvas's own size, or nothing if no browser has ever reported one. */
	const viewport = () => service.viewport(agent.id);

	const stage = {
		// --- reads ---------------------------------------------------------------
		boards: async () => service.boards(),
		read: async (path: string) => service.read(path),
		roots: async () => service.roots(),
		resolve: async (file: string) => service.resolve(file),
		url: async (path: string) => service.url(path, port),
		/**
		 * How much room the canvas has, in CSS pixels — the window minus the chrome standing
		 * beside it, not divided by the zoom.
		 *
		 * `undefined` when nobody is looking, or before the first reading. There is no default
		 * on purpose: a made-up number is indistinguishable from a measured one at the point
		 * it is used, and a board sized against a fiction is worse than a board sized against
		 * your own judgement.
		 */
		viewport: async () => viewport(),

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

			const path = service.newBoard({
				title,
				kind,
				size: { ...(options.w ? { w: options.w } : {}), ...(options.h ? { h: options.h } : {}) },
			});
			agent.setContext([path, ...agent.context()]);
			agent.setInPlay([...agent.inPlay(), path]);
			/*
			 * The size of the thing you are about to fill, said once, at the moment you would
			 * use it.
			 *
			 * No judgement with it — no "fits", no "too big". The number is the whole
			 * mechanism: an agent that knows the canvas is 1400×900 does not need a rule about
			 * how big a board should be, and a rule without the number was only ever a guess
			 * ("a board that is too small clips") that nobody could check.
			 */
			const view = viewport();
			if (view) notes.push(`viewport ${view.width}×${view.height} px`);
			return path;
		},

		/**
		 * A mirror: a live view of a conversation, on the canvas.
		 *
		 * The board it writes never changes — its turns arrive in the browser, from a
		 * transcript the app is already holding for every agent. So mirroring somebody
		 * you are not talking to costs a `postMessage`, which is the point of it: three
		 * mirrors side by side is what everyone is doing, without opening three chats.
		 *
		 * Attached and put on the canvas, camera unmoved, exactly as `newBoard` is. Asking
		 * twice for the same agent hands back the board you already have.
		 */
		mirror: async (options?: { of?: string; w?: number; h?: number }) => {
			const wanted = options?.of?.trim();
			const others = agent.agents();
			const found = wanted
				? (others.find((other) => other.id === wanted) ??
					others.find((other) => other.name.toLowerCase() === wanted.toLowerCase()))
				: others.find((other) => other.id === agent.id);
			if (!found) {
				throw new Error(
					wanted
						? `No agent called ${wanted}. Use an id or a name from stage.agents().`
						: "This conversation is not in the agent list yet, so there is nothing to mirror.",
				);
			}
			const path = service.mirror({
				agentId: found.id,
				name: found.name,
				size: { ...(options?.w ? { w: options.w } : {}), ...(options?.h ? { h: options.h } : {}) },
			});
			agent.setContext([path, ...agent.context().filter((held) => held !== path)]);
			agent.setInPlay([...agent.inPlay().filter((shown) => shown !== path), path]);
			return { path, of: found.name, agent: found.id };
		},

		/**
		 * Set a board's size, in one call, without opening the file.
		 *
		 * Either dimension on its own is allowed, because the one that is usually wrong is
		 * the height.
		 */
		resize: async (path: string, size: { w?: number; h?: number }) => {
			if (!size || (size.w === undefined && size.h === undefined)) throw new Error("A resize needs a width, a height, or both");
			const board = service.resize(path, size);
			return { path: board.path, w: board.w, h: board.h };
		},

		/**
		 * Size a board to what is on it: the height from the content, the width only if
		 * something has been pushed past the edge.
		 */
		fit: async (path: string, options?: { margin?: number }) => {
			const board = await service.fit(path, options);
			const content = service.boards().find((one) => one.path === board.path)?.content;
			return { path: board.path, w: board.w, h: board.h, ...(content ? { content } : {}) };
		},

		// --- context -------------------------------------------------------------
		attach: async (path: string | string[]) => {
			const wanted = asList(path);
			for (const one of wanted) {
				if (!service.boards().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			// Most-recently-touched first: the boards just attached lead the list — the last one
			// named is the most recent — and boards already held that are not re-attached keep
			// their existing recency behind them. Re-attaching a board is a fresh touch, which is
			// why it leaves its old place and joins the front. `setContext` stores the order,
			// and the rail, the canvas and `stage.agents()` all read the same list.
			const retained = agent.context().filter((held) => !wanted.includes(held));
			const next = [...wanted].reverse().concat(retained);
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
			return service.show(agent.id, paths, options ?? {});
		},
		/** Take boards off the canvas, keeping them in context. */
		hide: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			agent.setInPlay(agent.inPlay().filter((playing) => !dropping.has(playing)));
		},
		move: async (path: string, at: { x: number; y: number }) => service.move(path, at),
		camera: (async (at?: Camera) => {
			if (!at) return agent.camera();
			await service.setCamera(agent.id, at);
			return undefined;
		}) as {
			(): Promise<Camera>;
			(at: Camera): Promise<void>;
		},
		reload: async (path: string) => service.reload(agent.id, path),
		cursor: async (path: string, at: { x: number; y: number } | null) =>
			service.cursor(agent.id, path, at, agent.identity().name, agent.identity().color),
		toast: async (text: string) => service.toast(agent.id, text),

		// --- identity -------------------------------------------------------------
		/**
		 * Point at something on a board: a bubble with a small arrow, drawn on the canvas.
		 *
		 * Transient — nothing is written to the board file, so a board that has been annotated
		 * is byte-identical to one that has not. `to` is a component's `data-id`, which is what
		 * makes the arrow follow it when it moves; a `{ x, y }` is taken as a board coordinate.
		 * Four at most per board, and `null` clears the ones this agent put there.
		 */
		annotate: async (path: string, marks: unknown) => service.annotate(agent.id, path, marks),

		me: {
			setName: async (name: string) => {
				const clean = name.trim().slice(0, 40);
				if (!clean) throw new Error("A name cannot be empty");
				agent.rename(clean);
			},
			/**
			 * What this agent is doing, in its own words. Replaces the list.
			 *
			 * Returns the tags **as stored**, which is not always what was passed: they are
			 * slugged, deduped and capped at four, so `["Reading panel.css and measuring"]`
			 * comes back as `["reading-panel-css-and"]`. Returning them is the only way a model
			 * finds that out, and the alternative — silently storing something different from
			 * what it thinks it set — is how an agent ends up re-setting the same tags forever.
			 */
			setTags: async (tags: string[]) => agent.setTags(tags),
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

		/**
		 * Hand work to an agent that already exists, and carry on.
		 *
		 * The difference from `delegate` is the whole point: `delegate` makes a new agent and
		 * blocks until it reports, which is right when the work is a step in what you are
		 * doing. `send` puts an item in somebody else's queue and returns — right when the
		 * work is *theirs*, when they are the one holding that part of the deck, or when you
		 * have nothing to do with the answer.
		 *
		 * The receiver runs it once it has been quiet for a while, so it never interrupts a
		 * turn in progress, and it is handed the board *source* when it runs — not when you
		 * sent it, so a board that changes in between is read as it is.
		 */
		send: async (target: string, spec: SendSpec) => {
			if (!target?.trim()) throw new Error("Say which agent: an id or a name from stage.agents()");
			if (!spec?.task?.trim()) throw new Error("Sent work needs a description");
			return agent.send(target.trim(), {
				task: spec.task,
				...(spec.boards ? { boards: spec.boards } : {}),
				...(spec.reply ? { reply: true } : {}),
			});
		},
		/** What is waiting for an agent: yours, or another's if you name it. */
		queue: async (agentId?: string) => agent.queue(agentId),

		agents: async () =>
			agent.agents().map((other) => ({
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
				/** How much is already waiting for them — a queue of six is a reason to send elsewhere. */
				queued: other.queued ?? 0,
			})),
	};

	const snapshot = (): StageSnapshot => ({
		context: agent.context(),
		inPlay: agent.inPlay(),
		camera: agent.camera(),
		identity: agent.identity(),
	});

	return {
		name: STAGE_TOOL_NAME,
		label: "Stage",
		description: DESCRIPTION,
		promptSnippet: "Run TypeScript against the canvas: show boards, hold them in context, name yourself",
		guidelines: GUIDELINES,
		parameterDescription: "TypeScript, run as an async function body with `stage` in scope. Return a value to see it.",
		snapshot,

		async run(code: string): Promise<StageToolResult> {
			notes = [];
			const outcome = await runEval(code, stage);
			const parts: string[] = [];
			if (outcome.logs.length > 0) parts.push(outcome.logs.join("\n"));
			if (outcome.error) parts.push(`Error: ${outcome.error}`);
			else if (outcome.value !== undefined) parts.push(safeJson(outcome.value));
			else parts.push("(done)");
			// After the value, because the value is the answer and this is a fact about the
			// canvas the call happened on.
			if (notes.length > 0) parts.push(...notes);

			// Written after every run, failed ones included: a run that threw halfway may
			// still have attached a board, and the snapshot is what the canvas is restored
			// from.
			deps.persist?.(snapshot());

			// A timed-out eval is reported rather than raised — the code may well have done
			// its work before the timer — which is the one case that is an error to read
			// and not an error to fail.
			return { text: parts.join("\n"), isError: Boolean(outcome.error) && !outcome.timedOut };
		},
	};
}

function escapeXml(text: string): string {
	return text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
