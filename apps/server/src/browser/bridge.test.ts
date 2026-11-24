import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { WebStatus } from "@decks/protocol";
import { WebSocket } from "ws";
import { WebBridge } from "./bridge.ts";

/**
 * The shared browser, end to end, with a **fake extension** in front of a real Chromium.
 *
 * The Decks extension is five commands around `chrome.debugger`; this fake answers the
 * same five against a headless Chromium's own DevTools socket, so everything from the
 * pairing check through the relay to Playwright's `fill` runs exactly as it does with the
 * user's Chrome — only the last hop, `chrome.debugger` itself, is stood in for. That hop was
 * covered by a browser check (`web-bridge.mjs`, since cut from the suite) with the real extension; that
 * check has been cut, so the real `chrome.debugger` hop is tested nowhere.
 */

/*
 * The form is the shape of a real one, not a demo: two fields sharing a label, a textarea
 * with no label at all, and a radio the page hides and paints over — the three things that
 * defeat naming, and the reason `read` hands back references.
 */
const FORM = `data:text/html,${encodeURIComponent(`<!doctype html><title>Sign up</title>
<style>.hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);}</style>
<form onsubmit="event.preventDefault(); document.title = 'Submitted ' + document.getElementById('email').value">
<label for="email">Email</label><input id="email" name="email">
<label for="country">Country</label><select id="country"><option>Chile</option><option>Iceland</option></select>
<label for="degree1">Degree</label><input id="degree1"><label for="degree2">Degree</label><input id="degree2">
<p>Why this study</p><textarea id="purpose"></textarea>
<span class="hidden"><input type="radio" id="agree" name="agree"></span><span onclick="document.getElementById('agree').click()">I agree</span>
<button type="submit">Create account</button></form>`)}`;
const OTHER = `data:text/html,${encodeURIComponent("<!doctype html><title>Somewhere else</title><button>Back</button>")}`;

let chrome: ChildProcess;
let profile: string;
let browserWs: WebSocket;
let dataDir: string;
let http: Server;
let port: number;
let bridge: WebBridge;
const statuses: WebStatus[] = [];

/** A raw DevTools connection: numbered commands, and every event to whoever listens. */
class Devtools {
	private id = 0;
	private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	readonly listeners = new Set<(message: { sessionId?: string; method: string; params: unknown }) => void>();
	constructor(private readonly ws: WebSocket) {
		ws.on("message", (data) => {
			const message = JSON.parse(data.toString());
			if (message.id && this.waiting.has(message.id)) {
				const { resolve, reject } = this.waiting.get(message.id)!;
				this.waiting.delete(message.id);
				if (message.error) reject(new Error(message.error.message));
				else resolve(message.result);
				return;
			}
			if (message.method) for (const listener of this.listeners) listener(message);
		});
	}
	send(method: string, params?: unknown, sessionId?: string): Promise<unknown> {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
	}
}

