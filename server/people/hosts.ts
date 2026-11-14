import type { AgentKind } from "./records.ts";

// The connected clients that can start agents, and the kinds each offers.
// An offer lives as long as its connection.

export class Hosts {
	private offers = new Map<string, AgentKind[]>();

	offer(client: string, kinds: readonly AgentKind[]): AgentKind[] {
		const clean = [...new Set(kinds)];
		if (clean.length) this.offers.set(client, clean);
		else this.offers.delete(client);
		return clean;
	}

	drop(client: string): void {
		this.offers.delete(client);
	}

	has(client: string | undefined): boolean {
		return !!client && this.offers.has(client);
	}

	/** The first host offering the kind; any host's first kind when none is asked for. */
	pick(kind?: AgentKind): { client: string; kind: AgentKind } | undefined {
		for (const [client, kinds] of this.offers) {
			if (!kind) return { client, kind: kinds[0]! };
			if (kinds.includes(kind)) return { client, kind };
		}
		return undefined;
	}

	kindsOf(client: string): AgentKind[] {
		return this.offers.get(client) ?? [];
	}
}
