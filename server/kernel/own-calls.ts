import { calls, events, PROTOCOL_VERSION, Refused, type Caller } from "../../protocol/index.ts";
import { LOCAL_PERSON, type Callers } from "./callers.ts";
import { readJson, writeJson } from "./store.ts";
import { defineFeature, handleAll, type Feature, type Store } from "./types.ts";
import { SERVER_VERSION } from "./version.ts";

// The deck's own calls, the kernel's one small feature: its settings, the
// clock where the person is, pairing other front ends and taking them back.
// Only the person on this machine may make a pairing code.


/** The deck calls this feature answers, named, so a call added to the noun later is unhandled, not a start error. */
const MINE = { get: calls.deck.get, update: calls.deck.update, now: calls.deck.now, pair: calls.deck.pair, revoke: calls.deck.revoke };

type Settings = { timezone?: string; requireCode?: boolean; rev: number };

export function ownFeature(callers: Callers, clock: () => number = Date.now): Feature {
	let store: Store | undefined;
	let settings: Settings = { rev: 0 };
	const deck = () => ({ version: SERVER_VERSION, protocol: PROTOCOL_VERSION, ...pick(settings), warnings: [] as string[] });
	return defineFeature({
		name: "deck",
		async start(kernel) {
			store = kernel.store("deck");
			settings = await readJson<Settings>(store, "settings.json", { rev: 0 });
		},
		calls: handleAll(MINE, {
			get: () => deck(),
			now: () => nowIn(zoneOf(settings), clock()),
			async update(ctx, change) {
				const next: Settings = { ...settings, rev: settings.rev + 1 };
				if (change.timezone === null) delete next.timezone;
				else if (change.timezone !== undefined) next.timezone = checkZone(change.timezone);
				if (change.requireCode !== undefined) next.requireCode = change.requireCode;
				settings = next;
				await writeJson(ctx.store, "settings.json", settings);
				ctx.events.emit(events.deckChanged, { ids: [], by: ctx.caller.id, rev: settings.rev, part: "settings" });
				return deck();
			},
			pair(ctx) {
				onlyHere(ctx.caller);
				const { code, expires } = callers.pair();
				return { code, expires, note: "Type it into the other front end within ten minutes. It works once." };
			},
			revoke(ctx, { id }) {
				if (!callers.holders().some((one) => one.id === id)) throw new Refused("not_found", `No front end or agent with id ${id} holds a token.`, "deck.get");
				callers.revoke(id);
				ctx.events.emit(events.deckChanged, { ids: [id], by: ctx.caller.id, rev: ++settings.rev, part: "pairings" });
				return { deleted: id };
			},
		}),
	});
}

function pick(settings: Settings) {
	return { ...(settings.timezone ? { timezone: settings.timezone } : {}), ...(settings.requireCode !== undefined ? { requireCode: settings.requireCode } : {}) };
}

export function zoneOf(settings: { timezone?: string }): string {
	return settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The time in a zone: an ISO string with its offset, and in words. */
export function nowIn(timezone: string, epoch: number) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" })
			.formatToParts(epoch)
			.map((p) => [p.type, p.value]),
	);
	const offset = String(parts.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
	const iso = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
	const words = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(epoch);
	return { iso, timezone, words, epoch };
}

function checkZone(zone: string): string {
	try {
		new Intl.DateTimeFormat("en", { timeZone: zone });
		return zone;
	} catch {
		throw new Refused("invalid", `${zone} is not a timezone; give one such as America/Los_Angeles.`, "deck.now");
	}
}

function onlyHere(caller: Caller): void {
	if (caller.id !== LOCAL_PERSON.id) throw new Refused("refused", "Only the person on the server's own machine may make a pairing code.", "deck.get");
}