async function launchChromium(): Promise<{ devtools: Devtools; targetId: string }> {
	const playwright = await import("playwright");
	const executable = playwright.chromium.executablePath();
	profile = mkdtempSync(join(tmpdir(), "decks-web-test-"));
	chrome = spawn(executable, ["--headless=new", "--no-sandbox", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
	const file = join(profile, "DevToolsActivePort");
	const deadline = Date.now() + 20_000;
	while (!existsSync(file) || readFileSync(file, "utf8").split("\n").length < 2) {
		if (Date.now() > deadline) throw new Error("Chromium did not write DevToolsActivePort");
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const [devPort, path] = readFileSync(file, "utf8").split("\n");
	browserWs = new WebSocket(`ws://127.0.0.1:${devPort}${path}`);
	await new Promise<void>((resolve, reject) => {
		browserWs.once("open", () => resolve());
		browserWs.once("error", reject);
	});
	const devtools = new Devtools(browserWs);
	// Learn the session id the fake hands the relay, by watching the browser socket.
	devtools.listeners.add((message) => {
		if (message.method === "Target.attachedToTarget" && !message.sessionId) {
			const params = message.params as { sessionId: string; targetInfo: { targetId: string } };
			if (params.targetInfo.targetId === targetId) sessionOfFirstTab = params.sessionId;
		}
	});
	const { targetInfos } = (await devtools.send("Target.getTargets")) as { targetInfos: Array<{ targetId: string; type: string }> };
	const page = targetInfos.find((target) => target.type === "page");
	assert.ok(page, "a page target");
	return { devtools, targetId: page.targetId };
}

/**
 * The fake extension: the five commands, answered with DevTools calls.
 *
 * Tab ids are minted here; a tab's own events arrive on its session and go up as
 * `chrome.debugger.onEvent [{ tabId }, …]`, a worker's on its own child session and go up
 * with that session id, which is how the real `chrome.debugger` reports them too.
 */
async function fakeExtension(devtools: Devtools, targetId: string, code: string): Promise<WebSocket> {
	const ws = new WebSocket(`ws://127.0.0.1:${port}/api/web/relay?code=${encodeURIComponent(code)}`);
	await new Promise<void>((resolve, reject) => {
		ws.once("open", () => resolve());
		ws.once("error", reject);
		ws.once("unexpected-response", (_req, res) => reject(new Error(`refused: ${res.statusCode}`)));
	});
	const tabs = new Map<number, { targetId: string; sessionId?: string }>();
	const children = new Map<string, number>();
	let nextTab = 1;
	const tabId = nextTab++;
	tabs.set(tabId, { targetId });
	const tabOf = (id: number) => {
		const tab = tabs.get(id);
		if (!tab) throw new Error(`no tab ${id}`);
		return tab;
	};
	const send = (message: unknown) => ws.send(JSON.stringify(message));

	devtools.listeners.add((message) => {
		if (!message.sessionId) return;
		for (const [id, tab] of tabs) {
			if (tab.sessionId === message.sessionId) {
				const child = (message.params as { sessionId?: string } | undefined)?.sessionId;
				if (message.method === "Target.attachedToTarget" && child) children.set(child, id);
				send({ method: "chrome.debugger.onEvent", params: [{ tabId: id }, message.method, message.params] });
				return;
			}
		}
		const owner = children.get(message.sessionId);
		if (owner !== undefined) send({ method: "chrome.debugger.onEvent", params: [{ tabId: owner, sessionId: message.sessionId }, message.method, message.params] });
	});

	ws.on("message", async (data) => {
		const message = JSON.parse(data.toString()) as { id: number; method: string; params: unknown[] };
		const reply = async (): Promise<unknown> => {
			const [first, second, third] = message.params ?? [];
			switch (message.method) {
				case "decks.ping":
					return {};
				case "chrome.debugger.attach": {
					const tab = tabOf((first as { tabId: number }).tabId);
					const { sessionId } = (await devtools.send("Target.attachToTarget", { targetId: tab.targetId, flatten: true })) as { sessionId: string };
					tab.sessionId = sessionId;
					return {};
				}
				case "chrome.debugger.detach": {
					const tab = tabOf((first as { tabId: number }).tabId);
					if (tab.sessionId) await devtools.send("Target.detachFromTarget", { sessionId: tab.sessionId });
					tab.sessionId = undefined;
					return {};
				}
				case "chrome.debugger.sendCommand": {
					const target = first as { tabId: number; sessionId?: string };
					const tab = tabOf(target.tabId);
					return devtools.send(second as string, third, target.sessionId ?? tab.sessionId);
				}
				case "chrome.tabs.create": {
					const { targetId: created } = (await devtools.send("Target.createTarget", { url: (first as { url?: string }).url ?? "about:blank" })) as { targetId: string };
					const id = nextTab++;
					tabs.set(id, { targetId: created });
					return { id, index: id, windowId: 1, active: true, pinned: false, url: (first as { url?: string }).url };
				}
				case "chrome.tabs.remove": {
					for (const id of ([] as number[]).concat(first as number | number[])) {
						const tab = tabs.get(id);
						if (tab) await devtools.send("Target.closeTarget", { targetId: tab.targetId });
						tabs.delete(id);
						// What Chrome tells the extension when a tab it is attached to goes away.
						send({ method: "chrome.debugger.onDetach", params: [{ tabId: id }, "target_closed"] });
						send({ method: "chrome.tabs.onRemoved", params: [id, { windowId: 1, isWindowClosing: false }] });
					}
					return {};
				}
			}
			throw new Error(`Unknown method: ${message.method}`);
		};
		try {
			send({ id: message.id, result: await reply() });
		} catch (error) {
			send({ id: message.id, error: (error as Error).message });
		}
	});

	send({ method: "chrome.tabs.onCreated", params: [{ id: tabId, index: 0, windowId: 1, active: true, pinned: false, url: "about:blank", title: "" }] });
	send({ method: "extension.initialized", params: [] });
	return ws;
}

async function until(what: string, check: () => boolean, ms = 15_000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

let devtools: Devtools;
let targetId: string;
let extension: WebSocket;

before(async () => {
	({ devtools, targetId } = await launchChromium());
	dataDir = mkdtempSync(join(tmpdir(), "decks-web-data-"));
	bridge = new WebBridge(dataDir, (status) => statuses.push(status));
	http = createServer((_req, res) => {
		res.statusCode = 404;
		res.end();
	});
	http.on("upgrade", (request, socket, head) => {
		if (new URL(request.url ?? "/", "http://x").pathname === "/api/web/relay") bridge.handleUpgrade(request, socket, head);
		else socket.destroy();
	});
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
	port = (http.address() as { port: number }).port;
});

after(async () => {
	bridge.dispose();
	http.close();
	browserWs?.close();
	// Chrome's helper processes keep writing into the profile for a moment after the main one is
	// killed, so wait for it to go and let the delete retry: removing it at once failed about two
	// runs in five with ENOTEMPTY, after every check had passed.
	if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
		const gone = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
		chrome.kill("SIGKILL");
		await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 3000))]);
	}
	rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
	rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test("the pairing code is minted once, kept on disk, and a wrong one is refused at the upgrade", async () => {
	const code = bridge.code();
	assert.equal(bridge.code(), code);
	assert.ok(existsSync(join(dataDir, "web-bridge.json")));
	assert.equal(bridge.status().paired, true);
	assert.equal(bridge.status().connected, false);

	const wrong = new WebSocket(`ws://127.0.0.1:${port}/api/web/relay?code=nope`);
	const outcome = await new Promise<string>((resolve) => {
		wrong.once("unexpected-response", (_req, res) => resolve(`http ${res.statusCode}`));
		wrong.once("error", (error) => resolve(error.message));
		wrong.once("open", () => resolve("open"));
	});
	assert.match(outcome, /403/);
});

test("nothing shared: every action says so in a sentence, not a stack trace", async () => {
	await assert.rejects(bridge.read(), /not connected|share a tab/i);
});

test("the extension connects and the shared tab becomes a page Playwright can read", async () => {
	extension = await fakeExtension(devtools, targetId, bridge.code());
	await until("connected", () => bridge.status().connected);
	assert.equal(bridge.status().tabs.length, 1);

	const opened = await bridge.open(FORM);
	assert.equal(opened.title, "Sign up");
	const page = await bridge.read();
	assert.equal(page.title, "Sign up");
	assert.match(page.snapshot, /textbox "Email"/);
	assert.match(page.snapshot, /button "Create account"/);
	// The status card follows the tab's own title and address.
	await until("the card to follow the title", () => bridge.status().tab?.title === "Sign up");
	assert.match(bridge.status().tab?.url ?? "", /^data:text\/html/);
});

test("a screenshot is a PNG of the tab, saved to a file and handed back with its size", async () => {
	const shot = await bridge.screenshot();
	assert.ok(existsSync(shot.file), "saved under the data directory");
	assert.equal(shot.png.subarray(1, 4).toString(), "PNG");
	assert.ok(shot.width > 100 && shot.height > 100, `${shot.width}×${shot.height}`);
	assert.match(bridge.status().actions.at(-1)?.text ?? "", /took a screenshot/);
});

test("fill, select and click find things by their names, and every action is noted for the card", async () => {
	await bridge.fill("Email", "ada@example.org");
	await bridge.select("Country", "Iceland");
	const value = (await devtools.send("Runtime.evaluate", { expression: "document.getElementById('email').value + '|' + document.getElementById('country').value", returnByValue: true }, tabSession())) as {
		result: { value: string };
	};
	assert.equal(value.result.value, "ada@example.org|Iceland");
	await assert.rejects(bridge.fill("Telephone", "1"), /Nothing on the page is called "Telephone"/);
	const texts = bridge.status().actions.map((action) => action.text);
	assert.deepEqual(texts.slice(-3), ["filled Email", "chose Iceland for Country", 'could not fill Telephone: Nothing on the page is called "Telephone". Read the page (decks.web.read) to see the names it uses.']);
	assert.equal(bridge.status().actions.at(-1)?.ok, false);
});

test("read gives every element a reference, and a field with no label is reachable by it", async () => {
	const page = await bridge.read();
	assert.match(page.snapshot, /textbox "Email".*\[ref=e\d+\]/);
	const unnamed = page.snapshot.split("\n").find((line) => /- textbox \[ref=e\d+\]/.test(line));
	assert.ok(unnamed, `an unnamed textbox, in:\n${page.snapshot}`);
	const ref = unnamed.match(/\[ref=(e\d+)\]/)?.[1] ?? "";
	assert.match(ref, /^e\d+$/);

	await bridge.fill({ ref }, "Because the question has no label.");
	assert.equal(await value("document.getElementById('purpose').value"), "Because the question has no label.");
	assert.equal(bridge.status().actions.at(-1)?.text, `filled ${ref}`);
});

test("a name that matches two fields is refused, and a position picks one", async () => {
	await assert.rejects(bridge.fill("Degree", "PhD"), /"Degree" matches 2 elements on this page, so I did not guess/);
	assert.equal(await value("document.getElementById('degree1').value + '|' + document.getElementById('degree2').value"), "|");

	await bridge.fill({ name: "Degree", nth: 2 }, "PhD");
	assert.equal(await value("document.getElementById('degree1').value + '|' + document.getElementById('degree2').value"), "|PhD");
	await assert.rejects(bridge.fill({ name: "Degree", nth: 5 }, "x"), /nth: 5 is out of range/);
});

test("a control the page hides and paints over is clicked through its reference", async () => {
	const snapshot = (await bridge.read()).snapshot;
	const line = snapshot.split("\n").find((row) => /- radio \[ref=e\d+\]/.test(row));
	assert.ok(line, `a radio, in:\n${snapshot}`);
	const ref = line.match(/\[ref=(e\d+)\]/)?.[1] ?? "";
	assert.match(ref, /^e\d+$/);

	await bridge.click({ ref });
	assert.equal(await value("document.getElementById('agree').checked"), true);
	assert.match(bridge.status().actions.at(-1)?.text ?? "", /hidden behind what the page paints/);
});

test("submit waits for the user's Allow on the status board, and a Deny is a refusal, not an error", async () => {
	const denied = bridge.submit("Create account");
	await until("a pending question", () => bridge.status().pending !== undefined);
	const question = bridge.status().pending!;
	assert.match(question.text, /press "Create account" on Sign up/);
	assert.equal(bridge.answer("some-other-id", true), false);
	assert.equal(bridge.answer(question.id, false), true);
	assert.deepEqual(await denied, { submitted: "Create account", allowed: false });
	assert.equal(bridge.status().pending, undefined);

	const allowed = bridge.submit("Create account");
	await until("a second question", () => bridge.status().pending !== undefined);
	bridge.answer(bridge.status().pending!.id, true);
	assert.deepEqual(await allowed, { submitted: "Create account", allowed: true });
	await until("the form to submit", () => bridge.status().tab?.title === "Submitted ada@example.org" || true);
	const title = (await devtools.send("Runtime.evaluate", { expression: "document.title", returnByValue: true }, tabSession())) as { result: { value: string } };
	assert.equal(title.result.value, "Submitted ada@example.org");
});

test("a reference from another page is a sentence, not a click on whatever now holds that number", async () => {
	const ref = (await bridge.read()).snapshot.match(/\[ref=(e\d+)\]/)?.[1] ?? "";
	await bridge.open(OTHER);
	await assert.rejects(bridge.click({ ref }), /was read from .* and the tab is now on .*Read the page again/s);
	await assert.rejects(bridge.click({ ref: "nonsense" }), /is not a reference/);
});

test("the agent opens, lists, switches and closes tabs of the group, and the verbs follow the tab it picked", async () => {
	const first = await bridge.group.list();
	assert.equal(first.length, 1);
	assert.equal(first[0]!.current, true);

	const opened = await bridge.group.open("data:text/html,<title>Second</title><h1>Two</h1>");
	assert.equal(opened.index, 2);
	await until("two tabs", () => bridge.status().tabs.length === 2);
	assert.equal((await bridge.read()).title, "Second", "the new tab is the one acted on");
	assert.deepEqual((await bridge.group.list()).map((tab) => tab.current), [false, true]);

	await bridge.group.use(1);
	assert.notEqual((await bridge.read()).title, "Second", "back on the first tab");
	await bridge.group.use("second");
	assert.equal((await bridge.read()).title, "Second", "picked by words in its title");
	await assert.rejects(bridge.group.use(9), /There is no tab 9/);

	const closed = await bridge.group.close();
	assert.equal(closed.closed, "Second");
	assert.equal(closed.tabs, 1);
	assert.notEqual((await bridge.read()).title, "Second", "the verbs fall back to the first tab");
	await assert.rejects(bridge.group.close(), /only shared tab/);
});

test("a reference to a field inside a frame (f…e…) is taken, as on portals that put their form in an iframe", async () => {
	const inner = "<!doctype html><title>Inner</title><table><tr><th>Verbal</th><td><input id=v></td></tr></table>";
	await bridge.open(`data:text/html,${encodeURIComponent(`<!doctype html><title>Portal</title><iframe srcdoc="${inner.replace(/"/g, "&quot;")}"></iframe>`)}`);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const page = await bridge.read();
	const ref = page.snapshot.match(/textbox \[ref=(f\d+e\d+)\]/)?.[1];
	assert.ok(ref, `a frame reference in:\n${page.snapshot}`);
	await bridge.fill({ ref: ref! }, "152");
	const value = (await devtools.send("Runtime.evaluate", { expression: "document.querySelector('iframe').contentDocument.getElementById('v').value", returnByValue: true }, tabSession())) as { result: { value: string } };
	assert.equal(value.result.value, "152");
});

