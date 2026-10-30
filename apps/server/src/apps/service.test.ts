import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express from "express";
import { appRequest } from "./route.ts";
import { Apps, outsideListeners, secretEnv } from "./service.ts";
import { writeStarter } from "./starters.ts";

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const closed = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

/** A deck with an `apps/` folder, a Decks-shaped server in front of it, and a way to ask it things. */
async function withDeck(run: (t: { deck: string; apps: Apps; get: (path: string, init?: RequestInit) => Promise<Response> }) => Promise<void>) {
	const deck = mkdtempSync(join(tmpdir(), "apps-"));
	const apps = new Apps(deck);
	const app = express();
	app.use((req, res, next) => {
		if (!appRequest(req, res, apps)) next();
	});
	const server = createServer(app);
	const port = await listen(server);
	try {
		await run({ deck, apps, get: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual", ...init }) });
	} finally {
		apps.dispose();
		await closed(server);
		rmSync(deck, { recursive: true, force: true });
	}
}

test("a static app is its folder's files, at its own address, and nothing outside it", async () => {
	await withDeck(async ({ deck, apps, get }) => {
		writeStarter(join(deck, "apps", "counter"), "static", "Counter");
		writeFileSync(join(deck, "apps", "counter", ".env"), "SECRET=1");
		assert.equal(apps.state("counter").status, "running", "a static app is ready as soon as it exists");
		assert.equal((await get("/app/counter")).status, 301, "the bare name gets its slash");
		const page = await get("/app/counter/");
		assert.equal(page.status, 200);
		assert.match(await page.text(), /<h1>Counter<\/h1>/);
		assert.match((await get("/app/counter/app.js")).headers.get("content-type") ?? "", /javascript/);
		assert.equal((await get("/app/counter/..%2F..%2Fetc%2Fpasswd")).status, 404, "a path out of the folder is refused");
		assert.equal((await get("/app/counter/.env")).status, 404, "and so is a dotfile");
		assert.equal((await get("/app/counter/missing.js")).status, 404, "a missing file is a 404");
		assert.match(await (await get("/app/counter/trips/3")).text(), /<h1>Counter/, "a one-page app's own route gets its page");
		assert.equal((await get("/app/nobody/")).status, 404);
		assert.deepEqual(apps.list().map((one) => one.name), ["counter"]);
		const was = apps.state("counter").version ?? 0;
		await new Promise((resolve) => setTimeout(resolve, 20));
		writeFileSync(join(deck, "apps", "counter", "app.js"), "// edited");
		assert.ok((apps.state("counter").version ?? 0) > was, "an edited file is a new version, which the board reloads for");
	});
});

test("a server app starts on its first request, answers through Decks, stops, and wakes again", async () => {
	await withDeck(async ({ deck, apps, get }) => {
		writeStarter(join(deck, "apps", "keep"), "node", "Keep");
		assert.equal(apps.state("keep").status, "stopped");
		const page = await get("/app/keep/");
		assert.equal(page.status, 200, "the request that found it stopped started it");
		assert.match(await page.text(), /<h1>Keep<\/h1>/);
		assert.equal(apps.state("keep").status, "running");
		const port = apps.state("keep").port;
		assert.ok(port && port > 0);
		const added = await get("/app/keep/api/items", { method: "POST", body: JSON.stringify({ text: "Kyoto" }) });
		assert.equal(added.status, 201, "the server sees the path inside the app");
		assert.deepEqual(((await (await get("/app/keep/api/items")).json()) as Array<{ text: string }>).map((one) => one.text), ["Kyoto"]);
		assert.equal(apps.stop("keep"), true);
		assert.equal(apps.state("keep").status, "stopped");
		assert.deepEqual(((await (await get("/app/keep/api/items")).json()) as Array<{ text: string }>).map((one) => one.text), ["Kyoto"], "stopped, the next request starts it again, and what it saved is still there");
		assert.ok(apps.log("keep").some((line) => /listening on/.test(line)), "what it printed is in its log");
	});
});

test("an app nobody has seen for its idle minutes is put to sleep, and is woken by a request", async () => {
	await withDeck(async ({ deck, apps, get }) => {
		writeStarter(join(deck, "apps", "nap"), "node", "Nap");
		assert.equal((await apps.run("nap")).ok, true);
		(apps as unknown as { states: Map<string, { seenAt?: number }> }).states.get("nap")!.seenAt = Date.now() - 11 * 60_000;
		(apps as unknown as { sleepUnseen(): void }).sleepUnseen();
		assert.equal(apps.state("nap").status, "asleep");
		assert.equal((await get("/app/nap/")).status, 200);
		assert.equal(apps.state("nap").status, "running");
	});
});

test("a server that exits, or never listens, is broken, and says why", async () => {
	await withDeck(async ({ deck, apps, get }) => {
		mkdirSync(join(deck, "apps", "crash"), { recursive: true });
		writeFileSync(join(deck, "apps", "crash", "app.json"), JSON.stringify({ kind: "server", start: "node -e \"console.error('Error: no database'); process.exit(3)\"" }));
		const outcome = await apps.run("crash");
		assert.equal(outcome.ok, false);
		assert.equal(outcome.status, "broken");
		assert.ok(outcome.errors.some((line) => /no database/.test(line)), "the error lines come back to the agent");
		const page = await get("/app/crash/");
		assert.equal(page.status, 503);
		assert.match(await page.text(), /broken/);
	});
});

test("a build app is served from what its build wrote, and a failed build is broken", async () => {
	await withDeck(async ({ deck, apps, get }) => {
		const folder = join(deck, "apps", "made");
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, "app.json"), JSON.stringify({ kind: "build", build: "mkdir -p dist && echo '<h1>Built</h1>' > dist/index.html" }));
		assert.equal(apps.state("made").status, "stopped", "never built");
		assert.equal((await get("/app/made/")).status, 404);
		const built = await apps.build("made");
		assert.equal(built.ok, true);
		assert.equal(apps.state("made").status, "running");
		assert.match(await (await get("/app/made/")).text(), /Built/);
		writeFileSync(join(folder, "app.json"), JSON.stringify({ kind: "build", build: "echo 'error TS2304: nope' && exit 2" }));
		const failed = await apps.build("made");
		assert.equal(failed.ok, false);
		assert.ok(failed.errors.some((line) => /TS2304/.test(line)));
	});
});

