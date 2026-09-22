import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { JevService, type JevBackend } from "./jev.ts";

/**
 * The service against a fake backend: the runner is a Node one-liner printing the same
 * JSON lines `runtime/jev/runner.py` prints, so the whole state machine — lines to
 * steps, end and error to a result, stop to a SIGTERM, the browser closed with the run
 * — is tested without Python, Chromium, or a network.
 */
function harness(options: { keys?: Record<string, string | undefined>; script?: string; failLaunch?: boolean } = {}) {
	let closed = 0;
	const backend: JevBackend = {
		keys: () => options.keys ?? { TYPESAFE_API_KEY: "k" },
		browser: async () => {
			if (options.failLaunch) throw new Error("no chromium here");
			return { cdpUrl: "http://127.0.0.1:1", close: async () => void (closed += 1) };
		},
		runner: async () => spawn(process.execPath, ["-e", options.script ?? "process.exit(0)"], { stdio: ["ignore", "pipe", "pipe"] }),
	};
	const service = new JevService(backend);
	return { service, closedBrowsers: () => closed };
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