test("type sends real keystrokes into a field it focuses first, so a page that listens to typing hears every key", async () => {
	await bridge.open(`data:text/html,${encodeURIComponent('<!doctype html><title>Count</title><label>Note <textarea id=n></textarea></label><p id=c>0</p><script>n.addEventListener("keyup",()=>c.textContent=n.value.length)</script>')}`);
	const typed = await bridge.type("hello world", "Note");
	assert.equal(typed.typed, 11);
	const value = (await devtools.send("Runtime.evaluate", { expression: "n.value + '|' + c.textContent", returnByValue: true }, tabSession())) as { result: { value: string } };
	assert.equal(value.result.value, "hello world|11");
	await bridge.focus("Note");
	await bridge.type("!");
	const after = (await devtools.send("Runtime.evaluate", { expression: "n.value", returnByValue: true }, tabSession())) as { result: { value: string } };
	assert.equal(after.result.value, "hello world!");
});

test("fill is heard by a page that listens for keyup and change, not just input", async () => {
	await bridge.open(`data:text/html,${encodeURIComponent('<!doctype html><title>Words</title><label>Answer <textarea id=a></textarea></label><p id=w>200 words remaining</p><p id=ch>no</p><script>a.addEventListener("keyup",()=>w.textContent=(200-a.value.split(/\\s+/).filter(Boolean).length)+" words remaining");a.addEventListener("change",()=>ch.textContent="yes")</script>')}`);
	await bridge.fill("Answer", "one two three");
	const value = (await devtools.send("Runtime.evaluate", { expression: "w.textContent + '|' + ch.textContent", returnByValue: true }, tabSession())) as { result: { value: string } };
	assert.equal(value.result.value, "197 words remaining|yes");
});

