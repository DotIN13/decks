import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DeckSettings } from "@decks/protocol";
import { isZone, processZone } from "./clock.ts";

/**
 * What the person has set for the whole deck, kept by the server: today, their timezone.
 *
 * Every other setting lives in a browser, and this one cannot. An agent's shell is a child of
 * this process, and it needs the zone where the server can read it. So it is a file beside the deck's other state,
 * `.decks/settings.json`, and every browser is sent it on connect.
 *
 * **The zone is adopted as the process clock.** Node re-reads `TZ` the moment it is
 * assigned, so `Date`'s local methods, `toLocaleTimeString` in a string the server writes
 * for the app, the `date` an agent runs in its shell and the "today" a runtime tells its
 * model all follow the person from one assignment. The alternative, passing a zone to every
 * place that formats a time, is a list that is never finished and fails silently where it
 * is not.
 */

/** The machine's own zone and `TZ`, read before anything here assigns one. */
const MACHINE_ZONE = processZone();
const MACHINE_TZ = process.env.TZ;

export class SettingsStore {
	private settings: DeckSettings = {};
	private file: string;

	constructor(
		deckPath: string,
		private readonly warn: (text: string) => void = () => {},
	) {
		this.file = join(deckPath, ".decks", "settings.json");
		this.settings = this.load();
		this.apply();
	}

	/** What the machine is on when the deck has chosen nothing: the fallback, and what Settings shows. */
	machineZone(): string {
		return MACHINE_ZONE;
	}

	get(): DeckSettings {
		return { ...this.settings };
	}

	/** The zone in force: the deck's, else the machine's. */
	zone(): string {
		return this.settings.timezone ?? MACHINE_ZONE;
	}

	/** Choose a zone, or `null` to go back to the machine's. Returns a sentence when it is not one. */
	setTimezone(zone: string | null): { error: string } | DeckSettings {
		if (zone !== null && !isZone(zone)) return { error: `"${zone}" is not a timezone. Use an IANA name, like "America/Los_Angeles".` };
		const next: DeckSettings = { ...this.settings };
		if (zone === null) delete next.timezone;
		else next.timezone = zone;
		this.settings = next;
		this.apply();
		this.save();
		return this.get();
	}

	/** Another deck was opened: its settings, and its clock. */
	setDeck(deckPath: string): void {
		this.file = join(deckPath, ".decks", "settings.json");
		this.settings = this.load();
		this.apply();
	}

	private apply(): void {
		if (this.settings.timezone) process.env.TZ = this.settings.timezone;
		else if (MACHINE_TZ === undefined) delete process.env.TZ;
		else process.env.TZ = MACHINE_TZ;
	}

	private load(): DeckSettings {
		try {
			if (!existsSync(this.file)) return {};
			const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>;
			// A zone this runtime does not know is dropped rather than applied: a bad `TZ`
			// silently means UTC, which is the fault this file exists to remove.
			return {
				...(isZone(parsed?.timezone) ? { timezone: parsed.timezone } : {}),
			};
		} catch (error) {
			this.warn(`The deck's settings could not be read, so the defaults are in use: ${(error as Error).message}`);
			return {};
		}
	}

	private save(): void {
		try {
			mkdirSync(dirname(this.file), { recursive: true });
			writeFileSync(this.file, `${JSON.stringify(this.settings, null, "\t")}\n`, "utf8");
		} catch (error) {
			this.warn(`The deck's settings could not be saved: ${(error as Error).message}`);
		}
	}
}
