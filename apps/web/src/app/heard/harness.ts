import { m } from "@decks/i18n";
import { setBackend, setPairing } from "../../connections/backend.ts";
import { reconcile } from "solid-js/store";
import { ensureAgent, setState, state } from "../../state/deck.ts";
import { notice } from "../../state/notices.ts";
import { claudeLogin, openClaudeLogin, setClaudeLoginHeard } from "../../state/ui.ts";
import { setTimeZone } from "@decks/ui";
import type { FrameHooks, Of } from "../socket-messages.ts";

/**
 * What the harness says of itself: which backend this is, whether this browser is paired, the runtimes
 * on the machine, its settings, its notices and errors; and two things it keeps for every agent, the
 * shared Chrome tab and the Claude accounts.
 */
export function heardHarness(message: Of<"harness"> | Of<"web"> | Of<"account">, hooks: FrameHooks): void {
	switch (message.type) {
		case "harness.hello":
			setBackend(message.backend);
			return;
		case "harness.paired": {
			const { type: _type, ...rest } = message;
			setPairing(rest);
			return;
		}
		case "harness.runtimes":
			// A property of the machine rather than of the deck, so it travels beside
			// the greeting instead of inside it.
			setState("runtimes", message.list);
			return;
		case "harness.notice":
			notice(message.level, message.text);
			// Only `error`. A warning is a thing worth reading when you get to it, and an
			// app that makes a noise for every one of those is an app people mute.
			if (message.level === "error") hooks.raise("problem", { title: m.app_something_wrong(), body: message.text, tag: "problem" });
			return;
		case "harness.error":
			notice("error", message.text);
			hooks.raise("problem", { title: m.app_something_wrong(), body: message.text, tag: "problem" });
			return;
		case "harness.settings":
			// The zone first, so everything the store change redraws is drawn in it.
			setTimeZone(message.settings.timezone);
			setState("settings", reconcile(message.settings));
			setState("machineZone", message.machineZone);
			setState("sttKey", message.sttKey === true);
			return;
		/*
		 * The shared Chrome. The code rides only on the greeting's copy, so a later
		 * status keeps the code the greeting brought rather than dropping it.
		 */
		case "web.changed":
			setState("web", { status: message.status, code: message.code ?? state.web?.code });
			return;
		case "account.list": {
			setState({ accounts: message.accounts, activeAccount: message.active });
			/*
			 * Which subscription each agent spends arrives as one map and is scattered onto
			 * the agents' own records, where the rest of what is known about them lives.
			 */
			for (const [id, account] of Object.entries(message.spending ?? {})) {
				ensureAgent(id);
				setState("agents", id, "spending", account);
			}
			return;
		}
		/*
		 * The Claude sign-in is the page's modal: a Claude agent with no account, or the person's
		 * /login, opens it (the agent named when it is one we know); a flow the browser finished, or
		 * that failed, ends its second step. An end heard with the modal closed is nobody's.
		 */
		case "account.needed": {
			const agent = message.agent ? state.identities[message.agent]?.name : undefined;
			openClaudeLogin({ why: message.why, ...(agent ? { agent } : {}) });
			return;
		}
		case "account.login":
			if (claudeLogin()) setClaudeLoginHeard({ ...message, at: Date.now() });
			return;
		default:
			return;
	}
}
