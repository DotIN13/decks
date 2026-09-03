import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The Claude subscriptions this install can use, and which one is in force.
 *
 * A subscription has a rate limit, and reaching it stops the work — so somebody with two
 * accounts wants the second one to take over rather than to be told to come back in four
 * hours. That is the whole feature: several accounts signed in at once, one active, and the
 * active one moving along when a limit is reached.
 *
 * ### An account is a config directory, and `active` is a symlink to one
 *
 * The mechanism is Claude Code's own `CLAUDE_CONFIG_DIR`. Each account gets a directory
 * under `<dataDir>/claude-accounts/<id>/`, and the CLI keeps that account's credentials
 * there the same way it keeps the default one's in `~/.claude`. Verified rather than
 * assumed: `CLAUDE_CONFIG_DIR=<empty dir> claude auth status` reports `loggedIn: false`
 * while the real `~/.claude` still reports `true`, and signing in against one leaves the
 * other untouched.
 *
 * Every session is pointed at **`claude-accounts/active`, a symlink**, so switching account
 * is one atomic `rename` of that link. Which matters more than it sounds, because of what
 * the CLI does with the file behind it:
 *
 * **Credentials are re-read per request, not cached at startup.** Measured, because the
 * whole design turns on it: with a live session mid-conversation, re-pointing the symlink at
 * a different account made the *very next turn* use it — a broken one failed to
 * authenticate, and pointing back made the turn after that succeed again. No restart, no
 * `reinitialize()`, same session and same history throughout. So an account switch is
 * seamless in the way `/login` is seamless in the CLI itself, rather than something that
 * interrupts the conversation to take effect.
 *
 * A symlink rather than copying the credentials into a fixed `active/` directory, which was
 * the other way to do this. Two reasons, and the second is the one that decides it: a
 * `rename` over a symlink is atomic, so no reader ever sees a torn file; and **the CLI
 * writes refreshed tokens back into its config dir**, which through a symlink means back
 * into the account they belong to. Copying would have put a refreshed token in the shared
 * copy and left the account's own credentials to go stale.
 *
 * That is also why **Decks stores no tokens.** What it stores is a list of directory names
 * and an identity per directory that it read back out of the CLI. The tokens inside are
 * Claude's, in Claude's format, written and refreshed by Claude's own code.
 *
 * ### The account that was already there
 *
 * An install almost always has one Claude login before it ever opens this panel — the
 * CLI's own, in `~/.claude`. It is on the list as **`default`**, a row with no directory of
 * its own: making it active means leaving `CLAUDE_CONFIG_DIR` *unset*, which is what every
 * session did before any of this existed.
 *
 * Without it the feature would not work for the commonest case. Somebody signed in to one
 * account who adds a second would have one account Decks could rotate to and one it could
 * not, so the first limit would strand them on the new account with the old one visible and
 * unreachable. It cannot be removed from here either — those credentials belong to the CLI,
 * and `claude auth logout` is where they are given up.
 *
 * ### Where the list lives
 *
 * `<dataDir>`, not the deck. A deck is a working directory full of boards; an account is a
 * property of the *machine*, like the credentials it stands for. Two decks on one install
 * share the accounts, which is what somebody with two decks would expect, and a deck copied
 * to another machine carries no tokens with it.
 */

/** What is known about one signed-in account. */
export interface ClaudeAccount {
	/** The directory name under `claude-accounts/`, and the handle everything else uses. */
	id: string;
	/** From the CLI's own `auth status`, so the list names accounts the way the person does. */
	email?: string;
	orgName?: string;
	/** `pro`, `max`, `enterprise` — what the plan is, as the CLI reports it. */
	plan?: string;
	addedAt: number;
	/**
	 * When this account's limit is expected to lift, if it is limited now.
	 *
	 * Epoch milliseconds, from the rate-limit event's own `resetsAt`. Absent means "not
	 * known to be limited" rather than "known to be fine": an account is only ever *found*
	 * to be limited by being used, so this is a memory of what happened rather than a
	 * reading of what is true.
	 */
	limitedUntil?: number;
	/** Which window ran out — `five_hour`, `seven_day`, … — for the sentence the deck says. */
	limitType?: string;
}

