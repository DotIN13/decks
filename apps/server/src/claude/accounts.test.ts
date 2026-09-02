import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeAccounts, DEFAULT_ACCOUNT } from "./accounts.ts";

/**
 * Several Claude subscriptions, and which one is spending.
 *
 * The switching rules are the part worth pinning: which account is chosen next, what a
 * remembered limit does and stops doing, and that the symlink every session reads through
 * actually moves. The credentials themselves are Claude's — nothing here writes a token.
 */

/**
 * A store, and a stand-in for the CLI's own `~/.claude`.
 *
 * `home` decides whether the `default` row is signed in, and therefore whether a limit can
 * move to it — pointed at the temp directory so these tests do not pass or fail by whether
 * whoever ran them happens to be logged in.
 */
function store({ homeSignedIn = true } = {}): { accounts: ClaudeAccounts; dir: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "decks-accounts-"));
	const home = join(dir, "home-credentials.json");
	if (homeSignedIn) writeFileSync(home, JSON.stringify({ claudeAiOauth: { accessToken: "not-a-real-token" } }));
	return { accounts: new ClaudeAccounts(dir, home), dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

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

test("a fresh install is on the CLI's own login and sets no config dir", () => {
	const { accounts, cleanup } = store();
	assert.deepEqual(
		accounts.list().map((account) => account.id),
		[DEFAULT_ACCOUNT],
		"the CLI's own login is always a row",
	);
	assert.equal(accounts.activeId(), DEFAULT_ACCOUNT);
	/*
	 * The one that keeps every install that never opens this panel working exactly as before:
	 * no `CLAUDE_CONFIG_DIR` means the CLI uses `~/.claude`, which is what it always did.
	 */
	assert.equal(accounts.activeConfigDir(), undefined);
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
	const { accounts, dir, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");
	accounts.use(first);
	assert.equal(pointsAt(dir), accounts.configDir(first));

	/*
	 * The CLI's own login is signed out here, so the choice is between the two added
	 * accounts — which is the case this test is about. That `default` would otherwise be
	 * chosen first is its own test below.
	 */
	rmSync(join(dir, "home-credentials.json"), { force: true });
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
	assert.equal(accounts.activeConfigDir(), undefined, "which means unsetting the variable again");
	/*
	 * The link is left pointing at the spent account, which is harmless: `activeConfigDir`
	 * returns nothing for the default row, so nothing reads it.
	 */
	assert.equal(pointsAt(dir), accounts.configDir(only));
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
	const { accounts, dir, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");
	rmSync(join(dir, "home-credentials.json"), { force: true });
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
	const { accounts, dir, cleanup } = store({ homeSignedIn: false });
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
	writeFileSync(join(dir, "home-credentials.json"), "{}");
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
	const { accounts, dir, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");
	accounts.use(second);

	rmSync(join(dir, "home-credentials.json"), { force: true });
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
		assert.equal(accounts.activeConfigDir(), undefined, body);
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
