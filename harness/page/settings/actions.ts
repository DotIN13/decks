import { call, warnIfFailed } from "../state/line.ts";
import { setState } from "../state/deck.ts";
import { setSettings } from "../state/ui.ts";

// What Settings does: open with the accounts read fresh, add and forget an
// account, choose the one an agent spends, and the shared tab's pairing.

export function openSettings(): void {
	setSettings(true);
	void call("account.list", { limits: true });
}

export const addAccount = () => void call("account.create", {}).then(warnIfFailed);
export const forgetAccount = (id: string) => void call("account.delete", { account: id }).then(warnIfFailed);
export const useAccount = (id: string, agent: string) => void call("account.use", { account: id, agent }).then(warnIfFailed);
export const readAccounts = () => void call("account.list", { limits: true });

/** A fresh pairing code for the Decks extension, kept to show. */
export async function repairTab(): Promise<void> {
	const answer = await call<{ code?: string }>("tab.pair", { fresh: true });
	if (answer.ok) setState("web", (web) => (web ? { ...web, code: answer.value?.code } : web));
}

export const stopTab = () => void call("tab.stop", {});
