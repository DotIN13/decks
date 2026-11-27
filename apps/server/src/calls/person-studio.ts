import type { ServerMessage } from "@decks/protocol";
import type { TokenStore } from "../auth/tokens.ts";
import type { Deck } from "../deck/loader.ts";
import { studioLink, unpairStudio } from "../studio/index.ts";
import { studioAddress, type StudioLogin } from "../studio/login.ts";
import type { PersonVerbs } from "./person-call.ts";

/**
 * The person's verbs about Studio: sign this harness in to it, sync with it now, or unpair from it.
 */

/** What the Studio verbs need of the harness: the deck it links, the sign-in, the paired tokens, and the pairing every page shows. */
export interface StudioTableHost {
	readonly deck: Deck;
	readonly studioLogin: StudioLogin;
	readonly tokens: TokenStore;
	/** Sync with Studio now, while the sync runs. */
	readonly studioSyncNow: (() => void) | undefined;
	/** Say a message to every page. */
	send(message: ServerMessage): void;
	/** Who is paired and how a front end pairs, as every Settings page shows it. */
	pairingMessage(): ServerMessage;
}

export function studioTable(host: StudioTableHost): PersonVerbs {
	return {
		"harness.unpair": async () => {
			unpairStudioHere(host);
		},
		/*
		 * Sign this harness in to Studio (`studio/login.ts`): the answer is an address on Studio to open,
		 * which shows a code. From a tab on this machine (`back`, its loopback origin) Studio's page can
		 * send the tab back with it; from anywhere else the person pastes it (`harness.studioCode`).
		 */
		"harness.studioSignIn": async ([given]) => {
			const asked = (given ?? {}) as { studio?: unknown; back?: unknown };
			const studio = studioAddress(typeof asked.studio === "string" ? asked.studio : undefined);
			if (studioLink(host.deck.path)?.env) throw new Error("This harness's Studio key is set by DECKS_STUDIO_KEY: remove it there to sign in another way.");
			const open = host.studioLogin.start(studio, typeof asked.back === "string" ? asked.back : undefined);
			return { url: open.url, expires: open.expires };
		},
		"harness.studioCode": async ([code]) => {
			await host.studioLogin.finish(String(code ?? ""));
		},
		"harness.studioCancel": async () => {
			host.studioLogin.cancel();
		},
		"harness.studioSync": async () => {
			host.studioSyncNow?.();
		},
	};
}

/** Unpair this harness from Studio: the sign-in stops, the link and its token go, and every page hears it. */
export function unpairStudioHere(host: Pick<StudioTableHost, "deck" | "studioLogin" | "tokens" | "send" | "pairingMessage">): void {
	host.studioLogin.stop();
	unpairStudio(host.deck.path, host.tokens);
	host.send(host.pairingMessage());
}