interface Index {
	/** The account every agent uses, until it runs out. */
	active?: string;
	accounts: ClaudeAccount[];
}

const EMPTY: Index = { accounts: [] };

/** The row for the CLI's own `~/.claude`, which has no directory of its own. */
export const DEFAULT_ACCOUNT = "default";

export class ClaudeAccounts {
	/**
	 * `homeCredentials` is where the CLI's own login keeps its token.
	 *
	 * A constructor argument rather than a call to `homedir()` inside the class, because
	 * whether that file exists decides whether `default` is a row worth rotating *to* — and a
	 * test that depended on the real `~/.claude` of whoever ran it would pass or fail by
	 * accident.
	 */
	constructor(
		private dataDir: string,
		private readonly homeCredentials: string = join(homedir(), ".claude", ".credentials.json"),
	) {}

	setDataDir(dataDir: string): void {
		this.dataDir = dataDir;
	}

	private get dir(): string {
		return join(this.dataDir, "claude-accounts");
	}

	private get file(): string {
		return join(this.dir, "index.json");
	}

	/** Where one account's own credentials live. */
	configDir(id: string): string {
		return join(this.dir, id);
	}

	/**
	 * What every session sets `CLAUDE_CONFIG_DIR` to: the symlink, not an account.
	 *
	 * `undefined` when no account has been added, which leaves the variable unset and the
	 * CLI on its own `~/.claude` — exactly the behaviour of every install that never opens
	 * this settings panel. Adding accounts is opt-in, and nothing changes for anyone who
	 * does not.
	 */
	activeConfigDir(): string | undefined {
		const index = this.read();
		// Unset for the CLI's own login, and for an install that has added nothing: both mean
		// "whatever `claude` would use on its own".
		if (!index.active || index.active === DEFAULT_ACCOUNT) return undefined;
		return this.link;
	}

	private get link(): string {
		return join(this.dir, "active");
	}

	/**
	 * Point the symlink at an account, atomically.
	 *
	 * Built beside the real link and renamed over it, because `symlink` onto an existing
	 * path fails and removing it first would leave a window with no link at all — which a
	 * live session would read as "no credentials" rather than as "one moment please".
	 */
	private point(id: string): void {
		try {
			mkdirSync(this.dir, { recursive: true });
			const staging = `${this.link}.next`;
			rmSync(staging, { force: true });
			symlinkSync(this.configDir(id), staging);
			renameSync(staging, this.link);
		} catch {
			/*
			 * A filesystem with no symlinks, or one that refuses. The account is still
			 * recorded as active and every *new* session picks it up through `activeConfigDir`
			 * — what is lost is the switch reaching sessions already running.
			 */
		}
	}

	/**
	 * Take the symlink away, for when the account in force is the CLI's own.
	 *
	 * `activeConfigDir()` returns nothing for `default`, so a link left over from the last
	 * account is never *read* — but it is still a link on disk pointing at a directory that
	 * has usually just been deleted, and the next person to look at
	 * `claude-accounts/` finds a dangling one and has to work out whether it matters.
	 *
	 * `rmSync` on a symlink removes the link and not its target, which is what makes this
	 * safe to call while another account still owns the directory it points at.
	 */
	private unlink(): void {
		try {
			rmSync(this.link, { force: true });
		} catch {
			/* nothing there, which is the outcome wanted */
		}
	}

