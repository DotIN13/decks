/**
 * Several Claude subscriptions, and which one a conversation spends.
 *
 * A subscription has a rate limit, and reaching it stops the work — so several can be signed
 * in at once and each conversation spends one of them, chosen in its own model picker
 * (`claude/accounts.ts`). The switch is seamless: the CLI re-reads its credentials per
 * request and every session is pointed at a symlink of its own, so moving that link changes
 * which subscription the next turn spends.
 *
 * This panel switches nothing and orders nothing — switching is the model picker, which
 * `accounts-per-agent.mjs` drives, and there is no order because nothing rotates. What is
 * left here is the *set* of accounts: adding, removing, and the two states a row can be in.
 *
 * The login itself is an OAuth flow that cannot be automated, so what is driven here is
 * everything around it — the list, the states a row can be in, and that reading the list
 * changes nothing.
 *
 * Accounts are stored per *install* rather than per deck, so this writes under the fixture's
 * data directory and takes it away again.
 */
import { preflight, deckState, hasOverflowRow, open, openOverflow, say, settle } from "../harness.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * A fixture, before anything is written. These accounts live in the *install* directory, not
 * in the deck, so a run against a live Decks would overwrite somebody's real subscriptions —
 * and `harness.mjs` defaults to the ports a live Decks uses.
 */
await preflight();

/** The install's directory, which is the deck's parent — see `config.ts`. */
const dataDir = dirname((await deckState()).path);
const accountsDir = join(dataDir, "claude-accounts");

const { browser, page, errors } = await open();
await settle(page, 1500);

// --- the panel -------------------------------------------------------------------
say("settings is a row in the corner's overflow", await hasOverflowRow(page, /settings/i));
await openOverflow(page, /settings/i);
await page.waitForSelector(".settings", { timeout: 6000 });
await page.waitForTimeout(1500);

const rows = await page.evaluate(() =>
	[...document.querySelectorAll(".account-row")].map((row) => ({
		text: row.innerText.replace(/\n+/g, " | "),
		current: row.dataset.current === "true",
		removable: Boolean(row.querySelector(".close")),
		pressable: Boolean(row.querySelector("button[data-row]")),
		arrows: row.querySelectorAll('[aria-label*="Move" i]').length,
	})),
);
console.log("      rows:", JSON.stringify(rows, null, 1));
say("the CLI's own login is on the list", rows.length >= 1);
say("…and is the default for a new conversation on a fresh install", rows[0]?.current === true);
say("…named from the CLI rather than as a uuid", /@/.test(rows[0]?.text ?? ""), rows[0]?.text);
say("…and cannot be removed from here", rows[0]?.removable === false, "those credentials are the CLI's");
// Nothing in this panel is pressable except the ×: a row that still looked like a switch
// would be the same lie in a quieter form.
say("no row is a switch", rows.every((row) => row.pressable === false), JSON.stringify(rows.map((r) => r.pressable)));
// And no arrows, because there is no order: nothing walks the list when a limit lands.
say("…and no row can be reordered", rows.every((row) => row.arrows === 0), JSON.stringify(rows.map((r) => r.arrows)));

// --- what the store did on disk --------------------------------------------------
/*
 * Opening the panel records what the CLI's own login is *called*, so the row keeps its name
 * when `auth status` is next slow — but it holds no token and changes nothing about which
 * account is spending.
 */
const indexFile = join(accountsDir, "index.json");
if (existsSync(indexFile)) {
	const written = readFileSync(indexFile, "utf8");
	say("the list holds no credentials", !/accessToken|refreshToken|sk-ant/.test(written), written.replace(/\s+/g, " ").slice(0, 120));
	say("…and merely reading it does not point anywhere", !existsSync(join(accountsDir, "active")), "no symlink until an account is added");
} else {
	say("the list holds no credentials", true, "nothing written at all");
	say("…and merely reading it does not point anywhere", true);
}

// --- two more accounts, seen through the server ----------------------------------
/*
 * The login is an OAuth flow that cannot be automated, so the accounts are written the way
 * the store writes them and the *server* is what reads them. Which is the honest test: what
 * is being checked is that the list and the default row reach the browser.
 *
 * The index is deliberately written the way the *previous* build wrote it — with a remembered
 * limit, the window it belonged to, and a priority order — because a real install upgrading
 * to this one has exactly that file on disk. None of it should reach the panel.
 */
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
for (const id of ids) {
	mkdirSync(join(accountsDir, id), { recursive: true });
	writeFileSync(join(accountsDir, id, ".credentials.json"), "{}");
}
const resets = Date.now() + 3 * 60 * 60 * 1000;
writeFileSync(
	join(accountsDir, "index.json"),
	JSON.stringify({
		active: ids[1],
		order: [ids[1], ids[0], "default"],
		accounts: [
			{ id: "default", addedAt: 0, email: "tzhang5@stanford.edu", limitedUntil: resets, limitType: "five_hour" },
			{ id: ids[0], addedAt: 1, email: "one@example.com", plan: "Claude Max" },
			{ id: ids[1], addedAt: 2, email: "two@example.com", plan: "Claude Pro" },
		],
	}),
);

