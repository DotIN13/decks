import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { WebSocket } from "ws";
import { JevService, type JevBackend } from "./jev.ts";

/** A socket to an address, which rejects when nothing is listening on it. */
function connect(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.once("open", () => {
			socket.close();
			resolve();
		});
		socket.once("error", (error: Error) => reject(error));
	});
}

/**
 * The service against a fake backend: the runner is a Node one-liner printing the same
 * JSON lines `runtime/jev/runner.py` prints, so the whole state machine — lines to
 * steps, end and error to a result, stop to a SIGTERM, the browser closed with the run
 * — is tested without Python, Chromium, or a network.
 */
function harness(
	options: {
		keys?: Record<string, string | undefined>;
		script?: string;
		failLaunch?: boolean;
		/** The debugger endpoint of a Chrome somebody is logged into, when one is shared. */
		shared?: string;
		/** The person's answer to a gate's question, through the status board. */
		person?: (text: string) => Promise<boolean>;
	} = {},
) {
	let closed = 0;
	let env: Record<string, string> | undefined;
	const backend: JevBackend = {
		keys: () => options.keys ?? { TYPESAFE_API_KEY: "k" },
		browser: async () => {
			if (options.failLaunch) throw new Error("no chromium here");
			return { cdpUrl: "http://127.0.0.1:1", close: async () => void (closed += 1) };
		},
		runner: async (_spec, given) => {
			env = given;
			return spawn(process.execPath, ["-e", options.script ?? "process.exit(0)"], { stdio: ["ignore", "pipe", "pipe"] });
		},
	};
	const service = new JevService(backend, { ...(options.person ? { person: options.person } : {}) });
	service.setShared(options.shared);
	return { service, closedBrowsers: () => closed, env: () => env };
}

const line = (payload: Record<string, unknown>) => `console.log(JSON.stringify(${JSON.stringify(payload)}));`;

