import type { AgentKind } from "./records.ts";

// The connected clients that can start agents, the kinds each offers, and
// the harness's calls each answers. An offer lives as long as its connection.

type Offer = { kinds: AgentKind[]; calls: string[] };

export class Hosts {
	private offers = new Map<string, Offer>();

	offer(client: string, kinds: readonly AgentKind[], calls: readonly string[] = []): AgentKind[] {
		const offer = { kinds: [...new Set(kinds)], calls: [...new Set(calls)] };
		if (offer.kinds.length || offer.calls.length) this.offers.set(client, offer);
		else this.offers.delete(client);
		return offer.kinds;
	}

	drop(client: string): void {
		this.offers.delete(client);
	}

	has(client: string | undefined): boolean {
		return !!client && this.offers.has(client);
	}

	/** The first host offering the kind; any host's first kind when none is asked for. */
	pick(kind?: AgentKind): { client: string; kind: AgentKind } | undefined {
		for (const [client, { kinds }] of this.offers) {
			if (!kinds.length) continue;
			if (!kind) return { client, kind: kinds[0]! };
			if (kinds.includes(kind)) return { client, kind };
		}
		return undefined;
	}

	/** The first connected host that answers a call. */
	answerer(call: string): string | undefined {
		for (const [client, { calls }] of this.offers) if (calls.includes(call)) return client;
		return undefined;
	}

	kindsOf(client: string): AgentKind[] {
		return this.offers.get(client)?.kinds ?? [];
	}
}
