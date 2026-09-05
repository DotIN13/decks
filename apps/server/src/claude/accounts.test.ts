import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeAccounts, DEFAULT_ACCOUNT, epochMs } from "./accounts.ts";

/**
 * Several Claude subscriptions, and which one is spending.
 *
 * The switching rules are the part worth pinning: which account is chosen next, what a
 * remembered limit does and stops doing, and that the symlink every session reads through
 * actually moves. The credentials themselves are Claude's — nothing here writes a token.
 */

/**
 * A store, and a stand-in for the CLI's own login.
 *
 * `home` is a directory rather than a file, because `default` is a *view* of the CLI's config
 * home: these tests need somewhere for the credentials, the transcripts and the settings to
 * actually be. All of it inside the temp directory, so nothing passes or fails by whether
 * whoever ran it happens to be logged in — and `platform` is injected so the macOS reading of
 * "signed in" is tested rather than asserted.
 */
function store({ homeSignedIn = true, platform = process.platform }: { homeSignedIn?: boolean; platform?: NodeJS.Platform } = {}): {
	accounts: ClaudeAccounts;
	dir: string;
	home: string;
	configFile: string;
	cleanup: () => void;
} {
	const dir = mkdtempSync(join(tmpdir(), "decks-accounts-"));
	const home = join(dir, "home");
	mkdirSync(join(home, "projects"), { recursive: true });
	writeFileSync(join(home, "settings.json"), "{}");
	// Beside the config home, not inside it — which is how the CLI resolves it.
	const configFile = join(dir, "home.json");
	writeFileSync(configFile, "{}");
	if (homeSignedIn) writeFileSync(join(home, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "not-a-real-token" } }));
	return {
		accounts: new ClaudeAccounts(dir, { configDir: home, configFile, platform }),
		dir,
		home,
		configFile,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/** Where the CLI's own token sits in a test store. */
const homeToken = (home: string): string => join(home, ".credentials.json");

/** Sign an account in, the way `slashLogin` does: a directory, then a row. */
function add(accounts: ClaudeAccounts, email: string): string {
	const { id, configDir } = accounts.begin();
	// What the CLI would have written there. Its shape does not matter to this store; that
	// it is *inside the account's own directory* is the whole point.
	writeFileSync(join(configDir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "not-a-real-token" } }));
	accounts.remember({ id, email });
	return id;
}

/** Where the symlink points, or nothing if there is none. */
const pointsAt = (dir: string): string | undefined => {
	const link = join(dir, "claude-accounts", "active");
	try {
		return lstatSync(link).isSymbolicLink() ? readlinkSync(link) : undefined;
	} catch {
		return undefined;
	}
};

test("a fresh install reads the CLI's own login through the link, not around it", () => {
	const { accounts, dir, home, configFile, cleanup } = store();
	assert.deepEqual(
		accounts.list().map((account) => account.id),
		[DEFAULT_ACCOUNT],
		"the CLI's own login is always a row",
	);
	assert.equal(accounts.activeId(), DEFAULT_ACCOUNT);
	/*
	 * This used to be `undefined`, on the reasoning that an install which never opens the
	 * settings panel should behave exactly as it always had — and that reasoning cost the
	 * feature its point. A session spawned with no `CLAUDE_CONFIG_DIR` is pinned to
	 * `~/.claude` for its whole life, because a subprocess's environment cannot be changed
	 * afterwards, so adding a second account later could not reach it and a limit could not
	 * move it.
	 */
	assert.equal(accounts.activeConfigDir(), join(dir, "claude-accounts", "active"));
	const view = join(dir, "claude-accounts", DEFAULT_ACCOUNT);
	assert.equal(pointsAt(dir), view, "at a view of the CLI's own directory, not at an account");

	// And the view resolves back to wherever the CLI actually keeps each thing.
	assert.equal(readlinkSync(join(view, ".credentials.json")), homeToken(home));
	assert.equal(readlinkSync(join(view, "projects")), join(home, "projects"));
	assert.equal(readlinkSync(join(view, ".claude.json")), configFile, "including the one file that lives outside the config home");
	cleanup();
});