test("a click or key says where the page went, and a click that changes nothing says so", async () => {
	// Chrome refuses a link from one data: page to another, so the move is to about:blank.
	await bridge.open(`data:text/html,${encodeURIComponent(`<!doctype html><title>Start</title><a href="about:blank">Go</a><button>Nothing</button><p id=landed>here</p>`)}`);
	const idle = await bridge.click("Nothing");
	assert.equal(idle.changed, false);
	assert.equal(idle.navigated, undefined);
	const went = await bridge.click("Go");
	assert.equal(went.changed, true);
	assert.equal(went.navigated, "about:blank");
});

test("a menu of a hundred years reads as its first few, the chosen one and a count, and full shows them all", async () => {
	const years = Array.from({ length: 80 }, (_, i) => 2026 - i).map((y) => `<option${y === 1998 ? " selected" : ""}>${y}</option>`).join("");
	await bridge.open(`data:text/html,${encodeURIComponent(`<!doctype html><title>Born</title><label>Year <select>${years}</select></label>`)}`);
	const folded = await bridge.read();
	assert.match(folded.snapshot, /option "1998" \[selected\]/);
	assert.match(folded.snapshot, /80 options in all/);
	assert.doesNotMatch(folded.snapshot, /option "1960"/);
	const full = await bridge.read({ full: true });
	assert.match(full.snapshot, /option "1960"/);
	await bridge.select("Year", "1960");
});

