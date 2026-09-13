import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaudeAccounts, DEFAULT_ACCOUNT, epochMs } from "./accounts.ts";

/**
 * Several Claude subscriptions, and which one each conversation spends.
 *
 * The mechanics are the part worth pinning: that the symlink a session reads its credentials
 * through actually moves, that one agent's link is its own, and that a list written by the
 * build which switched accounts on its own is read without its remembered limits. The
 * credentials themselves are Claude's — nothing here writes a token.
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
 * The token comes from `CLAUDE_SECURESTORAGE_CONFIG_DIR`, not from `CLAUDE_CONFIG_DIR` — so
 * unless the link is on that variable too, a session is pinned to whichever account was active
 * when it spawned and no switch can reach it. This is the assertion the feature rests on.
 */
test("a session reads its credentials through the link, not from a fixed account", () => {
	const { accounts, dir, cleanup } = store({ platform: "linux" });
	const link = join(dir, "claude-accounts", "active");

	const mine = accounts.activeEnvironment();
	assert.equal(mine?.CLAUDE_CONFIG_DIR, link);
	assert.equal(mine?.CLAUDE_SECURESTORAGE_CONFIG_DIR, link, "the CLI's own login goes through the link like any other");

	const id = add(accounts, "one@example.com");
	const added = accounts.activeEnvironment();
	assert.equal(added?.CLAUDE_CONFIG_DIR, link, "still reached through the link");
	assert.equal(added?.CLAUDE_SECURESTORAGE_CONFIG_DIR, link, "and so is the token, which is what makes the switch land");
	assert.notEqual(added?.CLAUDE_SECURESTORAGE_CONFIG_DIR, accounts.configDir(id), "never the resolved path: that is the pin");
	cleanup();
});

/*
 * macOS is the exception, and the reason the variable exists at all. There the value names a
 * keychain entry, `Claude Code-credentials-<sha256(dir)[:8]>` — so every account reached
 * through one link would hash to one entry and overwrite each other's tokens, and a login
 * written against an account's own directory would be looked for under the wrong name by the
 * session that follows it. A stable identity per account is worth more there than a live
 * switch, which is the trade `credentialsDir` makes.
 */