/*
 * macOS names its keychain entry after the config directory, and every account is reached
 * through the same link — so with one variable they would all share one entry, and a login
 * written against an account's own directory would be looked for under the wrong name by the
 * session that follows it.
 */
test("the environment names the account, not the path it was reached by", () => {
	const { accounts, dir, cleanup } = store();
	const link = join(dir, "claude-accounts", "active");

	const mine = accounts.activeEnvironment();
	assert.equal(mine?.CLAUDE_CONFIG_DIR, link);
	assert.equal(mine?.CLAUDE_SECURESTORAGE_CONFIG_DIR, "", "the unsuffixed keychain entry a bare `claude` uses");

	const id = add(accounts, "one@example.com");
	const added = accounts.activeEnvironment();
	assert.equal(added?.CLAUDE_CONFIG_DIR, link, "still reached through the link");
	assert.equal(added?.CLAUDE_SECURESTORAGE_CONFIG_DIR, accounts.configDir(id), "but named by its own directory");
	cleanup();
});

test("an added account shares what is not account-bound", () => {
	const { accounts, home, cleanup } = store();
	const id = add(accounts, "one@example.com");
	const configDir = accounts.configDir(id);

	assert.equal(readlinkSync(join(configDir, "projects")), join(home, "projects"), "transcripts and memory stay in one place");
	assert.equal(readlinkSync(join(configDir, "settings.json")), join(home, "settings.json"), "and so does what the person has allowed");
	assert.equal(lstatSync(join(configDir, ".credentials.json")).isSymbolicLink(), false, "the token *is* the account, and stays its own");
	cleanup();
});

/*
 * An install that added accounts before any of this existed has transcripts inside them,
 * where nothing shared can see. Sweeping adopts them back out rather than leaving them.
 */
test("transcripts already written into an account are adopted back out", () => {
	const { accounts, home, cleanup } = store();
	const { id, configDir } = accounts.begin();
	writeFileSync(join(configDir, ".credentials.json"), "{}");
	accounts.remember({ id, email: "one@example.com" });
	rmSync(join(configDir, "projects"), { force: true });
	mkdirSync(join(configDir, "projects", "-a-deck"), { recursive: true });
	writeFileSync(join(configDir, "projects", "-a-deck", "one.jsonl"), "{}");

	accounts.sweep();

	assert.equal(readlinkSync(join(configDir, "projects")), join(home, "projects"), "linked now");
	assert.equal(existsSync(join(home, "projects", "-a-deck", "one.jsonl")), true, "and what was in there came with it");
	cleanup();
});

test("signing in adds an account, makes it active, and points the symlink at it", () => {
	const { accounts, dir, cleanup } = store();
	const id = add(accounts, "one@example.com");

	assert.deepEqual(
		accounts.list().map((account) => account.id),
		[DEFAULT_ACCOUNT, id],
		"added alongside the CLI's own, not instead of it",
	);
	assert.equal(accounts.activeId(), id);
	assert.equal(accounts.activeConfigDir(), join(dir, "claude-accounts", "active"));
	assert.equal(pointsAt(dir), accounts.configDir(id), "and the link a live session reads through moves");
	cleanup();
});

/*
 * The switch itself. A `rename` over a symlink is what makes it seamless — the CLI re-reads
 * its credentials per request, so a session already running picks up whatever the link points
 * at now.
 */
