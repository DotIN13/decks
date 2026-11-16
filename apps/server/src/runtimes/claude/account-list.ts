import type { ServerMessage } from "@decks/protocol";
import { mapSeries } from "../../lib/series.ts";
import { DEFAULT_ACCOUNT, type ClaudeAccounts } from "./accounts.ts";
import { claudeIdentity, fiveHourOf, probeUsage } from "./backend.ts";

/**
 * The Claude subscriptions as the page is told of them: who each one is signed in as, how much of
 * its five-hour window is used, and which agent spends which.
 *
 * `accounts.ts` owns the accounts themselves and the per-agent links. This is what reads them for a
 * person to look at, and it is careful about how: every reading is a `claude` subprocess that can
 * refresh a stale token, on the very files the running sessions are reading, so identities are
 * remembered for a minute, limits are read one account at a time and one round at a time, and a
 * switch refreshes the token once itself before the sessions want it.
 */

/** How long an account's identity is worth reusing before asking the CLI again. */
const IDENTITY_TTL_MS = 60_000;
/** How often every account's 5-hour figure is read in the background. */
const FIVE_HOUR_EVERY_MS = 30 * 60_000;
/** Opening the picker twice in a row reads once: an answer this fresh is the answer. */
const FIVE_HOUR_FRESH_MS = 15_000;

/** What the account list needs of the harness. */
export interface AccountListHost {
	accounts: ClaudeAccounts;
	/** Which subscription each agent spends, by agent id. */
	spending(): Record<string, string>;
	/** Tell every page. */
	send(message: ServerMessage): void;
}

export class AccountList {
	constructor(private readonly of: AccountListHost) {}

	/**
	 * The account list, with every identity read fresh from the CLI.
	 *
	 * Read rather than remembered, because the CLI's own login can change without Decks
	 * hearing about it — somebody running `claude auth login` in a terminal, or a token that
	 * expired. A list that reported a stale email would be worse than one that took a moment.
	 *
	 * Broadcast when nobody asked in particular (a switch, a new login), because two tabs on
	 * one deck share these accounts.
	 */
	async publish(reply?: (message: ServerMessage) => void, options?: { reread?: boolean }): Promise<void> {
		const stored = this.of.accounts.list();
		// What a conversation with no account of its own spends — see `ClaudeAccounts.defaultId`.
		const active = this.of.accounts.defaultId();
		/*
		 * One `claude auth status` at a time, and not at all when a recent answer will do.
		 *
		 * This used to be `Promise.all` over the accounts — one subprocess per row, all at
		 * once, each able to refresh a stale token. Which made this function a small
		 * stampede on the very files the sessions are reading: the CLI serialises a refresh
		 * with a lock and tells the losers to come back in a minute, so a publish could
		 * cost somebody their turn. It fires on six paths, including one that is a person
		 * pressing a button, so it has to be cheap rather than parallel.
		 */
		const accounts = await mapSeries(stored, async (account) => {
			const isDefault = account.id === DEFAULT_ACCOUNT;
			const identity = await this.identityOf(account.id, isDefault, options?.reread === true);
			/*
			 * Signed out only when the CLI says so, or there is no token on the disk at all.
			 *
			 * A check that failed is not that. `auth status` times out or errors while another
			 * process holds the login's refresh lock, which is most likely just after a limit,
			 * when every agent on the account is retrying. That greyed the row out in the model
			 * picker at the moment a person wanted to leave the spent account for it.
			 */
			const signedIn = Boolean(identity.email || identity.plan) || (!identity.signedOut && this.of.accounts.usable(account.id));
			return {
					id: account.id,
					...(isDefault ? { isDefault: true as const } : {}),
					signedIn,
					// What the CLI says now, falling back to what was recorded when it was added —
					// so a row still has a name if `auth status` is slow or the token has lapsed.
					...(identity.email ?? account.email ? { email: identity.email ?? account.email } : {}),
					...(identity.orgName ?? account.orgName ? { orgName: identity.orgName ?? account.orgName } : {}),
					...(identity.plan ?? account.plan ? { plan: identity.plan ?? account.plan } : {}),
					...(this.of.accounts.fiveHour(account.id) ? { fiveHour: this.of.accounts.fiveHour(account.id)! } : {}),
			};
		});
		// Recorded so a row keeps its name when the CLI is next slow to answer.
		const mine = accounts.find((account) => account.isDefault);
		if (mine?.signedIn) {
			this.of.accounts.describeDefault({
				...(mine.email ? { email: mine.email } : {}),
				...(mine.orgName ? { orgName: mine.orgName } : {}),
				...(mine.plan ? { plan: mine.plan } : {}),
			});
		}
		/*
		 * Who is on what, because `active` no longer answers it.
		 *
		 * With a subscription per agent, one "in force" row is at best the default a new
		 * agent gets. The panel is where somebody goes to ask which subscription is being
		 * spent, and the answer is now a mapping — leaving it out is how the account row came
		 * to disagree with the billing in the first place.
		 */
		const spending = this.of.spending();
		const frame: ServerMessage = { type: "account.list", accounts, active, ...(Object.keys(spending).length > 0 ? { spending } : {}) };
		if (reply) reply(frame);
		else this.of.send(frame);
	}

