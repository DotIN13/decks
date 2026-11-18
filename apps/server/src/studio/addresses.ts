import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where this harness can be reached, for Studio's pages: said to Studio by the harness itself
 * (`index.ts`, `PUT /sync/v1/addresses`), so nobody types an address into Studio.
 *
 * A harness cannot work its own address out: behind `tailscale serve` or a proxy it hears only
 * loopback. What it knows is where people reached it from: the origin of each Decks tab that loaded
 * its page (`seen`), the newest first, a handful kept in `.decks/addresses.json` so a restart does
 * not forget the tailnet name; and its own loopback address, last, which is right for a browser on
 * this machine and for no other.
 */

const KEEP = 5;

export class Addresses {
	private remembered: string[] = [];
	private readonly file: string;

	constructor(deck: string, private readonly own: string | undefined) {
		this.file = join(deck, ".decks", "addresses.json");
		try {
			const kept = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as unknown) : [];
			if (Array.isArray(kept)) this.remembered = kept.filter((one): one is string => typeof one === "string" && originOf(one) === one).slice(0, KEEP);
		} catch {
			// A file that does not read is as good as none: the next tab that loads writes it again.
		}
	}

	/** A Decks tab loaded from this origin: remembered, the newest first. Answers whether the list changed. */
	seen(address: string | undefined): boolean {
		const origin = originOf(address);
		if (!origin || isLoopback(origin) || this.remembered[0] === origin) return false;
		this.remembered = [origin, ...this.remembered.filter((one) => one !== origin)].slice(0, KEEP);
		try {
			mkdirSync(join(this.file, ".."), { recursive: true });
			writeFileSync(this.file, JSON.stringify(this.remembered));
		} catch {
			// Kept for this run.
		}
		return true;
	}

	/** Every address, the likeliest for a page somewhere else first, this machine's own last. */
	list(): string[] {
		const own = originOf(this.own);
		return [...this.remembered, ...(own ? [own] : [])];
	}
}

function originOf(address: string | undefined): string | undefined {
	try {
		const url = new URL(address ?? "");
		return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
	} catch {
		return undefined;
	}
}

function isLoopback(origin: string): boolean {
	const host = new URL(origin).hostname;
	return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}
