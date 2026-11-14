import { CALLS } from "@decks-next/protocol";
import type { Answerer } from "@decks-next/sdk";
import type { ClaudeAccounts } from "./accounts/accounts.ts";
import { accountAnswers } from "./accounts/answers.ts";
import { runtimeAnswers } from "./runtimes/answers.ts";
import { chatAnswers, type HostLink, type Sessions } from "./sessions/index.ts";
import type { Settings } from "./voice.ts";

// The harness's own calls, for the person only: chat.*, account.* and
// runtime.*. Declared in the protocol, passed here by the server, and
// answered once each, in the folder of what they are about.

export interface Parts {
	sessions: Sessions;
	accounts: ClaudeAccounts;
	settings: Settings;
	host: HostLink;
	forks: Map<string, string>;
}

/** Every call the protocol says the harness answers. */
export const HARNESS_CALLS: readonly string[] = CALLS.filter((call) => call.side === "harness").map((call) => call.name);

export function harnessAnswers(parts: Parts): Record<string, Answerer> {
	const tell = (name: string, payload: unknown) => parts.host.tell(name, payload);
	return {
		...chatAnswers({ sessions: parts.sessions, host: parts.host, forks: parts.forks }),
		...accountAnswers(parts.accounts, parts.sessions, tell),
		...runtimeAnswers(parts.sessions, parts.settings, tell),
	};
}