/** Wait until the run has ended, since lines arrive on the child's own schedule. */
async function ended(service: JevService, withinMs = 5000): Promise<ReturnType<JevService["state"]>> {
	const deadline = Date.now() + withinMs;
	while (Date.now() < deadline) {
		const run = service.state();
		if (run.endedAt) return run;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("the run never ended");
}

test("a missing key is a sentence in status and a refusal in run", async () => {
	const { service } = harness({ keys: {} });
	const status = service.status();
	assert.equal(status.ready, false);
	assert.deepEqual(status.missing, ["TYPESAFE_API_KEY"]);
	assert.match(status.note, /Set TYPESAFE_API_KEY in the server's environment/);
	await assert.rejects(service.run({ url: "https://x.test", goal: "do it" }), /Set TYPESAFE_API_KEY/);
});

test("run needs a URL and a goal, as sentences", async () => {
	const { service } = harness();
	await assert.rejects(service.run({ url: " ", goal: "g" }), /needs a URL/);
	await assert.rejects(service.run({ url: "https://x.test", goal: "" }), /needs a goal/);
});

test("states become steps, end becomes done, and the browser closes with the run", async () => {
	const { service, closedBrowsers } = harness({
		script: [
			line({ t: "state", status: "ready", elapsed_ms: 0, steps: 0, url: "https://x.test" }),
			line({ t: "state", status: "ready", elapsed_ms: 900, steps: 1, url: "https://x.test/2", last: { action: "Search", operation: "CLICK", text: null } }),
			line({ t: "end", status: "done", elapsed_ms: 1400, steps: 1, url: "https://x.test/2" }),
		].join(""),
	});
	const started = await service.run({ url: "https://x.test", goal: "find the thing" });
	assert.match(started.note, /state\(\) follows it/);
	const run = await ended(service);
	assert.equal(run.status, "done");
	assert.equal(run.steps.length, 2);
	assert.equal(run.steps[1]?.last?.action, "Search");
	assert.equal(run.elapsedMs, 1400);
	assert.equal(closedBrowsers(), 1);
	const status = service.status();
	assert.equal(status.ready, true);
	assert.equal(status.last?.status, "done");
});

test("an error line fails the run with its note", async () => {
	const { service } = harness({ script: line({ t: "error", note: "TYPESAFE_API_KEY is not set" }) + "process.exit(1)" });
	await service.run({ url: "https://x.test", goal: "g" });
	const run = await ended(service);
	assert.equal(run.status, "failed");
	assert.match(run.note ?? "", /TYPESAFE_API_KEY/);
});

test("a runner that dies without a result fails the run with its exit", async () => {
	const { service } = harness({ script: "console.error('boom'); process.exit(3)" });
	await service.run({ url: "https://x.test", goal: "g" });
	const run = await ended(service);
	assert.equal(run.status, "failed");
	assert.match(run.note ?? "", /exited 3: boom/);
});

test("one run at a time, and stop ends the one going", async () => {
	const { service, closedBrowsers } = harness({ script: "setInterval(() => {}, 1000)" });
	await service.run({ url: "https://x.test", goal: "g" });
	await assert.rejects(service.run({ url: "https://y.test", goal: "h" }), /already going/);
	assert.equal(service.status().running?.url, "https://x.test");
	await service.stop();
	const run = await ended(service);
	assert.equal(run.status, "stopped");
	assert.equal(closedBrowsers(), 1);
	// The child's own exit afterwards does not overwrite the stop.
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(service.state().status, "stopped");
});

test("a browser that cannot launch is the run's failure, not a hang", async () => {
	const { service } = harness({ failLaunch: true });
	await assert.rejects(service.run({ url: "https://x.test", goal: "g" }), /no chromium here/);
});

test("state before any run is a sentence", () => {
	const { service } = harness();
	assert.throws(() => service.state(), /run\({ url, goal }\) starts one/);
});

test("a shared Chrome is what a run drives, and it drives it through the gate", async () => {
	const { service, env } = harness({ script: "setInterval(() => {}, 1000)", shared: "ws://127.0.0.1:9222/cdp" });
	assert.equal(service.status().shared, true);
	const started = await service.run({ url: "https://x.test", goal: "find the invoice" });
	assert.match(started.note, /the tab you shared/);
	const run = service.state();
	assert.equal(run.browser, "chrome");
	assert.equal(service.status().running?.browser, "chrome");
	/*
	 * The agent attaches to the gate, not to the Chrome: the address it is given is a loopback
	 * port of this server's own, and the person's Chrome is only reachable from the other side
	 * of it. A run pointed straight at the relay would be the ungated version of this.
	 */
	const gate = String(env()?.BU_CDP_URL);
	assert.match(gate, /^ws:\/\/127\.0\.0\.1:\d+\/cdp$/);
	assert.notEqual(gate, "ws://127.0.0.1:9222/cdp");
	await service.stop();
	assert.equal(service.state().status, "stopped");
	// The gate closes with the run: the address the agent was given stops answering.
	await assert.rejects(connect(gate), /closed|refused|ECONNREFUSED|socket hang up/i);
});

test("the goal a supervised run is given says what it may not do alone", async () => {
	const told: string[] = [];
	const backend: JevBackend = {
		keys: () => ({ TYPESAFE_API_KEY: "k" }),
		browser: async () => ({ cdpUrl: "http://127.0.0.1:1", close: async () => {} }),
		runner: async (spec) => {
			told.push(spec.goal);
			return spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: ["ignore", "pipe", "pipe"] });
		},
	};
	const service = new JevService(backend);
	service.setShared("ws://127.0.0.1:9222/cdp");
	await service.run({ url: "https://x.test", goal: "find the invoice" });
	await ended(service);
	assert.match(told[0] ?? "", /find the invoice/);
	assert.match(told[0] ?? "", /supervised/);
	assert.match(told[0] ?? "", /words that go into a field come from the person watching/);
	assert.match(told[0] ?? "", /may be refused/);
});

test("a headless run is told none of that, because there is nobody to protect", async () => {
	const told: string[] = [];
	const backend: JevBackend = {
		keys: () => ({ TYPESAFE_API_KEY: "k" }),
		browser: async () => ({ cdpUrl: "http://127.0.0.1:1", close: async () => {} }),
		runner: async (spec) => {
			told.push(spec.goal);
			return spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: ["ignore", "pipe", "pipe"] });
		},
	};
	const service = new JevService(backend);
	service.setShared("ws://127.0.0.1:9222/cdp");
	await service.run({ url: "https://x.test", goal: "find the invoice", browser: "headless" });
	await ended(service);
	assert.equal(told[0], "find the invoice");
});

test("asking for the shared Chrome when none is shared is a sentence, not a headless run", async () => {
	const { service } = harness();
	assert.equal(service.status().shared, false);
	await assert.rejects(service.run({ url: "https://x.test", goal: "g", browser: "chrome" }), /No Chrome is shared/);
});

test("headless is a browser of the server's own even when a Chrome is shared", async () => {
	const { service, env, closedBrowsers } = harness({ script: "setInterval(() => {}, 1000)", shared: "ws://127.0.0.1:9222/cdp" });
	await service.run({ url: "https://x.test", goal: "g", browser: "headless" });
	assert.equal(service.state().browser, "headless");
	assert.equal(env()?.BU_CDP_URL, "http://127.0.0.1:1");
	await service.stop();
	assert.equal(closedBrowsers(), 1);
});

test("answering when nothing is waiting is a sentence, not a lost answer", async () => {
	const { service } = harness();
	assert.throws(() => service.answer({ allow: true }), /Nothing is waiting/);
});
