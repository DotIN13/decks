import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
 * An install almost always has one Claude login before it ever opens this panel — the CLI's
 * own, in `~/.claude`. It is on the list as **`default`**, and without it the feature would
 * not work for the commonest case: somebody signed in to one account who adds a second would
 * have one account Decks could rotate to and one it could not. It cannot be removed from here
 * either — those credentials belong to the CLI, and `claude auth logout` is where they are
 * given up.
 *
 * It used to mean "leave `CLAUDE_CONFIG_DIR` unset", on the reasoning that an install which
 * never opens this panel should behave exactly as it always had. **That reasoning cost the
 * feature its point.** A subprocess's environment is fixed at `spawn`, so a session started
 * while `default` was in force had no variable at all and was pinned to `~/.claude` for its
 * whole life: adding a second account later could not reach it, and a limit could not move
 * it. On an install sitting on its default account — which is most of them — nothing could
 * ever switch.
 *
 * So `default` is a directory too, `claude-accounts/default/`, made of symlinks pointing back
 * at whatever the CLI already had. One rule instead of two, and every session switchable. It
 * is a directory of links rather than a link straight at `~/.claude` because of one file:
 * `.claude.json` — identity, project trust, MCP servers — is resolved as
 * `join(CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json")`, so setting the variable at all
 * moves it *inside* the config home and leaves the CLI's own behind.
 *
 * ### What an account is, and what merely sat next to it
 *
 * A config directory holds two kinds of thing, and only one of them is the account.
 * `.credentials.json` and `.claude.json` *are* the subscription; `projects/` (transcripts and
 * memory), `settings.json` (what the person has allowed) and their own commands, agents and
 * skills are not — and all of it used to move when an account became active. So an agent that
 * switched accounts lost its memory, its permissions and every transcript it could rewind to,
 * and the SDK's own `getSessionMessages` went looking in the wrong place. Those parts are
 * symlinked back to the CLI's config home in every account directory (`SHARED`), which leaves
 * one set of transcripts and one set of permissions no matter whose subscription is paying.
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
	/**
	 * The ids in the order the user put them in — who a limit moves to first.
	 *
	 * Kept apart from `accounts` rather than being its order, because `accounts` is rewritten
	 * by things that have nothing to do with priority: `describeDefault` moves the CLI's own
	 * row to the end every time the list is published, and `add` appends. An order stored in
	 * that array would be undone by merely reading the list.
	 *
	 * Absent, or missing an id, means "as it always was": the CLI's own login first, then in
	 * the order they were added. So an install that has never touched the arrows behaves
	 * exactly as it did.
	 */
	order?: string[];
}

const EMPTY: Index = { accounts: [] };

/**
 * Where the CLI's own login keeps its things, and which platform it keeps them for.
 *
 * Two paths rather than one because the CLI keeps them in two places. The config home is
 * `CLAUDE_CONFIG_DIR ?? ~/.claude`, but `.claude.json` is resolved as
 * `join(CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json")` — *beside* the config home rather
 * than inside it, when the variable is unset. Which is the whole reason `default` needs a
 * directory of links instead of a link straight at `~/.claude`: pointing `CLAUDE_CONFIG_DIR`
 * at `~/.claude` would move `.claude.json` to `~/.claude/.claude.json` and leave the CLI's
 * own identity, project trust and MCP config behind.
 */
export interface ClaudeHome {
	configDir: string;
	configFile: string;
	/** macOS keeps tokens in the keychain rather than in a file — see `hasCredentials`. */
	platform: NodeJS.Platform;
}

/** What the CLI's own login is on this machine, read from the environment once. */
export function claudeHome(): ClaudeHome {
	const configured = process.env.CLAUDE_CONFIG_DIR;
	return {
		configDir: configured ?? join(homedir(), ".claude"),
		configFile: join(configured ?? homedir(), ".claude.json"),
		platform: process.platform,
	};
}

/** The row for the CLI's own `~/.claude`, which has no directory of its own. */
export const DEFAULT_ACCOUNT = "default";