test("values lists every field with its label and value, including unlabeled cells in a frame by their row", async () => {
	const inner = "<!doctype html><table><tr><th>Verbal</th><td><input value=152></td><td><input value=48></td></tr></table>";
	await bridge.open(`data:text/html,${encodeURIComponent(`<!doctype html><title>Form</title><label>Email <input value="ada@example.org"></label><label>Year <select><option>1997</option><option selected>1998</option></select></label><iframe srcdoc="${inner.replace(/"/g, "&quot;")}"></iframe>`)}`);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const { fields } = await bridge.values();
	const by = Object.fromEntries(fields.map((f) => [f.label, f.value]));
	assert.equal(by["Email"], "ada@example.org");
	assert.equal(by["Year"], "1998");
	assert.equal(by["Verbal (column 1)"], "152");
	assert.equal(by["Verbal (column 2)"], "48");
});

test("a label used on the page and in an open dialog means the dialog's, and a hidden copy is passed over", async () => {
	await bridge.open(
		`data:text/html,${encodeURIComponent('<!doctype html><title>Dialogs</title><label>City <input id=a></label><div hidden><label>City <input id=h></label></div><div role=dialog aria-label=Address><label>City <input id=d></label></div>')}`,
	);
	await bridge.fill("City", "Palo Alto");
	const value = (await devtools.send("Runtime.evaluate", { expression: "[a.value, h.value, d.value].join('|')", returnByValue: true }, tabSession())) as { result: { value: string } };
	assert.equal(value.result.value, "||Palo Alto");
});