test("a limit moves the active account on, and the symlink with it", () => {
	const { accounts, dir, home, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");
	accounts.use(first);
	assert.equal(pointsAt(dir), accounts.configDir(first));

	/*
	 * The CLI's own login is signed out here, so the choice is between the two added
	 * accounts — which is the case this test is about. That `default` would otherwise be
	 * chosen first is its own test below.
	 */
	rmSync(homeToken(home), { force: true });
	const resets = Date.now() + 3 * 60 * 60 * 1000;
	const { moved, nextReset } = accounts.rotate(first, resets, "five_hour");
	assert.equal(moved?.id, second, "moved to the account that has not run out");
	assert.equal(nextReset, undefined);
	assert.equal(accounts.activeId(), second);
	assert.equal(pointsAt(dir), accounts.configDir(second));

	const spent = accounts.list().find((account) => account.id === first);
	assert.equal(spent?.limitedUntil, resets, "and remembers when the spent one comes back");
	assert.equal(spent?.limitType, "five_hour");
	cleanup();
});

test("the CLI's own login is one of the accounts a limit can move to", () => {
	const { accounts, dir, cleanup } = store();
	const only = add(accounts, "one@example.com");

	const { moved } = accounts.rotate(only, Date.now() + 60_000, "seven_day");
	assert.equal(moved?.id, DEFAULT_ACCOUNT, "rather than reporting that everything is spent");
	/*
	 * And the link moves with it, which is the half that used to be missing: rotating *to*
	 * the CLI's own login left the link on the spent account, so a session already running
	 * kept spending the subscription that had just refused.
	 */
	assert.equal(pointsAt(dir), accounts.configDir(DEFAULT_ACCOUNT));
	assert.equal(accounts.activeEnvironment()?.CLAUDE_SECURESTORAGE_CONFIG_DIR, "", "back on the CLI's own keychain entry");
	cleanup();
});

test("with everything spent it says when the first one comes back", () => {
	const { accounts, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");

	const later = Date.now() + 5 * 60 * 60 * 1000;
	const sooner = Date.now() + 30 * 60 * 1000;
	accounts.markLimited(DEFAULT_ACCOUNT, later, "seven_day");
	accounts.markLimited(second, later, "five_hour");
	const { moved, nextReset } = accounts.rotate(first, sooner, "five_hour");

	assert.equal(moved, undefined, "nothing to move to");
	assert.equal(nextReset, sooner, "and the soonest reset is the one worth reporting");
	cleanup();
});

test("a limit that has passed is no longer a reason to skip an account", () => {
	const { accounts, home, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");
	rmSync(homeToken(home), { force: true });
	// Spent, but the window has already lifted.
	accounts.markLimited(second, Date.now() - 60_000, "five_hour");

	assert.equal(accounts.nextAvailable(first)?.id, second, "the past is not a limit");
	cleanup();
});

/*
 * A limit must not move to an account with no token behind it.
 *
 * That would turn "out of quota" into "failed to authenticate", which is a worse failure
 * than the one being worked around: it does not read as a quota problem to anybody, and the
 * account it moved to looks fine in the list.
 */
test("an account that is signed out is not somewhere a limit can move to", () => {
	const { accounts, home, cleanup } = store({ homeSignedIn: false });
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");
	// Signed out: on the list, and not usable.
	rmSync(join(accounts.configDir(second), ".credentials.json"), { force: true });

	assert.equal(accounts.usable(second), false);
	const { moved, nextReset } = accounts.rotate(first, Date.now() + 60_000, "five_hour");
	assert.equal(moved, undefined, "not the signed-out one, and not the signed-out default");
	assert.ok(nextReset, "so it reports the wait instead");

	// Signed back in, and it becomes a destination again.
	writeFileSync(join(accounts.configDir(second), ".credentials.json"), "{}");
	assert.equal(accounts.nextAvailable(first)?.id, second);
	// And the CLI's own login, once it has a token, is chosen ahead of the others.
	writeFileSync(homeToken(home), "{}");
	assert.equal(accounts.nextAvailable(first)?.id, DEFAULT_ACCOUNT);
	cleanup();
});

/*
 * A limit with no reset time is held for an hour rather than forever.
 *
 * `resetsAt` is optional on the event, and an account skipped permanently because the number
 * was missing is an account nothing will ever use again.
 */
test("a limit with no reset time expires on its own", () => {
	const { accounts, cleanup } = store();
	const id = add(accounts, "one@example.com");
	accounts.markLimited(id, undefined, "five_hour");

	const until = accounts.list().find((account) => account.id === id)?.limitedUntil ?? 0;
	assert.ok(until > Date.now(), "held now");
	assert.ok(until < Date.now() + 2 * 60 * 60 * 1000, `and not held forever — ${new Date(until).toISOString()}`);
	cleanup();
});

test("choosing an account by hand clears the limit it was remembered with", () => {
	const { accounts, cleanup } = store();
	const id = add(accounts, "one@example.com");
	accounts.markLimited(id, Date.now() + 60 * 60 * 1000, "five_hour");

	const chosen = accounts.use(id);
	assert.equal(chosen?.limitedUntil, undefined, "a direct instruction outranks the memory");
	assert.equal(accounts.activeId(), id);
	cleanup();
});

/*
 * Signing in twice to one account replaces its row rather than adding a second.
 *
 * Two rows for one email is a list nobody can reason about, and the newer sign-in is the
 * fresher set of credentials — so the older directory goes with the row.
 */
test("signing in again to the same account replaces it", () => {
	const { accounts, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const again = add(accounts, "one@example.com");

	assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT, again]);
	assert.equal(existsSync(accounts.configDir(first)), false, "and the credentials of the row it replaced are gone");
	cleanup();
});

test("forgetting an account takes its credentials with it and moves off it", () => {
	const { accounts, home, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");
	accounts.use(second);

	rmSync(homeToken(home), { force: true });
	accounts.forget(second);
	assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT, first]);
	assert.equal(existsSync(accounts.configDir(second)), false);
	assert.equal(accounts.activeId(), first, "and does not leave the install on an account that is gone");
	cleanup();
});

/*
 * The CLI's own credentials are not Decks' to delete.
 *
 * `claude auth logout` is where those are given up, and a settings panel that could silently
 * sign you out of the terminal would be a surprise nobody asked for.
 */
test("the CLI's own login cannot be forgotten from here", () => {
	const { accounts, cleanup } = store();
	add(accounts, "one@example.com");
	accounts.forget(DEFAULT_ACCOUNT);
	assert.ok(
		accounts.list().some((account) => account.id === DEFAULT_ACCOUNT),
		"still there",
	);
	cleanup();
});

test("a login that was abandoned halfway leaves nothing behind", () => {
	const { accounts, cleanup } = store();
	const kept = add(accounts, "one@example.com");
	// `begin()` and no `remember()`: the dialog was closed, or the deck restarted mid-flow.
	const { configDir } = accounts.begin();
	assert.equal(existsSync(configDir), true);

	accounts.sweep();
	assert.equal(existsSync(configDir), false, "swept");
	assert.equal(existsSync(accounts.configDir(kept)), true, "and the account that finished is untouched");
	cleanup();
});

test("the symlink survives a sweep, because it is not an account", () => {
	const { accounts, dir, cleanup } = store();
	const id = add(accounts, "one@example.com");
	accounts.sweep();
	assert.equal(pointsAt(dir), accounts.configDir(id));
	cleanup();
});

/*
 * A list read from disk may have been written by an older build, or by hand, or half-written
 * by a crash. Nothing here trusts it — the shape is checked, and what is not the right shape
 * is dropped rather than passed on to the CLI as a config directory.
 */
test("a malformed list degrades to the CLI's own login", () => {
	const { accounts, dir, cleanup } = store();
	mkdirSync(join(dir, "claude-accounts"), { recursive: true });
	for (const body of ["not json at all", "[]", '{"accounts": "nope"}', '{"accounts": [{"nope": 1}, {"id": ""}]}', '{"active": "ghost", "accounts": []}']) {
		writeFileSync(join(dir, "claude-accounts", "index.json"), body);
		assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT], body);
		assert.equal(accounts.activeId(), DEFAULT_ACCOUNT, body);
		assert.equal(accounts.activeConfigDir(), join(dir, "claude-accounts", "active"), body);
		assert.equal(pointsAt(dir), accounts.configDir(DEFAULT_ACCOUNT), body);
	}
	cleanup();
});

