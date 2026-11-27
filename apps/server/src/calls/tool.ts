import { identityReminder } from "../agents/identity-reminder.ts";
import { canvasNameReminder } from "../canvas/canvas-name.ts";
import type { Verbs } from "@decks/sdk";
import type { DecksToolSpec } from "../agents/hooks.ts";
import type { CanvasSnapshot } from "../agents/work.ts";
import { penWriter } from "../canvas/pens.ts";
import { inCall, verbContext } from "./context.ts";
import { appsVerbs } from "./apps.ts";
import { webVerbs } from "./web.ts";
import { miscVerbs } from "./misc.ts";
import { canvasVerbs } from "./canvas.ts";
import { cardVerbs } from "./cards.ts";
import { fileVerbs } from "./files.ts";
import { agentVerbs } from "./agent.ts";
import { viewVerbs } from "./view.ts";
import { renamedVerb } from "./renamed.ts";
import { gestures, type Gestures } from "./gestures.ts";

/**
 * One caller's canvas (DESIGN §6.3): the verbs bound to an agent, the person or an app.
 *
 * The verbs themselves are in `calls/`, a module per group, given a `VerbContext` built here; this
 * file puts them on one object, answers `call` (what `/api/v1/<verb>` runs) with the value, the
 * notes and the pictures, adds the agent's reminders, and keeps the snapshot a rewind restores.
 * Every runtime's agent reaches it the same way, through the `decks` command, so no runtime has
 * words of its own about what a card is for.
 */

export interface DecksTool {
	/**
	 * The object the verbs act through, bound to this caller: an agent, the person, or an
	 * app acting for a conversation (`calls/app-caller.ts`).
	 */
	readonly verbs: Verbs;
	/**
	 * Call one verb by its name in the verb table (`canvas.move`, `canvas.batch`); an old name is refused with its new call, with its arguments as a list.
	 *
	 * What `/api/v1/<verb>` answers with (`calls/run.ts`): the value, the notes the verb added
	 * (where an item went, what `decks.canvas.fit` measured, the reminders), and any pictures. A verb
	 * that throws is an answer too, `ok: false` with its sentence.
	 */
	call(name: string, args: readonly unknown[], on?: { canvas?: string }): Promise<CallResult>;
	/** What the person's hands did on the canvas, sent over the socket (`calls/gestures.ts`): not a verb. */
	gesture<G extends keyof Gestures>(name: G, args: Parameters<Gestures[G]>): Promise<CallResult>;
	snapshot(): CanvasSnapshot;
}

/** One verb called over HTTP: see `DecksTool.call`. */
export interface CallResult {
	ok: boolean;
	value?: unknown;
	error?: string;
	notes: string[];
	images?: Array<{ data: string; mimeType: string }>;
}

export function createDecksTool(deps: DecksToolSpec): DecksTool {
	const { canvas: service, agent, port } = deps;
	const ctx = verbContext({ canvas: service, agent, port });

	/**
	 * The verbs, one module per group (`calls/`), on one object: what `call` looks a verb up on, and
	 * what a card or an app acts through. Typed by the SDK's generated `Verbs`, so the table, the
	 * routes and these handlers cannot disagree about a verb's name or its arguments.
	 */
	const verbs: Verbs = {
		...miscVerbs(ctx),
		...canvasVerbs(ctx),
		...cardVerbs(ctx),
		...fileVerbs(ctx),
		...agentVerbs(ctx),
		...viewVerbs(ctx),
		...appsVerbs(ctx),
		...webVerbs(ctx),
	};

	const hands = gestures(ctx);

	const snapshot = (): CanvasSnapshot => ({
		// The arrangement this canvas is looking at, so a resume or a rewind restores where the cards
		// were and not merely which ones were up.
		positions: deps.agent.positions?.(),
		context: agent.context(),
		inPlay: agent.inPlay(),
		camera: agent.camera(),
		identity: agent.identity(),
	});

	return {
		verbs,
		snapshot,

		async gesture(name, args) {
			return inCall(undefined, async (frame) => {
				let answer: CallResult;
				try {
					const value = await (hands[name] as (...given: unknown[]) => Promise<unknown>)(...args);
					answer = { ok: true, value, notes: [...frame.notes] };
				} catch (error) {
					answer = { ok: false, error: error instanceof Error ? error.message : String(error), notes: [] };
				}
				deps.persist?.(snapshot());
				return answer;
			});
		},

		async call(name: string, args: readonly unknown[], on: { canvas?: string } = {}): Promise<CallResult> {
			// A frame of its own: its notes, pictures and canvas (what `here()` means for it), whatever runs beside it.
			return inCall(on.canvas, (frame) => runCall(name, args, frame));
		},
	};

	async function runCall(name: string, args: readonly unknown[], frame: { notes: string[]; images: Array<{ data: string; mimeType: string }> }): Promise<CallResult> {
			const path = name.split(".");
			let owner: unknown = verbs;
			for (const key of path.slice(0, -1)) owner = (owner as Record<string, unknown> | undefined)?.[key];
			const verb = (owner as Record<string, unknown> | undefined)?.[path[path.length - 1]!];
			if (typeof verb !== "function") return { ok: false, error: renamedVerb(name) ?? `${name} is not a verb.`, notes: [] };
			let answer: CallResult;
			try {
				const run = () => (verb as (...given: unknown[]) => Promise<unknown>).apply(owner, [...args]);
				// What an agent draws is its own: the canvas remembers it as the last writer (`penWriter`).
				const value = await (agent.person ? run() : penWriter.run(agent.id, run));
				answer = { ok: true, value, notes: [] };
			} catch (error) {
				answer = { ok: false, error: error instanceof Error ? error.message : String(error), notes: [] };
			}
			// After the verb's own notes, the agent's reminders: who it is, and what its canvas is called.
			// Not for the person, whose clicks are theirs and not the agent's.
			const said = [...frame.notes];
			if (!agent.person) {
				const unsaid = identityReminder(agent.identity(), { afterCall: true });
				if (unsaid) said.push(unsaid);
				const unnamed = canvasNameReminder(service.pens, agent.canvasName?.());
				if (unnamed) said.push(unnamed);
			}
			deps.persist?.(snapshot());
			return { ...answer, notes: said, ...(frame.images.length > 0 ? { images: [...frame.images] } : {}) };
	}
}