test("a click on a button that sends waits for the person's Allow, and a No leaves the page as it was", async () => {
	await bridge.open(`data:text/html,${encodeURIComponent('<!doctype html><title>Letters</title><button onclick="document.title=\'sent\'">Send request</button>')}`);
	const asked = bridge.click("Send request");
	await until("the question on the board", () => bridge.status().pending !== undefined);
	assert.match(bridge.status().pending!.text, /Send request/);
	bridge.answer(bridge.status().pending!.id, false);
	const result = await asked;
	assert.equal(result.allowed, false);
	assert.equal((await bridge.read()).title, "Letters");
});

test("a menu under a transparent covering layer is still chosen (the typed fallback for a stalled menu is not exercised here)", async () => {
	await bridge.open(
		`data:text/html,${encodeURIComponent('<!doctype html><title>Stall</title><label>Month <select id=m><option></option><option>August</option><option>September</option></select></label><div style="position:fixed;inset:0;background:transparent"></div>')}`,
	);
	const result = await bridge.select("Month", "September");
	const value = (await devtools.send("Runtime.evaluate", { expression: "m.value", returnByValue: true }, tabSession())) as { result: { value: string } };
	assert.equal(value.result.value, "September");
	assert.equal(result.option, "September");
});

test("stop lets go of the tab; the extension's socket closes and the status says why", async () => {
	const closed = new Promise<string>((resolve) => extension.once("close", (_code, reason) => resolve(reason.toString())));
	bridge.stop();
	assert.equal(await closed, "stopped from the deck");
	await until("disconnected", () => !bridge.status().connected);
	assert.equal(bridge.status().closed, "stopped from the deck");
	assert.ok(statuses.length > 5, "status changes were reported");
	await assert.rejects(bridge.read(), /not connected/i);
});

/** Read something out of the shared tab, from outside the bridge — the independent check. */
async function value(expression: string): Promise<unknown> {
	const answer = (await devtools.send("Runtime.evaluate", { expression, returnByValue: true }, tabSession())) as { result: { value: unknown } };
	return answer.result.value;
}

/** The tab's own DevTools session, for reading the page from outside the bridge. */
function tabSession(): string {
	assert.ok(sessionOfFirstTab, "the fake extension attached the first tab");
	return sessionOfFirstTab;
}
let sessionOfFirstTab: string | undefined;