test("an app told its base path sees the whole path, and its bare address is not redirected", async () => {
	await withDeck(async ({ deck, apps, get }) => {
		const folder = join(deck, "apps", "based");
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, "server.mjs"), `import { createServer } from "node:http";
createServer((req, res) => res.end(JSON.stringify({ path: req.url, base: process.env.BASE_PATH }))).listen(Number(process.env.PORT), "127.0.0.1");
`);
		writeFileSync(join(folder, "app.json"), JSON.stringify({ kind: "server", start: "node server.mjs", prefix: true }));
		const bare = await get("/app/based");
		assert.equal(bare.status, 200, "Next.js answers its bare base path; a redirect here went round forever");
		assert.deepEqual(await bare.json(), { path: "/app/based", base: "/app/based" });
		assert.deepEqual(await (await get("/app/based/api?x=1")).json(), { path: "/app/based/api?x=1", base: "/app/based" });
	});
});

test("names are checked, and a starter will not write over an app", () => {
	const deck = mkdtempSync(join(tmpdir(), "apps-"));
	const apps = new Apps(deck);
	try {
		assert.throws(() => apps.folder("../x"), /lower-case/);
		assert.throws(() => apps.folder("Trip Planner"), /lower-case/);
		writeStarter(join(deck, "apps", "one"), "static", "One");
		assert.throws(() => writeStarter(join(deck, "apps", "one"), "node", "One"), /already has files/);
	} finally {
		apps.dispose();
		rmSync(deck, { recursive: true, force: true });
	}
});

test("a server app is told where Decks is, its own app pass, and where the SDK is; the pass ends with that run", async () => {
	const { Passes } = await import("../auth/passes.ts");
	await withDeck(async ({ deck, apps, get }) => {
		const passes = new Passes({ live: () => false, role: () => undefined, appRun: (name) => apps.runOf(name) });
		apps.decksPort = 4999;
		apps.passes = passes;
		const folder = join(deck, "apps", "teller");
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, "app.json"), JSON.stringify({ kind: "server", start: "node server.js" }));
		writeFileSync(
			join(folder, "server.js"),
			`require("node:http").createServer((q, s) => s.end(JSON.stringify({ url: process.env.DECKS_URL, agent: process.env.DECKS_AGENT ?? null, app: process.env.DECKS_APP, token: process.env.DECKS_TOKEN, sdk: process.env.DECKS_SDK }))).listen(process.env.PORT, "127.0.0.1");`,
		);
		const seen = (await (await get("/app/teller/")).json()) as { url: string; agent: string | null; app: string; token: string; sdk: string };
		assert.equal(seen.url, "http://127.0.0.1:4999");
		assert.equal(seen.app, "teller");
		assert.equal(seen.agent, null, "an app never calls as the agent whose shell started Decks");
		assert.match(seen.token, /^dk_ap_/);
		assert.deepEqual(passes.openApp(seen.token), { app: "teller", holder: "server" }, "its pass is the app's");
		assert.ok(existsSync(seen.sdk) && seen.sdk.endsWith("packages/sdk/src/index.js"), "and where the SDK is, to import");
		apps.stop("teller");
		assert.equal(passes.openApp(seen.token), undefined, "stopped, its pass ends");
		// Started again, it is a new run, with a new pass; the old one stays ended.
		const again = (await (await get("/app/teller/")).json()) as { token: string };
		assert.notEqual(again.token, seen.token);
		assert.ok(passes.openApp(again.token));
		assert.equal(passes.openApp(seen.token), undefined);
		apps.stop("teller");
	});
});