// The panel asks on open, so close and reopen to read the new list.
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await openOverflow(page, /settings/i);
await page.waitForSelector(".settings", { timeout: 6000 });
await page.waitForTimeout(2000);
const after = await page.evaluate(() =>
	[...document.querySelectorAll(".account-row")].map((row) => ({
		text: row.innerText.replace(/\n+/g, " | "),
		current: row.dataset.current === "true",
		removable: Boolean(row.querySelector(".close")),
	})),
);
console.log("      after:", JSON.stringify(after, null, 1));
say("the server reads the whole list", after.length === 3, `${after.length} rows`);
/*
 * The CLI's own login first, then the order they were added — and *not* the order written in
 * the file, which this fixture put backwards on purpose. An install upgrading from the build
 * that had arrows must not keep being ordered by a field nothing sets any more.
 */
say(
	"…in the CLI's own order, ignoring a priority list written by an older build",
	/tzhang5@stanford.edu/.test(after[0]?.text ?? "") && /one@example.com/.test(after[1]?.text ?? "") && /two@example.com/.test(after[2]?.text ?? ""),
	JSON.stringify(after.map((row) => row.text)),
);
/*
 * And a remembered rate limit is gone with the switching it existed for. Nothing re-checked
 * it, so a row could sit marked "limited · back at 14:20" long after its window had lifted —
 * and it was only ever the last refusal's word about a subscription.
 */
say("…with no row claiming to be spent", after.every((row) => !/limited|spent/.test(row.text)), JSON.stringify(after.map((row) => row.text)));
/*
 * And no row is labelled the default for new conversations, which is the right answer rather
 * than a missing one.
 *
 * The stored default here is one of the two fabricated accounts. Its credentials *file* is
 * real enough for the server to keep naming it — that is all the server has to go on — but
 * `claude auth status` reports it signed out, and the panel will not tell somebody a
 * conversation is going to start on an account that cannot answer. So the badge is withheld
 * and the row says "signed out" instead, which is the fact worth reading.
 */
say(
	"…and no row is labelled the default when the stored one is signed out",
	after.filter((row) => row.current).length === 0,
	JSON.stringify(after.map((row) => `${row.current ? "*" : " "}${row.text}`)),
);
/*
 * One status per row, ranked. An early draft drew each condition independently and produced
 * "default for new · signed out" — two claims that cannot both be true.
 */
say(
	"…and never two contradictory states on one row",
	after.every((r) => !(/signed out/.test(r.text) && /default for new/.test(r.text))),
	JSON.stringify(after.map((r) => r.text)),
);
say("…with the added ones removable and the CLI's own not", after.filter((r) => r.removable).length === 2);
/*
 * And the row without a × says why it has none.
 *
 * "Claude Code's own login" used to be a *fallback* for the row's name, so it appeared only
 * when the CLI reported no email — the one case where the row is already unmistakable. With
 * an email to show, the row read as an ordinary account that happened to have no delete
 * button, and somebody who had signed in to that same subscription by hand was looking at
 * two identical rows, one removable and one not.
 */
say(
	"the CLI's own row says what it is, so the missing × has a reason",
	/Claude Code's own login/.test(after.find((r) => !r.removable)?.text ?? ""),
	JSON.stringify(after.find((r) => !r.removable)?.text),
);
say(
	"…and the added ones do not claim to be it",
	after.filter((r) => r.removable).every((r) => !/Claude Code's own login/.test(r.text)),
	JSON.stringify(after.filter((r) => r.removable).map((r) => r.text)),
);
/*
 * An account with no token behind it says so rather than being hidden: an account you added
 * and cannot use is a fact worth showing, and hiding it would leave the list disagreeing with
 * what you remember doing.
 */
rmSync(join(accountsDir, ids[0], ".credentials.json"), { force: true });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await openOverflow(page, /settings/i);
await page.waitForSelector(".settings", { timeout: 6000 });
await page.waitForTimeout(2000);
const signedOut = await page.evaluate(() =>
	[...document.querySelectorAll(".account-row")].map((row) => ({
		text: row.innerText.replace(/\n+/g, " | "),
		current: row.dataset.current === "true",
	})),
);
const gone = signedOut.find((row) => row.text.includes("one@example.com"));
say("a signed-out account says so", /signed out/.test(gone?.text ?? ""), JSON.stringify(gone?.text));
say("…and is not offered as the default for a new conversation", gone?.current === false, JSON.stringify(gone));

/*
 * And nothing this check did wrote a limit or an order back to the file. The fixture put both
 * there; the first write after that should have cleaned them out, which is what stops an
 * upgraded install carrying a stale "spent until" around forever.
 */
const cleaned = JSON.parse(readFileSync(indexFile, "utf8"));
say("the stored list keeps no order", cleaned.order === undefined, JSON.stringify(Object.keys(cleaned)));
say(
	"…and no remembered limit",
	(cleaned.accounts ?? []).every((account) => account.limitedUntil === undefined && account.limitType === undefined),
	JSON.stringify(cleaned.accounts),
);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();

// The accounts are the install's, and this check invented some — taken away again so the
// next check does not inherit a deck pointed at a fabricated account.
rmSync(accountsDir, { recursive: true, force: true });