test("an id that is not one this store issued is never turned into a path", () => {
	const { accounts, dir, cleanup } = store();
	mkdirSync(join(dir, "claude-accounts"), { recursive: true });
	const victim = join(dir, "do-not-delete-me");
	writeFileSync(victim, "still here");
	// A row whose id is a traversal. `forget` deletes an account's directory, so this is the
	// one place a hostile id could reach outside the store.
	writeFileSync(
		join(dir, "claude-accounts", "index.json"),
		JSON.stringify({ accounts: [{ id: "../../do-not-delete-me", addedAt: 1 }] }),
	);
	accounts.forget("../../do-not-delete-me");
	assert.equal(existsSync(victim), true, "the id did not become a path");
	cleanup();
});

/*
 * Reading the list must not change it.
 *
 * `describeDefault` records what the CLI's own login is called so a row keeps its name when
 * `auth status` is next slow — and the first version wrote the whole row, which dropped the
 * remembered limit. Opening the settings panel therefore made a spent account look fresh,
 * and the next rotation would have gone straight back to the one that had just refused.
 */
test("recording the default account's name does not forget that it ran out", () => {
	const { accounts, cleanup } = store();
	const resets = Date.now() + 60 * 60 * 1000;
	accounts.markLimited(DEFAULT_ACCOUNT, resets, "five_hour");

	accounts.describeDefault({ email: "me@example.com", orgName: "Somewhere", plan: "Claude Max" });

	const row = accounts.list().find((account) => account.id === DEFAULT_ACCOUNT);
	assert.equal(row?.email, "me@example.com", "the name is recorded");
	assert.equal(row?.limitedUntil, resets, "and the limit is still remembered");
	assert.equal(row?.limitType, "five_hour");
	// The point of remembering it: a limit does not rotate back to the account that refused.
	const other = add(accounts, "other@example.com");
	assert.equal(accounts.nextAvailable(other)?.id, undefined, "nothing to move to, rather than back to the spent one");
	cleanup();
});

