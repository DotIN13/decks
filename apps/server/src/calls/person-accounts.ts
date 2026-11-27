import type { Registry } from "../agents/registry.ts";
import type { GoogleDocs } from "../google/docs.ts";
import type { AccountList } from "../runtimes/claude/account-list.ts";
import type { ClaudeAccounts } from "../runtimes/claude/accounts.ts";
import type { ClaudeLogin } from "../runtimes/claude/login.ts";
import type { PersonVerbs } from "./person-call.ts";

/**
 * The person's verbs about the accounts the harness signs in with (`account.*`): Claude's, which an
 * agent runs on, and Google's, which the documents mirror.
 */

/** What the account verbs need of the harness: the Claude accounts with their list and sign-in, Google, and the agents that use them. */
export interface AccountTableHost {
	readonly agents: Registry;
	readonly accountList: AccountList;
	readonly claudeAccounts: ClaudeAccounts;
	readonly claudeLogin: ClaudeLogin;
	readonly google: GoogleDocs;
}

export function accountTable(host: AccountTableHost): PersonVerbs {
	return {
		"account.list": async ([options], call) => {
			void host.accountList.publish(call.tell);
			if ((options as { limits?: unknown } | undefined)?.limits) void host.accountList.refreshLimits();
		},
		// Signing in to Claude, run by the harness for the page's modal (`runtimes/claude/login.ts`): the link, then the code.
		"account.add": async ([options]) => host.claudeLogin.start((options as { method?: unknown } | undefined)?.method === "api" ? "api" : "subscription"),
		"account.code": async ([code]) => host.claudeLogin.finish(String(code ?? "")),
		"account.cancel": async () => void host.claudeLogin.cancel(),
		"account.use": async ([id, agentId]) => {
			const agent = host.agents.all().find((one) => one.id === String(agentId));
			if (!agent) throw new Error("That agent is not here any more.");
			if (!agent.conversation.useAccount(String(id))) throw new Error("That account is not on the list any more.");
			void agent.conversation.start();
			void host.accountList.warm(String(id)).then(() => host.accountList.publish(undefined, { reread: true }));
		},
		"account.forget": async ([id]) => {
			host.claudeAccounts.forget(String(id));
			void host.accountList.publish();
		},
		"account.google": async () => host.google.state(),
		"account.googleCode": async ([url]) => {
			try {
				return { ok: true, email: await host.google.auth.finish({ url: String(url ?? "") }) };
			} catch (error) {
				return { ok: false, message: (error as Error).message };
			}
		},
		"account.googleSignOut": async () => {
			host.google.auth.signOut();
		},
	};
}
