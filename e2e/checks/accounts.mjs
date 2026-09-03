/**
 * Several Claude subscriptions, and which one is spending (DESIGN §6.8).
 *
 * A subscription has a rate limit, and reaching it stops the work — so several can be signed
 * in at once, one is active, and reaching a limit moves the active one along
 * (`claude/accounts.ts`). The switch is seamless: the CLI re-reads its credentials per
 * request and every session is pointed at a symlink, so moving that link changes which
 * subscription the *next turn* spends.
 *
 * The login itself is an OAuth flow that cannot be automated, so what is driven here is
 * everything around it — the list, the states a row can be in, and that reading the list
 * changes nothing. The switching rules themselves are unit-tested in `accounts.test.ts`,
 * where a limit can be staged without a real account to spend.
 *
 * Accounts are stored per *install* rather than per deck, so this writes under the fixture's
 * data directory and takes it away again.
 */
import { deckState, hasOverflowRow, open, openOverflow, say, settle } from "../harness.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
		disabled: row.querySelector("button")?.disabled ?? null,
	})),
);
console.log("      rows:", JSON.stringify(rows, null, 1));
say("the CLI's own login is on the list", rows.length >= 1);
say("…and is the active one on a fresh install", rows[0]?.current === true);
say("…named from the CLI rather than as a uuid", /@/.test(rows[0]?.text ?? ""), rows[0]?.text);
say("…and cannot be removed from here", rows[0]?.removable === false, "those credentials are the CLI's");
say("the active row is not clickable, being already in use", rows[0]?.disabled === true);

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

// --- a second account, and a limit, seen through the server ----------------------
/*
 * The login is an OAuth flow that cannot be automated, so the accounts are written the way
 * the store writes them and the *server* is what reads them. Which is the honest test: what
 * is being checked is that the list, the active row and the limit reach the browser.
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
		/*
		 * The limit is put on `default`, which is the only row with a real token behind it —
		 * `auth status` is what decides `signedIn`, and a fabricated credentials file cannot
		 * pass it. So the two added rows exercise "signed out" and the CLI's own exercises
		 * "limited", which between them is every state a row can be in.
		 */
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
say("…marking the account in force", after.filter((r) => r.current).length === 1 && after.find((r) => r.current)?.text.includes("two@example.com"), JSON.stringify(after.find((r) => r.current)?.text));
say("…and showing when a spent one comes back", after.some((r) => /limited . back/.test(r.text)), JSON.stringify(after.find((r) => /limited/.test(r.text))?.text));
/*
 * One status per row, ranked. The first draft drew each condition independently and produced
 * "active · signed out" — two claims that cannot both be acted on.
 */
say(
	"…and never two contradictory states on one row",
	after.every((r) => !(/signed out/.test(r.text) && /\bactive\b/.test(r.text) && !/active . limited/.test(r.text))),
	JSON.stringify(after.map((r) => r.text)),
);
say("…with the added ones removable and the CLI's own not", after.filter((r) => r.removable).length === 2);
/*
 * An account with no token behind it says so rather than being hidden, and cannot be
 * switched to — that is what stops a rate limit turning into an auth failure.
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
		disabled: row.querySelector("button")?.disabled ?? null,
	})),
);
const gone = signedOut.find((row) => row.text.includes("one@example.com"));
say("a signed-out account says so", /signed out/.test(gone?.text ?? ""), JSON.stringify(gone?.text));
say("…and cannot be switched to", gone?.disabled === true);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();

// The accounts are the install's, and this check invented some — taken away again so the
// next check does not inherit a deck pointed at a fabricated account.
rmSync(accountsDir, { recursive: true, force: true });