test("an app's commands are not handed the person's secrets", async () => {
	const saved = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, DECKS_STUDIO_KEY: process.env.DECKS_STUDIO_KEY, MY_SERVICE_TOKEN: process.env.MY_SERVICE_TOKEN };
	Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-a", DECKS_STUDIO_KEY: "dsk_x", MY_SERVICE_TOKEN: "t" });
	try {
		await withDeck(async ({ deck, get }) => {
			const folder = join(deck, "apps", "peek");
			mkdirSync(folder, { recursive: true });
			writeFileSync(join(folder, "app.json"), JSON.stringify({ kind: "server", start: "node server.js" }));
			writeFileSync(join(folder, "server.js"), `require("node:http").createServer((q, s) => s.end(JSON.stringify(Object.keys(process.env)))).listen(process.env.PORT, "127.0.0.1");`);
			const names = (await (await get("/app/peek/")).json()) as string[];
			for (const name of ["ANTHROPIC_API_KEY", "DECKS_STUDIO_KEY", "MY_SERVICE_TOKEN"]) assert.ok(!names.includes(name), name);
			assert.ok(names.includes("PATH") && names.includes("DECKS_APP"));
		});
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
	for (const name of ["OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "AWS_SECRET_ACCESS_KEY", "GH_TOKEN", "GITHUB_TOKEN", "GOOGLE_API_KEY", "GEMINI_API_KEY", "DB_PASSWORD", "STRIPE_SECRET", "X_API_KEY"]) assert.ok(secretEnv(name), name);
	for (const name of ["PATH", "HOME", "DECKS_REQUIRE_PAIR_CODE", "NODE_ENV", "TOKEN_LIST"]) assert.ok(!secretEnv(name), name);
});

test("lsof's listeners beyond loopback are named, and loopback ones are not", () => {
	const lines = [
		"COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME",
		"node 1 me 20u IPv4 0x1 0t0 TCP 127.0.0.1:5100 (LISTEN)",
		"node 1 me 21u IPv6 0x2 0t0 TCP [::1]:5100 (LISTEN)",
		"node 1 me 22u IPv4 0x3 0t0 TCP *:5101 (LISTEN)",
		"node 1 me 23u IPv6 0x4 0t0 TCP *:5101 (LISTEN)",
		"node 1 me 24u IPv4 0x5 0t0 TCP 192.168.1.4:5102 (LISTEN)",
		"node 1 me 25u IPv6 0x6 0t0 TCP [::]:5103 (LISTEN)",
	].join("\n");
	assert.deepEqual(outsideListeners(lines), ["*:5101", "192.168.1.4:5102", "[::]:5103"]);
	assert.deepEqual(outsideListeners(""), []);
});

test("a server app that listens beyond this Mac is marked unguarded", async () => {
	await withDeck(async ({ deck, apps, get }) => {
		for (const [name, host] of [["open", "0.0.0.0"], ["shut", "127.0.0.1"]] as const) {
			const folder = join(deck, "apps", name);
			mkdirSync(folder, { recursive: true });
			writeFileSync(join(folder, "app.json"), JSON.stringify({ kind: "server", start: "node server.js" }));
			writeFileSync(join(folder, "server.js"), `require("node:http").createServer((q, s) => s.end("ok")).listen(process.env.PORT, ${JSON.stringify(host)});`);
			assert.equal((await get(`/app/${name}/`)).status, 200);
		}
		const end = Date.now() + 5000;
		while (!apps.state("open").warning && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
		assert.match(apps.state("open").warning ?? "", /^Unguarded: listens on \S+:\d+, not only this Mac$/);
		assert.equal(apps.state("shut").warning, undefined);
		apps.stop("open");
		assert.equal(apps.state("open").warning, undefined);
	});
});
