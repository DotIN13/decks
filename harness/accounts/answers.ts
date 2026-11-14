import type { Answerer } from "@decks-next/sdk";
import type { Sessions } from "../sessions/index.ts";
import type { ClaudeAccounts } from "./accounts.ts";

// The account calls the server passes to this harness: the Claude logins it
// spends from. Signing in runs /login through a Claude agent, as today.

type Tell = (name: string, payload: unknown) => void;
const refused = (code: string, message: string, hint?: string) => Object.assign(new Error(message), { code, ...(hint ? { hint } : {}) });
const text = (value: unknown): string => (typeof value === "string" ? value : "");

export function accountRows(accounts: ClaudeAccounts) {
	const active = accounts.activeId();
	return accounts.list().map((one) => ({
		id: one.id,
		label: one.email ?? (one.id === "default" ? "This Mac's Claude login" : one.id),
		active: one.id === active,
		...(one.plan ? { spending: one.plan } : {}),
	}));
}

export function accountAnswers(accounts: ClaudeAccounts, sessions: Sessions, tell: Tell): Record<string, Answerer> {
	const changed = () => tell("account.changed", { ids: [], by: "harness", rev: Date.now() });
	const row = (id: string) => accountRows(accounts).find((one) => one.id === id);
	return {
		"account.list": () => accountRows(accounts),
		"account.create": async () => {
			const claude = sessions.all().find((one) => one.spec.kind === "claude");
			if (!claude) throw refused("unavailable", "Start a Claude agent first: signing in runs through one.", "agent.create");
			void claude.prompt("/login");
			return row(accounts.activeId());
		},
		"account.use": (args) => {
			const session = sessions.require(text(args.agent));
			if (!session.useAccount(text(args.account))) throw refused("not_found", "That account is not on the list any more.", "account.list");
			changed();
			return row(text(args.account));
		},
		"account.delete": (args) => {
			const id = text(args.account);
			if (!accounts.has(id)) throw refused("not_found", "That account is not on the list.", "account.list");
			accounts.forget(id);
			changed();
			return { deleted: id };
		},
		"account.report": async (args) => {
			const session = sessions.require(text(args.agent));
			return (await session.backend?.report?.()) ?? { account: session.account ?? null };
		},
	};
}