	private read(): Index {
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(this.file, "utf8"));
		} catch {
			// No file yet is the ordinary state of a fresh install, not an error.
			return { ...EMPTY, accounts: [] };
		}
		return validate(raw);
	}

	private write(index: Index): void {
		try {
			mkdirSync(this.dir, { recursive: true });
			const temporary = `${this.file}.tmp`;
			writeFileSync(temporary, JSON.stringify(index, null, 2));
			// Renamed over, so a reader sees the whole list or the previous one. The same
			// bargain `agents/store.ts` makes, and for the same reason.
			renameSync(temporary, this.file);
		} catch {
			/*
			 * A read-only volume or a full disk. Losing the account list costs the switching,
			 * not the deck: the CLI's own default credentials are untouched and an agent still
			 * runs on them.
			 */
		}
	}

	/**
	 * Every account, the CLI's own first.
	 *
	 * `default` is synthesised rather than stored, so it cannot drift from what the CLI
	 * actually has: its identity is filled in by whoever asks (`describe` in
	 * `claude/backend.ts` reads it from `auth status`), and if the CLI is signed out it is a
	 * row that says so rather than a row that lies.
	 */
	list(): ClaudeAccount[] {
		const index = this.read();
		const stored = index.accounts.filter((account) => account.id !== DEFAULT_ACCOUNT);
		const mine = index.accounts.find((account) => account.id === DEFAULT_ACCOUNT);
		return [{ id: DEFAULT_ACCOUNT, addedAt: 0, ...mine }, ...stored];
	}

	/** Which one is in force. `default` when nothing has been chosen, because that is the truth. */
	activeId(): string {
		return this.read().active ?? DEFAULT_ACCOUNT;
	}

	/** The account in force, or nothing — which means the CLI's own default `~/.claude`. */
	active(): ClaudeAccount | undefined {
		const id = this.activeId();
		return this.list().find((account) => account.id === id);
	}

	/**
	 * Remember what the CLI's own login is called, so the row can say.
	 *
	 * Stored under `default` like any other row but never given a directory — the identity
	 * is a label, and the credentials it labels stay where the CLI put them.
	 */
	describeDefault(identity: { email?: string; orgName?: string; plan?: string }): void {
		const index = this.read();
		const rest = index.accounts.filter((account) => account.id !== DEFAULT_ACCOUNT);
		/*
		 * The label is *merged in*, not written over the row.
		 *
		 * Replacing it dropped `limitedUntil` — so merely reading the account list made the
		 * CLI's own login forget it had run out, and the next rotation would have gone
		 * straight back to the account that had just refused. Publishing the list has to be a
		 * read, and this is the one part of it that writes.
		 */
		const existing = index.accounts.find((account) => account.id === DEFAULT_ACCOUNT);
		index.accounts = [...rest, { ...existing, id: DEFAULT_ACCOUNT, addedAt: 0, ...identity }];
		this.write(index);
	}

	/**
	 * A directory for an account that is about to be signed in.
	 *
	 * Made before the login rather than after it, because the login *is* what writes the
	 * credentials into it — so the directory has to exist first and be handed to the CLI as
	 * `CLAUDE_CONFIG_DIR`. It is recorded with no identity: `describe` fills that in once
	 * there is a signed-in account to ask about.
	 */
	begin(): { id: string; configDir: string } {
		const id = randomUUID();
		const configDir = this.configDir(id);
		mkdirSync(configDir, { recursive: true });
		return { id, configDir };
	}

	/**
	 * Record an account that has just signed in, and make it the active one.
	 *
	 * Active on adding, because somebody who has just signed in to an account meant to use
	 * it — and because the first account added would otherwise sit there doing nothing while
	 * the deck went on using the CLI's default.
	 *
	 * A second sign-in to an account already on the list *replaces* it rather than joining
	 * it. Two rows for one email is a list that cannot be reasoned about, and the second
	 * sign-in is the fresher set of credentials.
	 *
	 * **Except the CLI's own row, which is never the duplicate that gets removed.** It is
	 * synthesised by `list()` and re-labelled by `describeDefault()` on every publish, so
	 * dropping it here removed it for exactly as long as it took the panel to read the list
	 * again — and what came back was a second row with the same email, one with a × and one
	 * without, for a single subscription. Signing in as the account the CLI is already on is
	 * `abandon()`'s case, not this one; the caller decides which, because only it can ask the
	 * CLI whether that login is currently signed in at all.
	 */
	remember(account: Omit<ClaudeAccount, "addedAt"> & { addedAt?: number }): ClaudeAccount {
		const index = this.read();
		const entry: ClaudeAccount = { ...account, addedAt: account.addedAt ?? Date.now() };
		const duplicate = entry.email
			? index.accounts.find((other) => other.email === entry.email && other.id !== entry.id && other.id !== DEFAULT_ACCOUNT)
			: undefined;
		if (duplicate) {
			// The directory of the row being replaced is dropped with it, or it would sit
			// there holding credentials nothing can reach.
			this.discard(duplicate.id);
			index.accounts = index.accounts.filter((other) => other.id !== duplicate.id);
		}
		index.accounts = [...index.accounts.filter((other) => other.id !== entry.id), entry];
		index.active = entry.id;
		this.write(index);
		this.point(entry.id);
		return entry;
	}

	/**
	 * Give up on an account that was begun but must not join the list.
	 *
	 * The case is signing in as the subscription the CLI is *already* signed in as: the login
	 * worked and wrote real credentials, but they are a second copy of the first row's, and
	 * one subscription drawn as two accounts is a list that cannot be reasoned about — two
	 * identical rows, one removable and one not, and a rotation that "switches" to the same
	 * rate limit it just left.
	 *
	 * So the directory goes and the row is never written; what is left in force is the CLI's
	 * own login, which is that same subscription by a shorter route. Returns the row the
	 * caller ends up on, so it has something to say.
	 */
	abandon(id: string): ClaudeAccount {
		this.discard(id);
		const index = this.read();
		index.accounts = index.accounts.filter((account) => account.id !== id);
		index.active = DEFAULT_ACCOUNT;
		this.write(index);
		this.unlink();
		return this.list().find((account) => account.id === DEFAULT_ACCOUNT) ?? { id: DEFAULT_ACCOUNT, addedAt: 0 };
	}

	/**
	 * Take an account off the list, and its credentials off the disk.
	 *
	 * Refused for the CLI's own login: those credentials are not Decks' to delete, and
	 * `claude auth logout` is where they are given up.
	 */
	forget(id: string): void {
		if (id === DEFAULT_ACCOUNT) return;
		const index = this.read();
		index.accounts = index.accounts.filter((account) => account.id !== id);
		if (index.active === id) {
			// Back to the CLI's own login when nothing else is available, rather than to
			// nothing — `default` is always a usable row.
			/*
			 * Removing the active account moves to another rather than leaving none.
			 *
			 * `undefined` would mean "use the CLI's default", which is a different account
			 * from any of these and almost certainly not what removing one asked for. An
			 * unlimited one first; failing that, whichever is left.
			 */
			index.active = this.pick(this.list(), undefined)?.id ?? DEFAULT_ACCOUNT;
			// Repointed at the next account, or taken away — falling back to `default` used to
			// leave the link pointing at the directory this call is about to delete.
			if (index.active !== DEFAULT_ACCOUNT) this.point(index.active);
			else this.unlink();
		}
		this.write(index);
		this.discard(id);
	}

	/** Choose an account by hand, which is what clicking one in the list does. */
	use(id: string): ClaudeAccount | undefined {
		const index = this.read();
		if (id === DEFAULT_ACCOUNT) {
			index.active = DEFAULT_ACCOUNT;
			// Its remembered limit is cleared for the same reason as any other row's.
			const mine = index.accounts.find((account) => account.id === DEFAULT_ACCOUNT);
			if (mine) {
				delete mine.limitedUntil;
				delete mine.limitType;
			}
			this.write(index);
			return this.active();
		}
		const found = index.accounts.find((account) => account.id === id);
		if (!found) return undefined;
		/*
		 * Chosen deliberately, so its remembered limit is cleared.
		 *
		 * A limit is a memory of the last refusal, and the person picking this row can see the
		 * reset time next to it — if they pick it anyway they either know better than the
		 * memory or want to find out. Refusing to switch to it would be the deck arguing with
		 * a direct instruction, and the worst case is one rejected turn that marks it again.
		 */
		delete found.limitedUntil;
		delete found.limitType;
		index.active = id;
		this.write(index);
		this.point(id);
		return found;
	}

	/** Note that an account has run out, so the next choice can pass over it. */
	markLimited(id: string, resetsAt: number | undefined, limitType: string | undefined): void {
		const index = this.read();
		let found = index.accounts.find((account) => account.id === id);
		if (!found && id === DEFAULT_ACCOUNT) {
			// The CLI's own row is synthesised, so the first thing ever recorded about it may
			// be that it ran out.
			found = { id: DEFAULT_ACCOUNT, addedAt: 0 };
			index.accounts = [...index.accounts, found];
		}
		if (!found) return;
		/*
		 * A limit with no reset time still counts, and is held for an hour.
		 *
		 * `resetsAt` is optional on the event, and an account whose limit is remembered
		 * *forever* because the number was missing is an account nothing will use again. An
		 * hour is short enough to be self-correcting and long enough to stop a switch loop.
		 */
		const until = resetsAt && Number.isFinite(resetsAt) ? resetsAt : Date.now() + 60 * 60 * 1000;
		/*
		 * Every row with that email, not only the one that refused.
		 *
		 * A rate limit belongs to the *subscription*, and one subscription can still be two
		 * rows on an install that made the pair before `abandon()` existed — the CLI's own
		 * login and a copy of it added by hand. Marking only the row that refused left the
		 * twin looking available, so the next choice switched to the same account that had
		 * just run out, was refused again, and only then moved on.
		 */
		const sharing = found.email ? index.accounts.filter((account) => account.email === found.email) : [found];
		for (const account of sharing) {
			account.limitedUntil = until;
			if (limitType) account.limitType = limitType;
		}
		this.write(index);
	}

	/**
	 * The next account worth trying, or nothing if they are all spent.
	 *
	 * `except` is the one that just refused — passed explicitly rather than read from
	 * `active`, because the caller knows which account the refusal came from and the active
	 * one may already have moved.
	 */
	nextAvailable(except?: string): ClaudeAccount | undefined {
		return this.pick(this.list(), except);
	}

	/**
	 * Switch to the next available account, if there is one.
	 *
	 * Returns what happened, because every caller has something to say about it: the account
	 * moved to, or the earliest moment any of them will be usable again.
	 */
	rotate(except: string | undefined, resetsAt: number | undefined, limitType: string | undefined): { moved?: ClaudeAccount; nextReset?: number } {
		if (except) this.markLimited(except, resetsAt, limitType);
		const next = this.nextAvailable(except);
		if (next) {
			const index = this.read();
			index.active = next.id;
			this.write(index);
			// The switch itself. Every running session's next request reads through this.
			if (next.id !== DEFAULT_ACCOUNT) this.point(next.id);
			return { moved: next };
		}
		// Nothing left: the soonest an account comes back is what the deck can usefully say.
		const waits = this.list()
			.map((account) => account.limitedUntil)
			.filter((until): until is number => typeof until === "number");
		return waits.length > 0 ? { nextReset: Math.min(...waits) } : {};
	}

	/**
	 * The next account worth trying: signed in, not spent, and not the one that just refused.
	 *
	 * **Signed in matters as much as not spent.** Without that check a limit could move to an
	 * account with no credentials behind it — the CLI's own row when somebody has run
	 * `claude auth logout`, or a directory whose token was revoked — and the next turn would
	 * fail on authentication instead of on a limit. Which is a worse failure than the one
	 * being worked around, because it does not read as "out of quota" to anybody.
	 *
	 * Whether an account is signed in is asked of the disk rather than remembered, since the
	 * CLI's own login can change without Decks hearing about it.
	 *
	 * Ordered by list position among the usable ones — the CLI's own login first, then in the
	 * order they were added — because a rotation should be predictable rather than clever.
	 */
	private pick(accounts: ClaudeAccount[], except: string | undefined): ClaudeAccount | undefined {
		const now = Date.now();
		return accounts
			.filter((account) => account.id !== except)
			.filter((account) => !account.limitedUntil || account.limitedUntil <= now)
			.filter((account) => this.hasCredentials(account.id))[0];
	}

	/** Whether there is a token behind an account at all. */
	private hasCredentials(id: string): boolean {
		const file = id === DEFAULT_ACCOUNT ? this.homeCredentials : join(this.configDir(id), ".credentials.json");
		try {
			return statSync(file).size > 0;
		} catch {
			return false;
		}
	}

	/** For the list the browser draws: whether this row can be switched to at all. */
	usable(id: string): boolean {
		return this.hasCredentials(id);
	}

	/**
	 * Drop an account's credentials from the disk.
	 *
	 * Under `claude-accounts/` and named by a uuid this store issued, so there is no path
	 * here that could name anything else — but the check is cheap and the alternative is a
	 * recursive delete taking an argument from a message off the wire.
	 */
	private discard(id: string): void {
		if (!/^[0-9a-f-]{36}$/i.test(id)) return;
		try {
			rmSync(this.configDir(id), { recursive: true, force: true });
		} catch {
			/* already gone, which is the outcome wanted */
		}
	}

	/**
	 * Directories with no row in the index, swept on open.
	 *
	 * A login that got as far as `begin()` and no further — the person closed the dialog, or
	 * the deck restarted mid-flow — leaves a directory behind. Empty, usually, but it may hold
	 * credentials that nothing will ever reach again, and those are worth removing rather than
	 * leaving on the disk indefinitely.
	 */
	sweep(): void {
		const known = new Set(this.list().map((account) => account.id));
		// The symlink is not an account and must survive the sweep.
		known.add("active");
		let entries: string[];
		try {
			entries = readdirSync(this.dir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
				.map((entry) => entry.name);
		} catch {
			return;
		}
		for (const entry of entries) if (!known.has(entry)) this.discard(entry);
	}
}