/*
 * The pair that could not be told apart, and could not be got rid of.
 *
 * Signing in as the subscription the CLI is *already* on used to produce two rows with the
 * same email — one removable and one not — because `remember()` dropped the CLI's row as a
 * duplicate and `describeDefault()` put it back on the next read of the panel. The store's
 * half of the fix is these two: the CLI's row is never the duplicate that gets removed, and
 * `abandon()` is what a caller uses when the login it just did turns out to be that account.
 */
test("the CLI's own row is never removed as a duplicate of an added account", () => {
	const { accounts, cleanup } = store();
	accounts.describeDefault({ email: "me@example.com", orgName: "Somewhere", plan: "enterprise" });

	// The same email, added by hand. Whatever else happens, the first row stays.
	add(accounts, "me@example.com");

	const ids = accounts.list().map((account) => account.id);
	assert.equal(ids[0], DEFAULT_ACCOUNT, "still the head of the list");
	assert.equal(
		accounts.list().find((account) => account.id === DEFAULT_ACCOUNT)?.email,
		"me@example.com",
		"and still labelled, rather than dropped and re-synthesised nameless",
	);
	cleanup();
});

test("abandoning a login leaves the CLI's own account in force, and the link on it", () => {
	const { accounts, dir, cleanup } = store();
	accounts.describeDefault({ email: "me@example.com" });
	const other = add(accounts, "other@example.com");
	assert.equal(accounts.activeId(), other, "the added account is in force");

	// The login that turns out to be the CLI's own subscription.
	const { id, configDir } = accounts.begin();
	writeFileSync(join(configDir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "not-a-real-token" } }));
	const landed = accounts.abandon(id);

	assert.equal(landed.id, DEFAULT_ACCOUNT, "and says which row you ended up on");
	assert.equal(accounts.activeId(), DEFAULT_ACCOUNT, "that subscription, by the shorter route");
	assert.equal(existsSync(configDir), false, "the second copy of the credentials is gone");
	assert.deepEqual(
		accounts.list().map((account) => account.id),
		[DEFAULT_ACCOUNT, other],
		"no third row for an account that was never added",
	);
	assert.equal(pointsAt(dir), accounts.configDir(DEFAULT_ACCOUNT), "and the link is aimed back at the CLI's own, not left dangling");
	cleanup();
});

test("forgetting the account in force moves the link to the CLI's own, not to nothing", () => {
	const { accounts, dir, cleanup } = store();
	const only = add(accounts, "me@example.com");
	assert.equal(pointsAt(dir), join(dir, "claude-accounts", only));

	accounts.forget(only);

	assert.equal(accounts.activeId(), DEFAULT_ACCOUNT);
	/*
	 * The link used to be left pointing at the directory this call had just deleted — a
	 * dangling symlink in a credentials directory, and a running session with nowhere to read
	 * its token from.
	 */
	assert.equal(pointsAt(dir), accounts.configDir(DEFAULT_ACCOUNT), "aimed at the CLI's own, rather than at nothing");
	assert.equal(existsSync(join(accounts.configDir(DEFAULT_ACCOUNT), ".credentials.json")), true, "which is a directory with a token behind it");
	cleanup();
});