test("on macOS the environment names the account, not the path it was reached by", () => {
	const { accounts, dir, cleanup } = store({ platform: "darwin" });
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
 * Reading the list must not reorder it.
 *
 * `describeDefault` records what the CLI's own login is called, so a row keeps its name when
 * `auth status` is next slow. It is the one part of publishing the list that writes, and it
 * moves the CLI's own row to the end of the stored array — so the reading of that array has
 * to be the thing that puts it back at the head, rather than the array's own order.
 */
test("recording the default account's name leaves the list in the order it publishes in", () => {
	const { accounts, cleanup } = store();
	const other = add(accounts, "other@example.com");

	accounts.describeDefault({ email: "me@example.com", orgName: "Somewhere", plan: "Claude Max" });
	accounts.describeDefault({ email: "me@example.com", orgName: "Somewhere", plan: "Claude Max" });

	assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT, other], "the CLI's own first, however often it is described");
	assert.equal(accounts.list().find((account) => account.id === DEFAULT_ACCOUNT)?.email, "me@example.com", "and named");
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
 * On macOS the token is in the keychain and `.credentials.json` may not exist at all. Read
 * as a file that is simply missing, every account on the machine looked signed out — on the
 * one platform where nothing else looked wrong.
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
 * `SDKRateLimitInfo.resetsAt` is unix seconds, and it reaches a person as a sentence: printed
 * as milliseconds it read 1970, so the deck told people their limit would lift in January of
 * that year. Nothing is stored any more, so this is the whole of what the unit does.
 */
test("a reset time in seconds is taken as seconds", () => {
	const seconds = Math.floor(Date.now() / 1000) + 3 * 60 * 60;
	assert.equal(epochMs(seconds), seconds * 1000);
	assert.equal(epochMs(seconds * 1000), seconds * 1000, "milliseconds pass through, so it is safe to run twice");
	assert.equal(epochMs(undefined), undefined);
	assert.equal(epochMs(0), undefined, "and nothing is not a time");
});

/*
 * A list written by the build that switched accounts on its own.
 *
 * Two fields and an array it no longer has anywhere to put: a remembered rate limit, the
 * window it belonged to, and the priority order the arrows used to set. They are dropped on
 * read rather than migrated, which is also what cleans them out of the file — and the rest of
 * the row has to survive, because it is the account.
 */
test("a list written by an older build loses its limits and its order, and nothing else", () => {
	const { accounts, dir, cleanup } = store();
	const id = add(accounts, "one@example.com");
	const other = add(accounts, "two@example.com");
	const file = join(dir, "claude-accounts", "index.json");
	writeFileSync(
		file,
		JSON.stringify({
			active: id,
			order: [other, id, DEFAULT_ACCOUNT],
			accounts: [
				{ id, email: "one@example.com", addedAt: 1, limitedUntil: Date.now() + 3600_000, limitType: "five_hour" },
				{ id: other, email: "two@example.com", addedAt: 2, plan: "Claude Max" },
			],
		}),
	);

	const rows = accounts.list();
	assert.deepEqual(rows.map((account) => account.id), [DEFAULT_ACCOUNT, id, other], "the CLI's own first, then as they were added");
	assert.deepEqual(Object.keys(rows[1] ?? {}).sort(), ["addedAt", "email", "id"], "no limit survives the read");
	assert.equal(rows[2]?.plan, "Claude Max", "and everything that is still a field does");
	// And it is gone from the file itself the next time anything writes.
	accounts.describeDefault({ email: "me@example.com" });
	const written = JSON.parse(readFileSync(file, "utf8")) as { order?: unknown; accounts: Array<Record<string, unknown>> };
	assert.equal(written.order, undefined, "the order is not written back");
	assert.ok(
		written.accounts.every((account) => account.limitedUntil === undefined && account.limitType === undefined),
		JSON.stringify(written.accounts),
	);
	cleanup();
});

/*
 * The list, and the one question a limit still asks it.
 *
 * There is no priority order any more: the arrows are gone, nothing walks the list looking
 * for a successor, and the only thing left that reads it is the sentence a refusal says —
 * "pick another one in the model picker", or "add another account in settings" when there is
 * nothing to pick.
 */
test("the list is the CLI's own login and then the order they were added", () => {
	const { accounts, cleanup } = store();
	const first = add(accounts, "one@example.com");
	const second = add(accounts, "two@example.com");

	assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT, first, second]);
	accounts.forget(first);
	assert.deepEqual(accounts.list().map((account) => account.id), [DEFAULT_ACCOUNT, second], "and a gap closes rather than being kept");
	cleanup();
});

test("a new conversation starts on the stored row, and on something usable when that cannot answer", () => {
	const { accounts, cleanup } = store();
	assert.equal(accounts.defaultId(), DEFAULT_ACCOUNT, "a fresh install: the login the machine already had");

	const added = add(accounts, "one@example.com");
	assert.equal(accounts.defaultId(), added, "signing one in makes it where a new conversation starts");

	// Signed out under it. The stored answer cannot answer, so it repairs rather than
	// pointing a conversation at an account that will fail to authenticate.
	rmSync(join(accounts.configDir(added), ".credentials.json"), { force: true });
	assert.equal(accounts.defaultId(), DEFAULT_ACCOUNT);
	cleanup();
});

test("with no token anywhere it still names the CLI's own login", () => {
	const { accounts, cleanup } = store({ homeSignedIn: false });
	assert.equal(accounts.defaultId(), DEFAULT_ACCOUNT, "a list that can name nobody is not an option");
	cleanup();
});

test("a limit is told whether there is another subscription to offer", () => {
	const { accounts, home, cleanup } = store();
	assert.equal(accounts.hasOther(DEFAULT_ACCOUNT), false, "one account, so the sentence says to add one");

	const added = add(accounts, "one@example.com");
	assert.equal(accounts.hasOther(DEFAULT_ACCOUNT), true, "somewhere to go, so it says to pick one");
	assert.equal(accounts.hasOther(added), true, "and the CLI's own login counts as somewhere");

	// Signed out is not somewhere to go: pointing at a row with no token behind it would turn
	// "out of quota" into "failed to authenticate", which reads as a quota problem to nobody.
	rmSync(join(accounts.configDir(added), ".credentials.json"), { force: true });
	assert.equal(accounts.hasOther(DEFAULT_ACCOUNT), false);
	rmSync(homeToken(home), { force: true });
	assert.equal(accounts.hasOther(added), false);
	cleanup();
});

