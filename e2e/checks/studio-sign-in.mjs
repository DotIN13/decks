/**
 * The harness signs in to Decks Studio from its own Settings (`settings/StudioSignIn.tsx`,
 * `server/src/studio/login.ts`), in a real browser, against a stand-in for Studio.
 *
 * What is checked: Settings, Connections has a Decks Studio group that says Sign in, with Studio's
 * address in a field; pressed from this tab, which is on the harness's own machine, it opens a tab on
 * Studio that comes straight back, and Settings then says signed in and as whom, with no code and no
 * address typed anywhere; the key is on disk; the page that loaded told the harness nothing to report
 * but its own address; Sign out takes it back to Sign in; a sign-in started from another device
 * shows a short code and where to type it, and once it is typed there Settings says signed in.
 * `LOOK_SHOTS=<dir>` keeps pictures of the three states.
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

// --- a stand-in for Studio: its connect address sends a signed-in person's tab straight back -------
const KEY = "dsk_abcdefghijklmnopqrstuvwxyz012345";
const grants = new Map();
const devices = new Map();
const reported = [];
const studio = createServer((req, res) => {
	const url = new URL(req.url, "http://studio");
	const json = (status, value) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(value));
	};
	if (req.method === "GET" && url.pathname === "/connect") {
		const redirect = url.searchParams.get("redirect");
		if (!redirect) return void res.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Type the code your Decks shows</h1>");
		const code = `code-${grants.size + 1}`;
		grants.set(code, url.searchParams.get("challenge"));
		const back = new URL(redirect);
		back.searchParams.set("code", code);
		back.searchParams.set("state", url.searchParams.get("state") ?? "");
		return void res.writeHead(302, { Location: back.href }).end();
	}
	let text = "";
	req.on("data", (chunk) => (text += chunk));
	req.on("end", () => {
		const body = text ? JSON.parse(text) : {};
		const proves = (challenge) => !!challenge && createHash("sha256").update(body.verifier ?? "").digest("base64url") === challenge;
		const signedIn = { key: KEY, harness: { id: "h1", name: "This Mac" }, account: { name: "Ada", email: "ada@example.com" } };
		if (url.pathname === "/api/connect/device") {
			const device = `dev-${devices.size + 1}`;
			devices.set(device, { challenge: body.challenge, typed: false });
			return json(200, { device, code: "ACDE-FGHJ", verify: `${at}/connect`, expires: 600, interval: 0.25 });
		}
		if (url.pathname === "/api/connect/exchange") {
			if (body.code) {
				const challenge = grants.get(body.code);
				grants.delete(body.code);
				return proves(challenge) ? json(201, signedIn) : json(400, { error: "This sign-in has run out or was used already." });
			}
			const one = devices.get(body.device);
			if (!one || !proves(one.challenge)) return json(400, { error: "This sign-in has run out or was used already." });
			return one.typed ? (devices.delete(body.device), json(201, signedIn)) : json(202, { waiting: true });
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
await page.locator(".settings .sw-nav button", { hasText: "Connections" }).click();
await settle(page, 300);
const group = page.locator('.sw-group[data-group="studio"]');
const words = async () => (await group.innerText()).replace(/\s+/g, " ").trim();
const shot = async (name) => OUT && (await page.locator(".settings").screenshot({ path: join(OUT, `${name}.png`) }));

say("Connections has a Decks Studio group that offers to sign in, with Studio's address in a field", /Sign in to Decks Studio/.test(await words()) && (await group.locator(".sw-studio-at").inputValue()).startsWith("https://"), await words());

await shot("1-sign-in");
// --- from this tab, on the harness's own machine: one press, a tab that comes straight back ---------
await group.locator(".sw-studio-at").fill(at);
const tabOpened = context.waitForEvent("page", { timeout: 8000 });
await group.locator('[data-studio="sign-in"]').click();
const tab = await tabOpened.catch(() => undefined);
const landed = tab ? await until(async () => (/\/api\/studio\/callback/.test(tab.url()) ? await tab.locator("h1").innerText() : undefined)) : undefined;
say("Sign in opens a tab on Studio, which comes straight back to the harness", landed === "Signed in to Decks Studio", `${tab?.url()} ${landed}`);
const signedIn = await until(async () => (/Signed in to Decks Studio as ada@example\.com/.test(await words()) ? await words() : undefined));
say("Settings says signed in, and as whom, with nothing typed anywhere", !!signedIn && (await group.locator(".sw-studio-code").count()) === 0, await words());
say("…the key is kept on the harness", existsSync(file) && JSON.parse(readFileSync(file, "utf8")).key === KEY && JSON.parse(readFileSync(file, "utf8")).url === at, existsSync(file) ? readFileSync(file, "utf8").replace(KEY, "dsk_…") : "no file");
const said = await until(async () => (reported.length ? reported.at(-1) : undefined));
say("…and the harness tells Studio where it can be reached, its own loopback address among them", Array.isArray(said) && said.some((one) => /^http:\/\/127\.0\.0\.1:\d+$/.test(one)), JSON.stringify(said));
await tab?.close().catch(() => {});
await shot("2-signed-in");

// --- signed out again -------------------------------------------------------------------------------
await group.locator('[data-studio="sign-out"]').click();
const out = await until(async () => (/Sign in to Decks Studio/.test(await words()) ? true : undefined));
say("Sign out takes it back to Sign in, and the key is gone", !!out && !existsSync(file), await words());

// --- from another device: a short code, typed on Studio ---------------------------------------------
const away = await call("harness.studioSignIn", [{ studio: at, back: "https://mac.tail1.ts.net:8443" }]);
const shown = await until(async () => ((await group.locator(".sw-studio-code").count()) ? await words() : undefined));
say("a sign-in from another device shows a short code, and where to type it", away.ok === true && /ACDE-FGHJ/.test(shown ?? "") && shown.includes(`${new URL(at).host}/connect`), `${JSON.stringify(away).slice(0, 120)} | ${shown}`);
await shot("3-code");
const box = await group.locator(".sw-studio-code").boundingBox();
say("…the code large enough to read across a desk", !!box && box.height >= 20, JSON.stringify(box));
for (const one of devices.values()) one.typed = true;
const again = await until(async () => (/Signed in to Decks Studio as ada@example\.com/.test(await words()) ? true : undefined));
say("once it is typed on Studio, Settings says signed in", !!again && existsSync(file), await words());
await call("harness.unpair", []);

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
studio.close();