/*
 * A rate limit belongs to the subscription, not to the row.
 *
 * One subscription can still be two rows on an install that made the pair before
 * `abandon()` existed. Marking only the row that refused left its twin looking available,
 * so the next choice switched to the same account that had just run out.
 */
test("a limit is recorded against every row with that email", () => {
	const { accounts, cleanup } = store();
	accounts.describeDefault({ email: "me@example.com" });
	const copy = add(accounts, "me@example.com");
	const other = add(accounts, "other@example.com");
	const resets = Date.now() + 60 * 60 * 1000;

	accounts.markLimited(copy, resets, "five_hour");

	const limited = accounts.list().filter((account) => account.limitedUntil === resets);
	assert.deepEqual(
		limited.map((account) => account.id).sort(),
		[DEFAULT_ACCOUNT, copy].sort(),
		"both rows for that one subscription",
	);
	assert.equal(accounts.list().find((account) => account.id === other)?.limitedUntil, undefined, "and nothing else");
	assert.equal(accounts.nextAvailable(copy)?.id, other, "so the next choice is a different subscription");
	cleanup();
});


/*
 * On macOS the token is in the keychain and `.credentials.json` may not exist at all. Read
 * as a file that is simply missing, every account looked signed out — `pick` passed over all
 * of them and a limit had nowhere to move to, on the one platform where nothing else looked
 * wrong.
 */
test("on macOS a signed-in account is recognised without a credentials file", () => {
	const { accounts, cleanup } = store({ homeSignedIn: false, platform: "darwin" });
	const { id, configDir } = accounts.begin();
	accounts.remember({ id, email: "one@example.com" });
	assert.equal(accounts.usable(id), false, "nothing signed in yet");

	writeFileSync(join(configDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "one@example.com" } }));
	assert.equal(accounts.usable(id), true, "the CLI's own record of who this directory is");
	cleanup();
});

test("on Linux a keychain record is not evidence of a token", () => {
	const { accounts, cleanup } = store({ homeSignedIn: false, platform: "linux" });
	const { id, configDir } = accounts.begin();
	accounts.remember({ id, email: "one@example.com" });
	writeFileSync(join(configDir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "one@example.com" } }));

	assert.equal(accounts.usable(id), false, "here the file *is* the token, and there is not one");
	cleanup();
});

/*
 * `SDKRateLimitInfo.resetsAt` is unix seconds. Stored and compared as milliseconds it is
 * always in the past, so an account looked available again the instant it was marked spent —
 * and printed as a date it read 1970.
 */
test("a reset time in seconds is taken as seconds", () => {
	const { accounts, cleanup } = store();
	const id = add(accounts, "one@example.com");
	const seconds = Math.floor(Date.now() / 1000) + 3 * 60 * 60;

	accounts.markLimited(id, seconds, "five_hour");

	assert.equal(accounts.list().find((account) => account.id === id)?.limitedUntil, seconds * 1000);
	assert.equal(accounts.nextAvailable(undefined)?.id, DEFAULT_ACCOUNT, "and the spent one is actually skipped");
	assert.equal(epochMs(seconds * 1000), seconds * 1000, "milliseconds pass through, so it is safe to run twice");
	assert.equal(epochMs(undefined), undefined);
	assert.equal(epochMs(0), undefined, "and nothing is not a time");
	cleanup();
});

test("a limit written in seconds by an older build is migrated on read", () => {
	const { accounts, dir, cleanup } = store();
	const id = add(accounts, "one@example.com");
	const seconds = Math.floor(Date.now() / 1000) + 3600;
	writeFileSync(
		join(dir, "claude-accounts", "index.json"),
		JSON.stringify({ active: id, accounts: [{ id, email: "one@example.com", addedAt: 1, limitedUntil: seconds }] }),
	);

	assert.equal(accounts.list().find((account) => account.id === id)?.limitedUntil, seconds * 1000);
	cleanup();
});