/*
 * A subscription per agent.
 *
 * The mechanism is the one the global switch already used, moved down a level: a symlink the
 * CLI re-reads on every request, one per agent instead of one per machine. So what is worth
 * pinning is that the links are genuinely separate — that repointing one agent's cannot be
 * observed by another.
 */

/** Where one agent's link points, resolved. */
const agentPointsAt = (dir: string, agentId: string): string => readlinkSync(join(dir, "claude-accounts", "agents", agentId));

test("two agents get two links, and repointing one leaves the other alone", () => {
	const { accounts, dir, cleanup } = store({ platform: "linux" });
	const one = add(accounts, "one@example.com");
	const two = add(accounts, "two@example.com");

	const envA = accounts.environmentFor("agent-a", one);
	const envB = accounts.environmentFor("agent-b", two);
	assert.equal(envA?.CLAUDE_CONFIG_DIR, join(dir, "claude-accounts", "agents", "agent-a"));
	assert.equal(envA?.CLAUDE_SECURESTORAGE_CONFIG_DIR, envA?.CLAUDE_CONFIG_DIR, "the token comes from the same link");
	assert.equal(envB?.CLAUDE_CONFIG_DIR, join(dir, "claude-accounts", "agents", "agent-b"), "its own link, not a shared one");

	assert.equal(agentPointsAt(dir, "agent-a"), accounts.configDir(one));
	assert.equal(agentPointsAt(dir, "agent-b"), accounts.configDir(two));

	// The switch: one agent moves, and that is the whole of what changed.
	assert.equal(accounts.pointAgentAt("agent-a", two), true);
	assert.equal(agentPointsAt(dir, "agent-a"), accounts.configDir(two));
	assert.equal(agentPointsAt(dir, "agent-b"), accounts.configDir(two), "unmoved, and still its own link");
	cleanup();
});

test("an agent named an account that has since been forgotten falls back to the default", () => {
	const { accounts, dir, cleanup } = store({ platform: "linux" });
	const gone = add(accounts, "gone@example.com");
	accounts.forget(gone);

	const env = accounts.environmentFor("agent-a", gone);
	assert.ok(env, "it still gets an environment rather than nothing");
	assert.equal(agentPointsAt(dir, "agent-a"), accounts.configDir(accounts.defaultId()), "pointed somewhere that exists");
	cleanup();
});

test("an agent's link goes when the agent does, and strays are swept", () => {
	const { accounts, dir, cleanup } = store({ platform: "linux" });
	const one = add(accounts, "one@example.com");
	accounts.environmentFor("agent-a", one);
	accounts.environmentFor("agent-b", one);
	accounts.environmentFor("agent-c", one);

	accounts.releaseAgent("agent-a");
	assert.equal(existsSync(join(dir, "claude-accounts", "agents", "agent-a")), false);

	// The rest: a chat pruned while the server was down leaves a link nobody will ask for.
	accounts.sweepAgents(["agent-b"]);
	assert.equal(existsSync(join(dir, "claude-accounts", "agents", "agent-b")), true, "an agent that still exists keeps its link");
	assert.equal(existsSync(join(dir, "claude-accounts", "agents", "agent-c")), false, "one that does not, does not");
	cleanup();
});

test("on macOS the per-agent link carries the config home and the account still names the keychain entry", () => {
	const { accounts, dir, cleanup } = store({ platform: "darwin" });
	const one = add(accounts, "one@example.com");

	const env = accounts.environmentFor("agent-a", one);
	assert.equal(env?.CLAUDE_CONFIG_DIR, join(dir, "claude-accounts", "agents", "agent-a"));
	/*
	 * Not the link. There the value names a keychain entry rather than a directory to read,
	 * and every agent reached through a link of its own would still hash to whatever that
	 * link is called — so the account's own directory is what keeps one entry per account.
	 */
	assert.equal(env?.CLAUDE_SECURESTORAGE_CONFIG_DIR, accounts.configDir(one));
	cleanup();
});