	/**
	 * An account's identity, from the CLI, with a short memory.
	 *
	 * `claude auth status` is a subprocess that will refresh a stale token, so it is not a
	 * free read — it touches the same credentials file every session is reading. Asking once
	 * a minute per account is enough for a panel: an email does not change on its own, and
	 * the one thing that *can* change without Decks hearing (somebody running
	 * `claude auth login` in a terminal) is exactly what `reread` is for.
	 */
	private readonly identities = new Map<string, { at: number; identity: { email?: string; orgName?: string; plan?: string; signedOut?: true } }>();

	private async identityOf(id: string, isDefault: boolean, reread: boolean): Promise<{ email?: string; orgName?: string; plan?: string; signedOut?: true }> {
		const cached = this.identities.get(id);
		if (!reread && cached && Date.now() - cached.at < IDENTITY_TTL_MS) return cached.identity;
		const identity = await claudeIdentity(isDefault ? undefined : this.of.accounts.configDir(id));
		/*
		 * An empty answer is not cached. It means the CLI was slow, or busy behind somebody
		 * else's refresh — and remembering "this account has no name" for a minute is how a
		 * transient failure becomes a panel that says the account is signed out.
		 */
		if (identity.email || identity.plan) this.identities.set(id, { at: Date.now(), identity });
		return identity;
	}

	/**
	 * Refresh an account's token **once**, before the sessions want it.
	 *
	 * An account nothing has used for eight hours has an expired access token, so the first
	 * request after switching to it must refresh — and every session switches at the same
	 * instant, because they all read the same link. Six sessions then race for one lock,
	 * five lose, and each loss is somebody's turn replaced by "another Claude Code process
	 * is refreshing it".
	 *
	 * So the switch does the refresh itself, in one process, and waits for it. `auth status`
	 * is the cheapest thing that will do it: it reads the token, refreshes it if it is due,
	 * and writes it back where the account keeps it. By the time a session looks, the token
	 * on disk is fresh and there is nothing to contend for.
	 *
	 * `reread: true` on the publish that follows, because this is the one moment the cached
	 * identity is certainly stale — the file has just been rewritten.
	 */
	async warm(id: string): Promise<void> {
		try {
			await this.identityOf(id, id === DEFAULT_ACCOUNT, true);
		} catch {
			/*
			 * A failed warm-up is not a failed switch. The account is already in force; what
			 * is lost is the head start, and the sessions fall back to what they did
			 * before — one of them refreshes and the rest retry (`claude/transient.ts`).
			 */
		}
	}

	/**
	 * Each account's 5-hour window, read for the rows in the model picker and settings.
	 *
	 * Read at two moments and no others: every half hour in the background (`startLimits`), and
	 * when somebody opens the model picker or settings, which is when the figure is looked at.
	 * One account at a time, through a process that sends no message (`probeUsage`, about 2.4 s),
	 * and one round at a time: an open while a round is running waits for that round.
	 */
	private limitsRound: Promise<void> | undefined;
	private limitsTimer: NodeJS.Timeout | undefined;
	private readonly limitsTried = new Map<string, number>();

	refreshLimits(): Promise<void> {
		if (this.limitsRound) return this.limitsRound;
		const now = Date.now();
		const due = this.of.accounts
			.list()
			.map((account) => account.id)
			.filter((id) => this.of.accounts.usable(id) && now - (this.limitsTried.get(id) ?? 0) > FIVE_HOUR_FRESH_MS);
		if (due.length === 0) return Promise.resolve();
		const round = (async () => {
			let changed = false;
			await mapSeries(due, async (id) => {
				this.limitsTried.set(id, Date.now());
				const reading = fiveHourOf(await probeUsage(this.of.accounts.environmentOf(id)));
				if (reading && this.of.accounts.noteFiveHour(id, reading)) changed = true;
			});
			if (changed) await this.publish();
		})().finally(() => {
			this.limitsRound = undefined;
		});
		this.limitsRound = round;
		return round;
	}

	/** The half-hourly read, started with the deck; `unref` so it never holds the process open. */
	startLimits(): void {
		clearInterval(this.limitsTimer);
		this.limitsTimer = setInterval(() => void this.refreshLimits(), FIVE_HOUR_EVERY_MS);
		this.limitsTimer.unref?.();
		void this.refreshLimits();
	}

	dispose(): void {
		clearInterval(this.limitsTimer);
		this.limitsTimer = undefined;
	}
}
