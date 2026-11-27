import { STT_MODELS, type RuntimeInfo, type ServerMessage } from "@decks/protocol";
import type { Apps } from "../apps/service.ts";
import type { PairCodes } from "../auth/issue.ts";
import type { TokenStore } from "../auth/tokens.ts";
import type { WebBridge } from "../browser/bridge.ts";
import type { Deck } from "../deck/loader.ts";
import type { AccountList } from "../runtimes/claude/account-list.ts";
import type { SettingsStore } from "../settings.ts";
import { sttReady } from "../stt.ts";
import { harnessVersion } from "../version.ts";
import { notice, type PersonVerbs } from "./person-call.ts";

/**
 * The person's verbs about the harness itself: its deck, its settings, what Settings shows of it,
 * the front ends paired to it, and the shared tab's questions.
 */

/** What the harness verbs need of it: the deck, the settings and pairing codes, the paired front ends, the runtimes and accounts Settings lists, the apps and the shared browser. */
export interface HarnessTableHost {
	readonly deck: Deck;
	readonly settings: SettingsStore;
	readonly codes: PairCodes;
	readonly tokens: TokenStore;
	readonly accountList: AccountList;
	readonly apps: Apps;
	readonly web: WebBridge;
	runtimes(): RuntimeInfo[];
	/** Open another deck in place of this one. */
	openDeck(path: string): void;
	/** Say a message to every page. */
	send(message: ServerMessage): void;
	/** Who is paired and how a front end pairs, as every Settings page shows it. */
	pairingMessage(): ServerMessage;
}

export function harnessTable(host: HarnessTableHost): PersonVerbs {
	return {
		"deck.open": async ([path]) => {
			host.openDeck(String(path));
		},
		"deck.get": async () => ({ deck: host.deck.state(), warnings: host.deck.warnings }),
		"harness.configure": async ([settings]) => {
			const asked = (settings ?? {}) as { timezone?: string | null; sttModel?: string | null; requireCode?: boolean };
			// Each choice the store takes is told to every page; one it refuses is said back.
			const set = (outcome: { error: string } | object): { error: string } | undefined => {
				if ("error" in outcome) return outcome as { error: string };
				host.send(host.settings.message());
				return undefined;
			};
			const problems = [asked.timezone !== undefined ? set(host.settings.setTimezone(asked.timezone)) : undefined, asked.sttModel !== undefined ? set(host.settings.setSttModel(asked.sttModel)) : undefined].filter((one): one is { error: string } => !!one);
			if (typeof asked.requireCode === "boolean") {
				if (host.codes.forced && !asked.requireCode) problems.push({ error: "This harness was started with DECKS_REQUIRE_PAIR_CODE, so a code is always asked for." });
				else host.codes.setRequired(asked.requireCode);
			}
			if (problems.length) throw new Error(problems.map((one) => one.error).join(" "));
		},
		"harness.get": async ([], call) => {
			let accounts: { accounts?: unknown[]; active?: string } = {};
			await host.accountList.publish((frame) => frame.type === "account.list" && (accounts = frame));
			const settings = host.settings.get();
			return {
				name: host.deck.name,
				deck: host.deck.path,
				version: harnessVersion(),
				timezone: settings.timezone ?? null,
				machineZone: host.settings.machineZone(),
				sttModel: settings.sttModel ?? STT_MODELS[0]!.id,
				sttModels: STT_MODELS.map((one) => ({ id: one.id, label: one.label ?? one.id })),
				sttKey: sttReady(),
				runtimes: host.runtimes().map((one) => ({ kind: one.kind, label: one.label, available: one.available, ...(one.reason ? { reason: one.reason } : {}), models: one.models, modes: one.capabilities.modes })),
				accounts: accounts.accounts ?? [],
				paired: host.tokens.paired().map((one) => ({ ...one, ...(one.id === call.tokenId ? { you: true } : {}) })),
				requireCode: host.codes.required,
				requireCodeForced: host.codes.forced,
				extension: { status: host.web.status() },
			};
		},
		"harness.revoke": async ([id]) => {
			if (!host.tokens.paired().some((one) => one.id === String(id)) || !host.tokens.revoke(String(id))) throw new Error("No front end with that id is paired here.");
			host.send(host.pairingMessage());
		},
		"apps.seen": async ([name]) => {
			if (!host.apps.exists(String(name))) throw new Error(`There is no app called ${String(name)}.`);
			host.apps.seen(String(name));
		},
		"web.answer": async ([id, ok], call) => {
			if (!host.web.answer(String(id), ok === true)) notice(call, "info", "That question has already been answered.");
		},
	};
}