/** Take only what is the right shape, and drop the rest. */
function validate(raw: unknown): Index {
	if (!raw || typeof raw !== "object") return { ...EMPTY, accounts: [] };
	const source = raw as { active?: unknown; accounts?: unknown };
	const accounts = (Array.isArray(source.accounts) ? source.accounts : [])
		.map((entry): ClaudeAccount | undefined => {
			if (!entry || typeof entry !== "object") return undefined;
			const account = entry as Record<string, unknown>;
			if (typeof account.id !== "string" || !account.id) return undefined;
			const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
			const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
			return {
				id: account.id,
				...(text(account.email) ? { email: text(account.email)! } : {}),
				...(text(account.orgName) ? { orgName: text(account.orgName)! } : {}),
				...(text(account.plan) ? { plan: text(account.plan)! } : {}),
				addedAt: time(account.addedAt) ?? Date.now(),
				...(time(account.limitedUntil) ? { limitedUntil: time(account.limitedUntil)! } : {}),
				...(text(account.limitType) ? { limitType: text(account.limitType)! } : {}),
			};
		})
		.filter((account): account is ClaudeAccount => account !== undefined);
	const active = typeof source.active === "string" && accounts.some((account) => account.id === source.active) ? source.active : undefined;
	return { ...(active ? { active } : {}), accounts };
}
