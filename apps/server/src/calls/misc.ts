import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isoIn, nowWords, offsetLabel, partsIn, processZone } from "../lib/clock.ts";
import type { Verbs } from "@decks/sdk";
import type { VerbContext } from "./context.ts";
import { syncWords } from "../studio/index.ts";

/** Forwarded ports, the clock, and the link to Decks Studio. */
export function miscVerbs(ctx: VerbContext): Pick<Verbs, "ports" | "now" | "studio" | "pair"> {
	const { service, agent } = ctx;
	return {
		/**
		 * The ports forwarded through Decks, so a card can frame a server this machine runs
		 * (`ports.ts`): read with nothing, `{ open: port, label }` to forward one, `{ close: port }`
		 * to stop. Each comes back with its two addresses, as Open OnDemand names them: `node` keeps
		 * the path (for a server given that base path), `rnode` takes it off (for one at the root).
		 *
		 * An agent's verb, not a card's: a card's own code may read the list but not change it.
		 */
		ports: async (change?: { open?: number; close?: number; label?: string }) => {
			const forwards = service.forwards;
			if (!forwards) throw new Error("This server forwards no ports.");
			if (change && (change.open !== undefined || change.close !== undefined)) {
				if (agent.app) throw new Error("An app's own code cannot open or close ports; ask an agent.");
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

		/**
		 * A pairing code for another Decks front end, such as Studio, to connect with
		 * (`auth/issue.ts`): the same code Settings, Other Decks makes, for a harness with no
		 * screen. Not a card's: its page could make one and hand it to anyone.
		 */
		pair: {
			code: async () => {
				if (agent.app) throw new Error("An app's own code cannot make a pairing code.");
				if (!service.pairCode) throw new Error("This server pairs with no one.");
				const made = service.pairCode();
				ctx.notes.push(`Type it where the other Decks asks for a code, within ${Math.round((made.expires - Date.now()) / 60_000)} minutes. It works once.`);
				return made;
			},
		},

		/*
		 * Decks Studio (`studio/`). The harness signs in itself, as Claude Code does: `login` answers an
		 * address on Studio, which shows a code to any browser signed in there, and `code` takes the code,
		 * pasted, since a machine with no screen has no browser to send back.
		 * Only the person: an agent or a card that could sign the harness in could send the whole deck to
		 * an account of its choosing.
		 */
		studio: {
			login: async (url?: string) => {
				if (!agent.person) throw new Error("Only the person can sign this harness in to Decks Studio.");
				if (!service.studioLogin) throw new Error("This server signs in to no Studio.");
				const open = await service.studioLogin(typeof url === "string" ? url : undefined);
				ctx.notes.push(`Open that address in a browser, on any device. Studio shows a code there: paste it here, or run decks studio code <code>, within ${Math.max(1, Math.round((open.expires - Date.now()) / 60_000))} minutes.`);
				return { url: open.url, expires: open.expires };
			},
			code: async (code: string) => {
				if (!agent.person) throw new Error("Only the person can sign this harness in to Decks Studio.");
				if (!service.studioCode) throw new Error("This server signs in to no Studio.");
				const got = await service.studioCode(String(code ?? ""));
				ctx.notes.push(`Signed in to ${got.url}${got.account ? ` as ${got.account}` : ""}. The deck syncs there in the background.`);
				return { connected: true, ...got };
			},
			status: async () => {
				const open = service.studioShowing?.().open;
				const signingIn = open ? { signingIn: open.url } : {};
				const file = join(service.deckPath(), ".decks", "studio.json");
				if (process.env.DECKS_STUDIO_KEY) {
					const progress = service.studioSync?.();
					return { connected: true, url: process.env.DECKS_STUDIO_URL, ...(progress ? { sync: syncWords(progress) } : {}) };
				}
				if (!existsSync(file)) return { connected: false, ...signingIn };
				try {
					const saved = JSON.parse(readFileSync(file, "utf8")) as { url?: string; key?: string; account?: { email?: string } };
					const progress = saved.key ? service.studioSync?.() : undefined;
					return { connected: Boolean(saved.key), url: saved.url, ...(saved.account?.email ? { account: saved.account.email } : {}), ...(progress ? { sync: syncWords(progress) } : {}), ...signingIn };
				} catch {
					return { connected: false, ...signingIn };
				}
			},
			disconnect: async () => {
				if (!agent.person) throw new Error("Only the person can sign this harness out of Decks Studio.");
				// As Settings signs out: the key deleted, what Studio was given through it taken back, and Studio told.
				if (service.studioSignOut) service.studioSignOut();
				else rmSync(join(service.deckPath(), ".decks", "studio.json"), { force: true });
				return { connected: false };
			},
		},
	};
}