export class ClaudeAccounts {
	/**
	 * `home` is where the CLI's own login keeps its things — passed in rather than looked up
	 * inside the class, because the `default` account is a *view of that directory* and a
	 * test that reached into the real `~/.claude` of whoever ran it would pass or fail by
	 * accident.
	 */
	constructor(
		private dataDir: string,
		private readonly home: ClaudeHome = claudeHome(),
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
	 * What every session sets `CLAUDE_CONFIG_DIR` to: the symlink, never an account directly.
	 *
	 * **Always the link, including for the CLI's own login.** It used to be `undefined` for
	 * `default`, on the reasoning that an install which never opens the settings panel should
	 * behave exactly as it always had — and that reasoning cost the feature its point. A
	 * subprocess's environment is fixed at `spawn`, so a session started while `default` was
	 * in force had no `CLAUDE_CONFIG_DIR` at all and was pinned to `~/.claude` for its whole
	 * life. Adding a second account later could not reach it, and a limit could not move it.
	 * One rule instead of two: every session reads through the link, and every session is
	 * therefore switchable.
	 *
	 * `undefined` only when the link cannot be made at all — a filesystem with no symlinks.
	 * Then a *new* session still lands on the right account, and what is lost is the switch
	 * reaching one already running, which is the same bargain `point` has always made.
	 */
	activeConfigDir(): string | undefined {
		const id = this.activeId();
		const target = this.targetFor(id);
		if (this.ensureLink(target)) return this.link;
		return id === DEFAULT_ACCOUNT ? undefined : target;
	}

	/**
	 * The environment a `claude` process needs in order to spend the active subscription.
	 *
	 * Two variables, and the second one is entirely about macOS. There, tokens live in the
	 * keychain rather than in `.credentials.json`, and the CLI names its keychain entry
	 * `Claude Code-credentials-<sha256(configDir)[:8]>` — hashed from `CLAUDE_CONFIG_DIR`
	 * unless `CLAUDE_SECURESTORAGE_CONFIG_DIR` overrides it.
	 *
	 * Which the symlink breaks in both directions. Every account is reached through the *same*
	 * link path, so every account would hash to the same keychain entry and overwrite each
	 * other's tokens; and `auth login` runs against the account's own directory, so it would
	 * write under a hash the session then fails to look up. `CLAUDE_SECURESTORAGE_CONFIG_DIR`
	 * is set to the account's **own** directory to fix both — a stable identity per account,
	 * independent of the path used to reach it.
	 *
	 * For the CLI's own login it is the empty string, which the CLI reads as "no suffix" —
	 * the unadorned `Claude Code-credentials` entry that a bare `claude` in a terminal uses.
	 * Without it, routing `default` through the link would have looked in a keychain entry
	 * that has never existed and reported a signed-in account as signed out.
	 *
	 * Harmless on Linux, where the keychain path is not taken at all, so it is set
	 * unconditionally rather than behind a platform check: one environment to reason about,
	 * and the check that matters is the one inside the CLI.
	 */
	activeEnvironment(): NodeJS.ProcessEnv | undefined {
		const configDir = this.activeConfigDir();
		if (!configDir) return undefined;
		return accountEnvironment(configDir, this.keychainDir(this.activeId()));
	}

	/**
	 * The account's own directory, as opposed to the link that reaches it.
	 *
	 * This is what identifies an account to the macOS keychain, and what a one-off `claude
	 * auth` command is pointed at. Empty for the CLI's own login, which has no directory of
	 * its own and wants the unsuffixed keychain entry.
	 */
	keychainDir(id: string): string {
		return id === DEFAULT_ACCOUNT ? "" : this.configDir(id);
	}

	/**
	 * The directory the link should point at for a given account.
	 *
	 * `default` is a directory too now — `claude-accounts/default/`, made of symlinks into
	 * the CLI's own config home. See `mirror` for why that is a view rather than a link.
	 */
	private targetFor(id: string): string {
		return this.configDir(id);
	}

	private get link(): string {
		return join(this.dir, "active");
	}

	/**
	 * Make sure the link exists and points where it should, without rewriting it needlessly.
	 *
	 * Called on every session start, so the cheap case — a link already aimed at the right
	 * account — is one `readlink`. Returns whether the link can be relied on.
	 */
	private ensureLink(target: string): boolean {
		if (target === this.configDir(DEFAULT_ACCOUNT)) this.mirrorDefault();
		try {
			if (readlinkSync(this.link) === target) return true;
		} catch {
			/* no link yet, or not a link: fall through and make one */
		}
		return this.point(target);
	}

	/**
	 * Point the symlink at an account, atomically.
	 *
	 * Built beside the real link and renamed over it, because `symlink` onto an existing
	 * path fails and removing it first would leave a window with no link at all — which a
	 * live session would read as "no credentials" rather than as "one moment please".
	 */
	private point(target: string): boolean {
		try {
			mkdirSync(this.dir, { recursive: true });
			const staging = `${this.link}.next`;
			rmSync(staging, { force: true });
			symlinkSync(target, staging);
			renameSync(staging, this.link);
			return true;
		} catch {
			/*
			 * A filesystem with no symlinks, or one that refuses. The account is still
			 * recorded as active and every *new* session picks it up through `activeConfigDir`
			 * — what is lost is the switch reaching sessions already running.
			 */
			return false;
		}
	}

	/**
	 * Aim the link at whichever account is in force now.
	 *
	 * Through `ensureLink` rather than `point`, so that landing on the CLI's own login builds
	 * its view first. Pointing at a `default` directory that had never been made left the link
	 * aimed at nothing, which is the same dangling link this was meant to stop.
	 */
	private repoint(): void {
		this.ensureLink(this.targetFor(this.activeId()));
	}

	/**
	 * `claude-accounts/default/`: the CLI's own config home, seen through symlinks.
	 *
	 * The obvious thing would be to point `active` straight at `~/.claude`, and it is wrong
	 * for one reason: `.claude.json` — which holds `oauthAccount`, project trust and MCP
	 * config — is resolved as `join(CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json")`. Setting
	 * the variable at all moves it *inside* the config home, so the CLI's own login would
	 * come up with no identity, no trust and no MCP servers. A directory of links gets the
	 * variable set and every file resolved back to where the CLI actually keeps it.
	 *
	 * Safe because **the CLI writes through symlinks rather than replacing them** — verified
	 * by running it against a config directory of links and watching the targets grow. So a
	 * refreshed token lands in `~/.claude/.credentials.json`, which is the same property that
	 * makes the `active` link itself work.
	 *
	 * Every entry is linked rather than a chosen few, so nothing is silently left behind when
	 * the CLI grows a new file. Re-run on open and on every session start, which is what
	 * picks up entries that appeared since.
	 */
	private mirrorDefault(): void {
		const into = this.configDir(DEFAULT_ACCOUNT);
		let entries: string[];
		try {
			mkdirSync(this.home.configDir, { recursive: true });
			entries = readdirSync(this.home.configDir);
		} catch {
			return;
		}
		this.mirror(into, this.home.configDir, entries);
		// The one file that is not in the config home at all.
		this.linkOne(join(into, ".claude.json"), this.home.configFile);
	}

	/**
	 * The parts of a config directory that are *not* about which subscription is signed in.
	 *
	 * Transcripts and memory (`projects/`), what the person has allowed (`settings.json`),
	 * and what they have written for themselves (`commands/`, `agents/`, `skills/`). None of
	 * it belongs to an account, and all of it used to move when one became active — so an
	 * agent switched accounts and lost its memory, its permissions and every transcript it
	 * could rewind to.
	 *
	 * Deliberately not shared: `.credentials.json` and `.claude.json`, which *are* the
	 * account; and `policy-limits.json`, `remote-settings.json`, `statsig/`, `sessions/` and
	 * `backups/`, which are per-subscription state fetched from the server.
	 */
	private static readonly SHARED = [
		"projects",
		"todos",
		"file-history",
		"shell-snapshots",
		"plugins",
		"commands",
		"agents",
		"skills",
		"settings.json",
		"settings.local.json",
		"keybindings.json",
		"CLAUDE.md",
	];

	/** Give one account directory its share of what is not account-bound. */
	private share(configDir: string): void {
		this.mirror(configDir, this.home.configDir, ClaudeAccounts.SHARED);
	}

	/**
	 * Make named entries of `from` reachable through `into` as symlinks.
	 *
	 * Anything already written into `into` directly is *adopted* rather than destroyed: a
	 * real directory has its children moved across one by one, and only ever into a name that
	 * is free, so nothing is overwritten. What cannot be moved without a collision is left
	 * where it is and simply not linked, which is a directory somebody can still find.
	 */
	private mirror(into: string, from: string, names: string[]): void {
		try {
			mkdirSync(into, { recursive: true });
		} catch {
			return;
		}
		for (const name of names) {
			if (name === "." || name === ".." || name.includes("/")) continue;
			this.linkOne(join(into, name), join(from, name));
		}
	}

	/** One entry: adopt whatever is there, then link it at `target`. */
	private linkOne(at: string, target: string): void {
		try {
			if (readlinkSync(at) === target) return;
		} catch {
			/* not a link, or nothing there */
		}
		let local: ReturnType<typeof lstatSync> | undefined;
		try {
			local = lstatSync(at);
		} catch {
			/* nothing there, which is the ordinary case */
		}
		if (local && !local.isSymbolicLink()) {
			if (!this.adopt(at, target)) return;
		} else if (local) {
			// A link pointing somewhere else: ours to replace.
			try {
				rmSync(at, { force: true });
			} catch {
				return;
			}
		}
		let exists = true;
		try {
			statSync(target);
		} catch {
			exists = false;
		}
		if (!exists) return;
		try {
			symlinkSync(target, at);
		} catch {
			/* no symlinks here; the account simply keeps its own copy */
		}
	}

	/**
	 * Move what was written locally back to where it should have gone.
	 *
	 * Returns whether `at` is now free to be replaced by a link. Nothing is ever overwritten:
	 * an entry moves only into a name that does not exist, two directories are merged child by
	 * child instead, and anything that would still collide is left exactly where it is — which
	 * costs that one account a shared directory and loses nobody a transcript.
	 *
	 * Recursive, because the collision is usually one level down. An account signed in before
	 * any of this existed has `projects/<deck>/` and so does the config home: the directories
	 * collide, the transcripts inside them do not.
	 */
	private adopt(at: string, target: string): boolean {
		const kind = (path: string): "none" | "dir" | "other" => {
			try {
				return lstatSync(path).isDirectory() ? "dir" : "other";
			} catch {
				return "none";
			}
		};
		try {
			if (kind(target) === "none") {
				mkdirSync(dirname(target), { recursive: true });
				renameSync(at, target);
				return true;
			}
			if (kind(target) !== "dir" || kind(at) !== "dir") return false;
			let whole = true;
			for (const child of readdirSync(at)) if (!this.adopt(join(at, child), join(target, child))) whole = false;
			if (!whole) return false;
			rmSync(at, { recursive: true, force: true });
			return true;
		} catch {
			return false;
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
		return sort([{ id: DEFAULT_ACCOUNT, addedAt: 0, ...mine }, ...stored], index.order);
	}

	/**
	 * Move one account up or down the list — which is to say, change who is tried first.
	 *
	 * The list *is* the priority: `pick` walks it from the top, so the order here is the order
	 * a limit moves through. Deliberately **not** a switch: the account in force stays in
	 * force, because reordering is a statement about what happens when this one runs out, and
	 * taking a running conversation off its subscription is not what an arrow key looks like
	 * it does. `use()` is the switch, and it is one click away on the same row.
	 *
	 * Returns whether anything moved, so a press at the end of the list is a no-op the caller
	 * can decline to broadcast rather than a lie it repaints.
	 */
	move(id: string, direction: "up" | "down"): boolean {
		const order = this.list().map((account) => account.id);
		const at = order.indexOf(id);
		const to = direction === "up" ? at - 1 : at + 1;
		if (at === -1 || to < 0 || to >= order.length) return false;
		[order[at], order[to]] = [order[to]!, order[at]!];
		const index = this.read();
		index.order = order;
		this.write(index);
		return true;
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
		/*
		 * Unless it is a different subscription behind the same row, which is what somebody
		 * running `claude auth login` in a terminal does. The remembered limit belonged to the
		 * account that has just been replaced — kept, it would have the deck rotating away
		 * from a fresh subscription and showing a reset time for one nobody is signed in to.
		 */
		const kept: Partial<ClaudeAccount> = { ...existing };
		if (existing?.email && identity.email && existing.email !== identity.email) {
			delete kept.limitedUntil;
			delete kept.limitType;
		}
		index.accounts = [...rest, { ...kept, id: DEFAULT_ACCOUNT, addedAt: 0, ...identity }];
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
		// Before the login, so the CLI's first write already goes to the shared transcripts
		// and reads the shared settings rather than starting a second set of them.
		this.share(configDir);
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
		this.repoint();
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
		this.repoint();
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
		const wasActive = index.active === id;
		if (wasActive) {
			/*
			 * Removing the active account moves to another rather than leaving none.
			 *
			 * `undefined` would mean "use the CLI's default", which is a different account
			 * from any of these and almost certainly not what removing one asked for. An
			 * unlimited one first; failing that, whichever is left.
			 *
			 * `id` is passed as the one to skip because `list()` reads the file, which still
			 * has this row in it — without that, forgetting the account in force could pick it
			 * again and "move" to the directory it is about to delete.
			 */
			index.active = this.pick(this.list(), id)?.id ?? DEFAULT_ACCOUNT;
		}
		this.write(index);
		// Repointed before the directory goes, so the link is never left aimed at nothing.
		if (wasActive) this.repoint();
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
			this.repoint();
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
		this.repoint();
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
		const until = epochMs(resetsAt) ?? Date.now() + 60 * 60 * 1000;
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
			this.repoint();
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
	 * Ordered by list position among the usable ones, because a rotation should be predictable
	 * rather than clever — and that position is now the user's to set (`move`). Untouched, it
	 * is what it always was: the CLI's own login first, then the order they were added.
	 */
	private pick(accounts: ClaudeAccount[], except: string | undefined): ClaudeAccount | undefined {
		const now = Date.now();
		return accounts
			.filter((account) => account.id !== except)
			.filter((account) => !account.limitedUntil || account.limitedUntil <= now)
			.filter((account) => this.hasCredentials(account.id))[0];
	}

	/**
	 * Whether there is a token behind an account at all.
	 *
	 * Two readings, because there are two places a token can be. On Linux and Windows the CLI
	 * writes `.credentials.json`; on macOS it writes the keychain and that file may not exist
	 * at all — so every account looked signed out, `pick` passed over all of them, and a limit
	 * had nowhere to move to on the one platform where nothing else looked wrong.
	 *
	 * The macOS reading is `oauthAccount` in the config, which is the CLI's own record of who
	 * that directory is signed in as and is written alongside the keychain entry. Taken as
	 * text rather than parsed: the file is tens of kilobytes of caches, and the question is
	 * only whether one key is in it.
	 */
	private hasCredentials(id: string): boolean {
		const dir = id === DEFAULT_ACCOUNT ? this.home.configDir : this.configDir(id);
		try {
			if (statSync(join(dir, ".credentials.json")).size > 0) return true;
		} catch {
			/* no file — which on macOS is the ordinary state of a signed-in account */
		}
		if (this.home.platform !== "darwin") return false;
		const config = id === DEFAULT_ACCOUNT ? this.home.configFile : join(dir, ".claude.json");
		try {
			return readFileSync(config, "utf8").includes('"oauthAccount"');
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
		/*
		 * Then repair, so an install that added accounts before any of this existed is put
		 * right without anybody doing anything: the CLI's own login gets the directory of
		 * links that makes it switchable, every added account gets the shared `projects/` and
		 * settings, and transcripts already written into an account are adopted back out.
		 */
		this.mirrorDefault();
		for (const account of this.list()) if (account.id !== DEFAULT_ACCOUNT) this.share(this.configDir(account.id));
		this.repoint();
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
				// Migrated on the way out of the file: what is stored may be seconds (`epochMs`).
				...(epochMs(time(account.limitedUntil)) ? { limitedUntil: epochMs(time(account.limitedUntil))! } : {}),
				...(text(account.limitType) ? { limitType: text(account.limitType)! } : {}),
			};
		})
		.filter((account): account is ClaudeAccount => account !== undefined);
	const active = typeof source.active === "string" && accounts.some((account) => account.id === source.active) ? source.active : undefined;
	// Ids only, deduplicated. A stale id for an account that has since been forgotten is
	// harmless — `sort` looks the other way, from the accounts to the order — so there is
	// nothing to prune and nothing that goes wrong if the pruning were forgotten.
	const listed = Array.isArray((raw as { order?: unknown }).order) ? ((raw as { order: unknown[] }).order.filter((id) => typeof id === "string") as string[]) : [];
	const order = [...new Set(listed)];
	return { ...(active ? { active } : {}), accounts, ...(order.length > 0 ? { order } : {}) };
}

/**
 * Put the rows in the user's order, and everything they have not placed after them.
 *
 * Stable in both halves: placed rows keep the order the array gives, and unplaced ones keep
 * the order they arrived in — which for a freshly added account means the bottom, where a
 * new subscription belongs until somebody says otherwise.
 */
function sort(accounts: ClaudeAccount[], order: string[] | undefined): ClaudeAccount[] {
	if (!order || order.length === 0) return accounts;
	const placed = order.map((id) => accounts.find((account) => account.id === id)).filter((account): account is ClaudeAccount => account !== undefined);
	return [...placed, ...accounts.filter((account) => !order.includes(account.id))];
}

/**
 * A rate limit's reset time in milliseconds, whichever unit it arrived in.
 *
 * `SDKRateLimitInfo.resetsAt` is **unix seconds**, and it was being stored and formatted as
 * milliseconds. Two things followed from that, and they are the two halves of the feature.
 * `1788588600` compared against `Date.now()` is always in the past, so an account looked
 * available again the instant it was marked spent — the memory that stops a rotation going
 * straight back to the subscription that just refused never bit. And the same number through
 * `new Date()` prints 1970, so the deck told people their limit would lift in January of
 * that year.
 *
 * The threshold is the only honest way to take both units: below `1e12` cannot be
 * milliseconds in any year anyone will see this (1e12 ms is September 2001), and above it
 * cannot be seconds (1e12 s is the year 33658). Idempotent, so it is safe at the boundary
 * *and* on the way out of the file — which is what migrates a list written before this.
 */
export function epochMs(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return value < 1e12 ? Math.round(value * 1000) : value;
}

/**
 * The environment that makes a `claude` process spend one particular account.
 *
 * `configDir` is where it reads its configuration from — the `active` link for a session, an
 * account's own directory for a one-off `auth` command. `keychain` is that account's stable
 * identity, which macOS needs and the other platforms ignore; the reasoning is on
 * `ClaudeAccounts.activeEnvironment`.
 *
 * `process.env` is spread because `env` **replaces** a subprocess's environment rather than
 * extending it: without it the CLI would start with no `PATH` and no `HOME`.
 */
export function accountEnvironment(configDir: string, keychain: string): NodeJS.ProcessEnv {
	return { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_SECURESTORAGE_CONFIG_DIR: keychain };
}
