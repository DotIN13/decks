import { isoIn, nowWords, offsetLabel, partsIn, processZone } from "../lib/clock.ts";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import type { VerbContext } from "./context.ts";

/** Addresses and time: a board's URL, a file's, forwarded ports, and the clock. */
export function miscVerbs(ctx: VerbContext): Pick<Stage, "resolve" | "url" | "ports" | "now"> {
	const { service, agent, port, isolated, notWhileIsolated } = ctx;
	return {
		resolve: async (file: string) => {
			if (isolated()) {
				const path = agent.boardPathOf(file) ?? file;
				if (!agent.inPlay().includes(path)) notWhileIsolated(`resolving ${file}, which is not on this stage,`);
			}
			return service.resolve(file);
		},
		url: async (path: string) => service.url(path, port),
		/**
		 * The ports forwarded through Decks, so a board can frame a server this machine runs
		 * (`ports.ts`): read with nothing, `{ open: port, label }` to forward one, `{ close: port }`
		 * to stop. Each comes back with its two addresses, as Open OnDemand names them: `node` keeps
		 * the path (for a server given that base path), `rnode` takes it off (for one at the root).
		 *
		 * An agent's verb, not a board's: a board's own code may read the list but not change it, and
		 * an isolated agent may do neither, since a forwarded port reaches outside its stage.
		 */
		ports: async (change?: { open?: number; close?: number; label?: string }) => {
			if (isolated()) notWhileIsolated("port forwarding");
			const forwards = service.forwards;
			if (!forwards) throw new Error("This server forwards no ports.");
			if (change && (change.open !== undefined || change.close !== undefined)) {
				if (agent.board) throw new Error("A board's own code cannot open or close ports; ask an agent.");
				if (change.open !== undefined) forwards.open(change.open, { ...(change.label ? { label: change.label } : {}), by: agent.identity().name });
				if (change.close !== undefined && !forwards.close(change.close)) throw new Error(`Port ${change.close} was not forwarded.`);
			}
			return forwards.all().map((one) => ({ ...one, node: `/node/localhost/${one.port}/`, rnode: `/rnode/localhost/${one.port}/` }));
		},

		/**
		 * The time where the person is: the deck's timezone (Settings, Time), which the
		 * server's own clock follows. For "since yesterday" and "by Friday", and for a
		 * session long enough that the date it was started on has passed.
		 */
		now: async () => {
			const at = Date.now();
			const zone = processZone();
			const parts = partsIn(at, zone);
			return {
				iso: isoIn(at, zone),
				timezone: zone,
				offset: offsetLabel(at, zone),
				weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][parts.weekday] ?? "",
				words: nowWords(at, zone),
				epoch: at,
			};
		},
	};
}
