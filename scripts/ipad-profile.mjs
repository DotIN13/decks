#!/usr/bin/env node
/*
 * Profile pan and zoom on a real iPad through Safari's Web Inspector.
 *
 *   node scripts/ipad-profile.mjs --url https://host:port/ [--out file.json] [--device UDID]
 *                                  [--phases pan|zoom] [--probe https://collector/ --frames file.jsonl]
 *
 * `--phases zoom` records pinches from 2% to 200% and back instead. `--probe` has the page post its
 * frames to a collector that appends them to `--frames`, so each phase also gets real frame gaps.
 *
 * Opens Safari on the plugged-in iPad at `url` with the probe on (`apps/web/src/perf/probe.ts`),
 * reaches its Web Inspector through ios_webkit_debug_proxy (brew install ios-webkit-debug-proxy),
 * and records four phases, each on its own: at rest at 30%, panning below the live zoom, panning
 * above it with its pages up, and zooming across it and back. The gestures are the page's own
 * (`__pilot`): pans are smooth scrolls, which Safari runs as it runs a finger's, and pinches go
 * through the stage's pinch handler. Safari's WebDriver cannot stand in: on this canvas it never
 * lifts a finger.
 *
 * Each phase is its own recording because an iPad's inspector gives every timestamp as 0: time
 * comes from the sampling profiler (a sample about every millisecond of script) and from the CPU
 * readings (each thread's share, every half second).
 */
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const arg = (name, fallback) => {
	const at = process.argv.indexOf(`--${name}`);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const url = arg("url");
if (!url) throw new Error("--url is the Decks page to profile, as the iPad reaches it");
const out = arg("out", `ipad-profile-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`);
const env = { ...process.env, DEVELOPER_DIR: process.env.DEVELOPER_DIR ?? "/Applications/Xcode.app/Contents/Developer" };
const devicectl = (...args) => execFileSync("xcrun", ["devicectl", ...args], { env, encoding: "utf8" });
const device = arg("device") ?? /([0-9A-F]{8}-[0-9A-F]{16})/.exec(devicectl("list", "devices").split("\n").find((line) => /physical/.test(line) && /iPad/.test(line)) ?? "")?.[1];
if (!device) throw new Error("No iPad plugged in (xcrun devicectl list devices)");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Safari, started afresh on the page: a tab opened any other way (WebDriver's) does not answer an inspector.
const safari = /(\d+)\s+\S*MobileSafari\.app\/MobileSafari/.exec(devicectl("device", "info", "processes", "--device", device))?.[1];
if (safari) devicectl("device", "process", "terminate", "--device", device, "--pid", safari);
await sleep(1500);
const probeTo = arg("probe");
const page = `${url}${url.includes("?") ? "&" : "?"}probe=${probeTo ? encodeURIComponent(probeTo) : "1"}`;
devicectl("device", "process", "launch", "--device", device, "--payload-url", page, "com.apple.mobilesafari");

// The proxy, and the tab.
const proxy = spawn("ios_webkit_debug_proxy", ["-c", `${device}:9222`], { stdio: "ignore" });
process.on("exit", () => proxy.kill());
let socketUrl;
for (let i = 0; i < 40 && !socketUrl; i++) {
	await sleep(500);
	const tabs = await fetch("http://localhost:9222/json").then((r) => r.json()).catch(() => []);
	socketUrl = tabs.find((tab) => tab.url?.includes("probe="))?.webSocketDebuggerUrl;
}
if (!socketUrl) throw new Error("The iPad's Safari tab did not show up in the inspector: is Web Inspector on in Settings › Apps › Safari › Advanced?");

// The inspector: commands go to the page's target, wrapped in Target messages.
const ws = new WebSocket(socketUrl);
let target;
let id = 0;
const waiting = new Map();
const events = [];
ws.onmessage = (message) => {
	const msg = JSON.parse(message.data);
	if (msg.method === "Target.targetCreated") target = msg.params.targetInfo.targetId;
	if (msg.method !== "Target.dispatchMessageFromTarget") return;
	const inner = JSON.parse(msg.params.message);
	if (inner.id && waiting.has(inner.id)) {
		waiting.get(inner.id)(inner);
		waiting.delete(inner.id);
	} else events.push(inner);
};
await new Promise((done) => (ws.onopen = done));
for (let i = 0; i < 20 && !target; i++) await sleep(250);
const send = (method, params = {}, ms = 120_000) =>
	Promise.race([
		new Promise((done) => {
			const n = ++id;
			waiting.set(n, done);
			ws.send(JSON.stringify({ id: ++id, method: "Target.sendMessageToTarget", params: { targetId: target, message: JSON.stringify({ id: n, method, params }) } }));
		}),
		sleep(ms).then(() => ({ error: `${method} took longer than ${ms} ms` })),
	]);
/** Run an expression in the page; a promise is waited for. */
const run = async (expression) => {
	const made = (await send("Runtime.evaluate", { expression, returnByValue: false })).result?.result;
	if (made?.className !== "Promise" && made?.subtype !== "promise") return made?.value ?? made?.description;
	return (await send("Runtime.awaitPromise", { promiseObjectId: made.objectId, returnByValue: true })).result?.result?.value;
};
const zoom = async () => Number(/scale\(([\d.]+)\)/.exec(await run("String(globalThis.__decksCameraTransform?.())"))?.[1]);
for (let i = 0; i < 60 && (await run("typeof __pilot")) !== "object"; i++) await sleep(500);
await sleep(8000);
const settle = (ms) => run(`new Promise((done) => setTimeout(done, ${ms}))`);
const zoomTo = async (want) => {
	await run(`__pilot.pinch(${want / (await zoom())}, 600)`);
	await settle(3000);
};

await send("Timeline.enable");
await send("Memory.enable");
const record = async (name, action) => {
	events.length = 0;
	await send("ScriptProfiler.startTracking", { includeSamples: true });
	await send("CPUProfiler.startTracking");
	await send("Memory.startTracking");
	await send("Timeline.start", { maxCallStackDepth: 6 });
	const start = Date.now();
	const pageStart = await run("performance.now()");
	await run(action);
	const pageEnd = await run("performance.now()");
	const wall = Date.now() - start;
	// The drawing's own word on when it was last sharp and filled in (`stage/engine.ts`, `__decksSheet`), a moment after the gesture.
	await settle(4000);
	const sheet = await run("JSON.stringify(globalThis.__decksSheet ?? {})");
	await send("Timeline.stop");
	await send("Memory.stopTracking");
	await send("CPUProfiler.stopTracking");
	await send("ScriptProfiler.stopTracking");
	await sleep(3000);
	return { name, wall, pageStart, pageEnd, sheet: JSON.parse(sheet ?? "{}"), events: events.splice(0) };
};

const phases = [];
const manual = /^manual:(\d+)$/.exec(arg("phases", "pan"));
if (manual) {
	// The person's own fingers: one recording of that many seconds, whatever they do in it.
	console.log(`Recording for ${manual[1]} s: pinch and pan on the iPad now.`);
	phases.push(await record("Your hands", `new Promise((done) => setTimeout(done, ${Number(manual[1]) * 1000}))`));
} else if (arg("phases", "pan") === "zoom") {
	await zoomTo(0.02);
	phases.push(await record("Zoom 2% to 200% in 3 s", "__pilot.pinch(100, 3000)"));
	phases.push(await record("Zoom 200% to 2% in 3 s", "__pilot.pinch(0.01, 3000)"));
	phases.push(await record("Zoom 2% to 200% in 1 s", "__pilot.pinch(100, 1000)"));
	phases.push(await record("Zoom 200% to 2% in 1 s", "__pilot.pinch(0.01, 1000)"));
} else {
	await zoomTo(0.3);
	phases.push(await record("At rest, 30%", "new Promise((done) => setTimeout(done, 4000))"));
	phases.push(await record("Panning below 50%", "__pilot.pans(4)"));
	await zoomTo(0.72);
	phases.push(await record("Panning above 50%", "__pilot.pans(4)"));
	phases.push(await record("Zooming across 50% and back", "__pilot.cross(3)"));
}
await settle(2500);
ws.close();

/** One phase, summed: the main thread's share, script time, page loads, and the costliest functions. */
const short = (url) => (url ? url.split("/").pop().replace(/-[\w]{8}\.js/, ".js").replace(/\?.*/, "") : "native");
/** The page's own frames in a phase, from the collector's file: how long each frame took, really. */
const framesFile = arg("frames");
const posted = framesFile ? (await import("node:fs")).readFileSync(framesFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).flatMap((batch) => batch.frames ?? []) : [];
const gapsIn = (from, to) => {
	const gaps = posted.filter((frame) => frame.t >= from && frame.t <= to).map((frame) => frame.gap).sort((a, b) => a - b);
	if (gaps.length === 0) return {};
	return { frames: gaps.length, gapP95: gaps[Math.floor(gaps.length * 0.95)], gapMax: gaps.at(-1), over34: gaps.filter((g) => g > 34).length, over100: gaps.filter((g) => g > 100).length };
};
const summary = phases.map(({ name, wall, events, pageStart, pageEnd, sheet }) => {
	const samples = events.find((e) => e.method === "ScriptProfiler.trackingComplete")?.params.samples.stackTraces ?? [];
	const self = new Map();
	for (const sample of samples) {
		const top = sample.stackFrames[0];
		if (!top) continue;
		const key = `${top.name || "(anonymous)"} ${short(top.url)}:${top.line}`;
		self.set(key, (self.get(key) ?? 0) + 1);
	}
	const cpu = events.filter((e) => e.method === "CPUProfiler.trackingUpdate").map((e) => e.params.event);
	const main = cpu.map((reading) => reading.threads.find((thread) => thread.type === "main")?.usage ?? 0);
	const memory = events.filter((e) => e.method === "Memory.trackingUpdate").at(-1)?.params.event.categories ?? [];
	const records = events.filter((e) => e.method === "Timeline.eventRecorded").map((e) => e.params.record);
	const count = (type) => {
		let n = 0;
		const walk = (record) => {
			if (record.type === type) n++;
			for (const child of record.children ?? []) walk(child);
		};
		records.forEach(walk);
		return n;
	};
	const seconds = wall / 1000;
	return {
		phase: name,
		seconds: Math.round(seconds * 10) / 10,
		mainBusyAverage: Math.round(main.reduce((a, b) => a + b, 0) / Math.max(1, main.length)),
		mainBusyWorst: Math.round(Math.max(0, ...main)),
		scriptMsPerSecond: Math.round(samples.length / seconds),
		boardScriptsStarted: count("EvaluateScript"),
		layoutsPerSecond: Math.round(count("Layout") / seconds),
		paintsPerSecond: Math.round(count("Paint") / seconds),
		...gapsIn(pageStart, pageEnd),
		workerBusyAverage: Math.round(cpu.map((reading) => reading.threads.filter((thread) => thread.type === "webkit").reduce((a, t) => a + t.usage, 0)).reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)),
		sharpAfterMs: sheet.sharpAt ? Math.round(sheet.sharpAt - pageEnd) : undefined,
		filledAfterMs: sheet.settledAt ? Math.round(sheet.settledAt - pageEnd) : undefined,
		memoryMB: Object.fromEntries(memory.map((one) => [one.type, Math.round(one.size / 2 ** 20)])),
		costliest: [...self].sort((a, b) => b[1] - a[1]).slice(0, 8),
	};
});
writeFileSync(out, JSON.stringify({ url, device, at: new Date().toISOString(), summary, phases }, null, 1));
console.table(summary.map(({ costliest: _c, memoryMB: _m, ...row }) => row));
for (const row of summary) console.log(`${row.phase}: ${row.costliest.slice(0, 4).map(([key, n]) => `${key} ${n}`).join(" · ")}`);
console.log(`saved ${out}`);
process.exit(0);