/*
 * The CLI's own row stands for whatever `~/.claude` is signed in as, and that can change
 * under it. A limit remembered against the account that was replaced would have the deck
 * rotating away from a subscription that has spent nothing.
 */
test("a new login behind the CLI's own row forgets the old one's limit", () => {
	const { accounts, cleanup } = store();
	accounts.describeDefault({ email: "first@example.com", plan: "max" });
	accounts.markLimited(DEFAULT_ACCOUNT, Date.now() + 60 * 60 * 1000, "five_hour");
	assert.ok(accounts.list().find((account) => account.id === DEFAULT_ACCOUNT)?.limitedUntil, "spent");

	accounts.describeDefault({ email: "second@example.com", plan: "max" });

	const mine = accounts.list().find((account) => account.id === DEFAULT_ACCOUNT);
	assert.equal(mine?.email, "second@example.com");
	assert.equal(mine?.limitedUntil, undefined, "a different subscription, so not the same limit");
	assert.equal(mine?.limitType, undefined);

	// And the same email twice still keeps it — publishing the list must stay a read.
	accounts.markLimited(DEFAULT_ACCOUNT, Date.now() + 60 * 60 * 1000, "five_hour");
	accounts.describeDefault({ email: "second@example.com", plan: "max" });
	assert.ok(accounts.list().find((account) => account.id === DEFAULT_ACCOUNT)?.limitedUntil, "still spent");
	cleanup();
});

/*
 * Priority: the order of the list, and the arrows that set it.
 *
 * The list has always been the order a limit walks. What is new is that it is the user's to
 * set, so these are about the two halves of that: the order survives the things that rewrite
 * the account list for other reasons, and it is what `rotate` actually follows.
 */
test("moving an account up makes it the one a limit goes to first", () => {
	const { accounts, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");
	assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT, first, second]);

	assert.equal(accounts.move(second, "up"), true);
	assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT, second, first]);

	// And the rotation follows it, which is the only reason the order exists.
	const { moved } = accounts.rotate(DEFAULT_ACCOUNT, Date.now() + 60_000, "five_hour");
	assert.equal(moved?.id, second);
	cleanup();
});

test("the CLI's own login is not pinned to the top", () => {
	const { accounts, cleanup } = store();
	const mine = add(accounts, "one@example.com");

	assert.equal(accounts.move(DEFAULT_ACCOUNT, "down"), true);
	assert.deepEqual(accounts.list().map((account) => account.id), [mine, DEFAULT_ACCOUNT]);
	cleanup();
});

test("a press at the end of the list moves nothing and says so", () => {
	const { accounts, cleanup } = store();
	const only = add(accounts, "one@example.com");

	assert.equal(accounts.move(DEFAULT_ACCOUNT, "up"), false, "already at the top");
	assert.equal(accounts.move(only, "down"), false, "already at the bottom");
	assert.equal(accounts.move("never-existed", "up"), false);
	cleanup();
});

test("the order is not what the account list happens to be in", () => {
	const { accounts, cleanup } = store();
	const first = add(accounts, "one@example.com");
	accounts.move(first, "up");
	assert.deepEqual(accounts.list().map((account) => account.id), [first, DEFAULT_ACCOUNT]);

	/*
	 * `describeDefault` rewrites the stored array on every publish, moving the CLI's own row
	 * to the end of it. An order kept *as* that array's order would be undone by merely
	 * reading the account list — which is why it is a separate field.
	 */
	accounts.describeDefault({ email: "mine@example.com" });
	assert.deepEqual(accounts.list().map((account) => account.id), [first, DEFAULT_ACCOUNT], "and reading the list did not reshuffle it");
	cleanup();
});

test("an account added later joins at the bottom, and one forgotten leaves no gap", () => {
	const { accounts, cleanup } = store();
	const first = add(accounts, "one@example.com");
	accounts.move(first, "up");

	const second = add(accounts, "two@example.com");
	assert.deepEqual(accounts.list().map((account) => account.id), [first, DEFAULT_ACCOUNT, second], "placed rows keep their places");

	accounts.forget(first);
	assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT, second], "a stale id in the order is simply not found");
	cleanup();
});
