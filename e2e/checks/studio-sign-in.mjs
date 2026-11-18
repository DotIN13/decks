/**
 * The harness signs in to Decks Studio from its own Settings (`settings/StudioSignIn.tsx`,
 * `server/src/studio/login.ts`), the way Claude Code signs in, in a real browser, against a stand-in
 * for Studio.
 *
 * What is checked: Settings, Accounts has a Decks Studio login group that says Sign in, with
 * Studio's address in a field; pressed, it opens a tab on Studio, which shows a code and, since this
 * tab is on the harness's own machine, a button; Settings meanwhile says Studio is showing a code and
 * has a field to paste it into; the button brings the tab back and Settings says signed in and as
 * whom; the key is on disk; the harness reports its address; Sign out takes it back to Sign in; a
 * sign-in started from another device opens a page with no button, a wrong code pasted is refused
 * and the right one signs in; Cancel gives a sign-in up.
 * `LOOK_SHOTS=<dir>` keeps pictures of the states.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { API, asPerson, deckState, open, resetStage, say, settle } from "../harness.mjs";

const OUT = process.env.LOOK_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

// --- a stand-in for Studio: its connect page shows a signed-in person the code, and a button when it can send the tab back ---
const KEY = "dsk_abcdefghijklmnopqrstuvwxyz012345";
const grants = new Map();
const reported = [];
const studio = createServer((req, res) => {
	const url = new URL(req.url, "http://studio");
	const json = (status, value) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(value));
	};
	if (req.method === "GET" && url.pathname === "/connect") {
		const code = `ACDE-FGH${grants.size + 3}`;
		grants.set(code, url.searchParams.get("challenge"));
		const redirect = url.searchParams.get("redirect");
		let button = "";
		if (redirect) {
			const back = new URL(redirect);
			back.searchParams.set("code", code);
			back.searchParams.set("state", url.searchParams.get("state") ?? "");
			button = `<a id="go" href="${back.href.replace(/&/g, "&amp;")}">Sign it in</a>`;
		}
		return void res.writeHead(200, { "Content-Type": "text/html" }).end(`<h1>Sign this Decks in to Studio</h1>${button}<output id="code">${code}</output>`);
	}
	let text = "";
	req.on("data", (chunk) => (text += chunk));
	req.on("end", () => {
		const body = text ? JSON.parse(text) : {};
		if (url.pathname === "/api/connect/exchange") {
			const code = String(body.code ?? "").toUpperCase();
			const challenge = grants.get(code);
			if (!challenge || createHash("sha256").update(body.verifier ?? "").digest("base64url") !== challenge) return json(400, { error: "That code is wrong, has run out or was used already." });
			grants.delete(code);
			return json(201, { key: KEY, harness: { id: "h1", name: "This Mac" }, account: { name: "Ada", email: "ada@example.com" } });
		}
		if (url.pathname === "/sync/v1/addresses") {
			reported.push(body.urls);
			return json(200, {});
		}
		json(404, { error: "not this stand-in's" });
	});
});
await new Promise((done) => studio.listen(0, "127.0.0.1", done));
const at = `http://127.0.0.1:${studio.address().port}`;

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const file = join((await deckState()).path, ".decks", "studio.json");
const { browser, context, page, errors } = await open({ width: 1400, height: 900 });
await page.locator('[aria-label="Settings"]').first().click();
await page.locator(".settings .sw-nav button", { hasText: "Accounts" }).click();
await settle(page, 300);
const group = page.locator('.sw-group[data-group="studio"]');
const words = async () => (await group.innerText()).replace(/\s+/g, " ").trim();
const shot = async (name) => OUT && (await page.locator(".settings").screenshot({ path: join(OUT, `${name}.png`) }));

say("Accounts has a Decks Studio login group that offers to sign in, with Studio's address in a field", /Decks Studio login/.test(await words()) && /Sign in to Decks Studio/.test(await words()) && (await group.locator(".sw-studio-at").inputValue()).startsWith("https://"), await words());

await shot("1-sign-in");
// --- from this tab, on the harness's own machine: Studio shows the code, and its button brings it back ---
await group.locator(".sw-studio-at").fill(at);
const tabOpened = context.waitForEvent("page", { timeout: 8000 });
await group.locator('[data-studio="sign-in"]').click();
const tab = await tabOpened.catch(() => undefined);
const there = tab ? await until(async () => (/\/connect\?/.test(tab.url()) ? await tab.locator("#code").innerText() : undefined)) : undefined;
say("Sign in opens a tab on Studio, which shows a code", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(there ?? ""), `${tab?.url()} ${there}`);
const waiting = await until(async () => (/Studio is showing a code/.test(await words()) ? await words() : undefined));
say("Settings says Studio is showing a code, and has a field to paste it into", !!waiting && waiting.includes(new URL(at).host) && (await group.locator(".sw-studio-code").count()) === 1 && (await group.locator('[data-studio="paste"]').isDisabled()), await words());
await shot("2-waiting");
await tab?.locator("#go").click();
const landed = tab ? await until(async () => (/\/api\/studio\/callback/.test(tab.url()) ? await tab.locator("h1").innerText() : undefined)) : undefined;
say("Studio's button brings the tab back to the harness", landed === "Signed in to Decks Studio", `${tab?.url()} ${landed}`);
const signedIn = await until(async () => (/Signed in to Decks Studio as ada@example\.com/.test(await words()) ? await words() : undefined));
say("Settings says signed in, and as whom, with nothing typed anywhere", !!signedIn && (await group.locator(".sw-studio-code").count()) === 0, await words());
say("…the key is kept on the harness", existsSync(file) && JSON.parse(readFileSync(file, "utf8")).key === KEY && JSON.parse(readFileSync(file, "utf8")).url === at, existsSync(file) ? readFileSync(file, "utf8").replace(KEY, "dsk_…") : "no file");
const said = await until(async () => (reported.length ? reported.at(-1) : undefined));
say("…and the harness tells Studio where it can be reached, its own loopback address among them", Array.isArray(said) && said.some((one) => /^http:\/\/127\.0\.0\.1:\d+$/.test(one)), JSON.stringify(said));
await tab?.close().catch(() => {});
await shot("3-signed-in");

// --- signed out again -------------------------------------------------------------------------------
await group.locator('[data-studio="sign-out"]').click();
const out = await until(async () => (/Sign in to Decks Studio/.test(await words()) ? true : undefined));
say("Sign out takes it back to Sign in, and the key is gone", !!out && !existsSync(file), await words());

// --- from another device: no tab can come back, so the code is copied from Studio and pasted here ----
const away = await call("harness.studioSignIn", [{ studio: at, back: "https://mac.tail1.ts.net:8443" }]);
const far = new URL(away.value?.url ?? at);
const shown = await (await fetch(far)).text();
const code = /<output id="code">([^<]+)</.exec(shown)?.[1] ?? "";
say("a sign-in from another device opens Studio's page with a code and no button", away.ok === true && !far.searchParams.has("redirect") && !/id="go"/.test(shown) && code.length === 9, `${JSON.stringify(away).slice(0, 160)} | ${shown}`);
const field = group.locator(".sw-studio-code");
await until(async () => ((await field.count()) ? true : undefined));
await field.fill("AAAA-AAAA");
await group.locator('[data-studio="paste"]').click();
const refused = await until(async () => ((await page.locator("text=That code is wrong").count()) ? true : undefined), 5000);
say("a wrong code pasted is refused in Studio's words, and the field stays", !!refused && (await field.count()) === 1 && !existsSync(file), await words());
await field.fill(code.toLowerCase());
await shot("4-pasted");
await field.press("Enter");
const again = await until(async () => (/Signed in to Decks Studio as ada@example\.com/.test(await words()) ? true : undefined));
say("the code Studio showed, pasted, signs it in", !!again && existsSync(file), await words());
await call("harness.unpair", []);

// --- given up ---------------------------------------------------------------------------------------
await call("harness.studioSignIn", [{ studio: at, back: "https://mac.tail1.ts.net:8443" }]);
await until(async () => ((await field.count()) ? true : undefined));
await group.locator('[data-studio="cancel"]').click();
const back = await until(async () => (/Sign in to Decks Studio/.test(await words()) && (await field.count()) === 0 ? true : undefined));
say("Cancel gives the sign-in up", !!back && !existsSync(file), await words());

// --- Connections keeps what connects another Decks to this one, and nothing of Studio's login -------
await page.locator(".settings .sw-nav button", { hasText: "Connections" }).click();
await settle(page, 300);
const labels = await page.locator(".settings .sw-body .sw-label").allInnerTexts();
const pane = (await page.locator(".settings .sw-body").innerText()).replace(/\s+/g, " ");
say("Connections has the Decks connection, its address and pairing code, and no Studio login", JSON.stringify(labels) === JSON.stringify(["Decks connection", "Connected to this Decks"]) && /Pairing code/.test(pane) && /its login is under Accounts/.test(pane) && (await page.locator('.sw-group[data-group="studio"]').count()) === 0, `${JSON.stringify(labels)} | ${pane.slice(0, 200)}`);
await shot("5-connections");

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
studio.close();
