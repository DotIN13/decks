import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Schedule, ServerMessage, TaskRosterEntry } from "@decks/protocol";
import { TaskService, type DeliverSpec, type TaskRegistry } from "./service.ts";
import { TaskStore } from "./store.ts";
import { digestBoardPath } from "./digest.ts";

/**
 * The service against a fake registry: the rule sees a roster, the queue is a map.
 *
 * Everything here is the service's own state machine — who is told what, when a task
 * changes state, what survives a cancel — so the fake only needs the three verbs the
 * `TaskRegistry` interface declares. The real registry is exercised end to end by the
 * browser check (`e2e/checks/tasks.mjs`).
 */
function harness(roster: TaskRosterEntry[] = []) {
	const dir = mkdtempSync(join(tmpdir(), "tasks-service-"));
	const queue = new Map<string, DeliverSpec[]>();
	const messages: ServerMessage[] = [];
	/** What the dispatcher agent was asked to place, in order. */
	const asked: Array<{ id: string; text: string; boards: string[]; workspace?: string; promptPath?: string }> = [];
	const registry: TaskRegistry = {
		roster: () => roster,
		decide: (task) => {
			asked.push(task);
			return { dispatcherId: `d-${asked.length}` };
		},
		deliver: (target, spec) => {
			const to = roster.find((entry) => entry.id === target);
			if (!to) throw new Error(`No agent ${target}.`);
			queue.set(target, [...(queue.get(target) ?? []), spec]);
			return { queued: true, position: queue.get(target)!.length };
		},
		removeQueued: (agentId, taskId) => {
			const before = queue.get(agentId)?.length ?? 0;
			queue.set(agentId, (queue.get(agentId) ?? []).filter((spec) => spec.taskId !== taskId));
			return (queue.get(agentId)?.length ?? 0) < before;
		},
	};
	const service = new TaskService(new TaskStore(dir, () => {}), registry, (message) => messages.push(message));
	const cleanup = () => rmSync(dir, { recursive: true, force: true });
	return { queue, messages, registry, service, cleanup, roster, asked };
}

/** The dispatcher's answer, as the registry reports it when it sees the agent's `send`. */
function placed(service: TaskService, queue: Map<string, DeliverSpec[]>, taskId: string, agent: TaskRosterEntry, why = "it holds the boards"): void {
	queue.set(agent.id, [...(queue.get(agent.id) ?? []), { task: "x", taskId, fromName: "Dispatcher" }]);
	service.assignedByDispatcher({ taskId, agentId: agent.id, agentName: agent.name, why });
}

const ada: TaskRosterEntry = { id: "a", name: "Ada", state: "idle", workspace: "political-llm", tags: [], context: [], queued: 0 };
const bo: TaskRosterEntry = { id: "b", name: "Bo", state: "idle", workspace: "zeta-check", tags: [], context: [], queued: 0 };

test("a created task is open and asked of the dispatcher, and assigned once it sends", () => {
	const { queue, service, asked, cleanup } = harness([ada, bo]);
	const result = service.create({ text: "Remeasure the panels" });
	assert.equal(result.state, "open");
	assert.match(result.why, /dispatcher is deciding/);
	assert.equal(asked.length, 1);
	assert.equal(asked[0]?.id, result.id);
	assert.equal(asked[0]?.text, "Remeasure the panels");
	assert.deepEqual(asked[0]?.boards, []);
	// The message is on disk as the task's own file, and the dispatcher is told where.
	assert.match(asked[0]?.promptPath ?? "", /\.decks\/tasks\/.+\.md$/);
	assert.equal(service.get(result.id)?.dispatcherId, "d-1");
	assert.equal(queue.size, 0);
	placed(service, queue, result.id, ada);
	const task = service.get(result.id);
	assert.equal(task?.state, "assigned");
	assert.equal(task?.agentId, "a");
	// Who, and not yet why: the reason is the dispatcher's closing sentence, which comes with `decided`.
	assert.equal(task?.dispatch.why, "The dispatcher chose Ada.");
	cleanup();
});

test("a named agent skips the dispatcher: the rule checks it and the queue takes it", () => {
	const { queue, service, asked, cleanup } = harness([ada, bo]);
	const result = service.create({ text: "Remeasure the panels", agentId: "b" });
	assert.equal(result.state, "assigned");
	assert.equal(result.agentId, "b");
	assert.equal(queue.get("b")?.[0]?.taskId, result.id);
	assert.equal(asked.length, 0);
	cleanup();
});

test("a deciding turn that makes a schedule finishes the task with the schedule as its result", () => {
	const { service, cleanup } = harness([ada]);
	const result = service.create({ text: "every weekday at nine, digest for political-llm" });
	const made = service.createSchedule({ name: "Morning digest", at: "09:00", days: [1, 2, 3, 4, 5], workspace: "political-llm", kind: "digest" });
	assert.ok(!("error" in made));
	service.scheduled({ taskId: result.id, schedule: made as Schedule });
	const task = service.get(result.id);
	assert.equal(task?.state, "done");
	assert.match(task?.result?.report ?? "", /Made the schedule "Morning digest", weekdays at 09:00, for political-llm/);
	assert.match(task?.dispatch.why ?? "", /^Scheduled: Morning digest, weekdays at 09:00\./);
	// And the turn ending afterwards with nothing sent does not block it.
	service.decided({ taskId: result.id, sent: false, report: "Scheduled it." });
	assert.equal(service.get(result.id)?.state, "done");
	cleanup();
});

test("a deciding turn that sends nothing blocks the task with what the dispatcher said", () => {
	const { service, cleanup } = harness([ada]);
	const result = service.create({ text: "x" });
	service.decided({ taskId: result.id, sent: false, report: "Nobody here works on panels.\nMore words." });
	const task = service.get(result.id);
	assert.equal(task?.state, "blocked");
	assert.equal(task?.reason, "Nobody here works on panels.");
	// And a turn that did send leaves the assigned task assigned, with its closing sentence as the reason.
	const second = service.create({ text: "y" });
	service.assignedByDispatcher({ taskId: second.id, agentId: "a", agentName: "Ada", why: "why" });
	service.decided({ taskId: second.id, sent: true, report: "Sent to Ada: she holds the panel boards.\nMore words." });
	assert.equal(service.get(second.id)?.state, "assigned");
	assert.equal(service.get(second.id)?.dispatch.why, "Sent to Ada: she holds the panel boards.");
	assert.equal(service.get(second.id)?.agentName, "Ada");
	cleanup();
});

test("an empty-text task throws with a sentence", () => {
	const { service, cleanup } = harness([ada]);
	assert.throws(() => service.create({ text: "   " }), /description/);
	cleanup();
});

test("a workspace rides to the dispatcher with the task", () => {
	const { service, asked, cleanup } = harness([ada]);
	const result = service.create({ text: "x", workspace: "nobody-here" });
	assert.equal(result.state, "open");
	assert.equal(asked[0]?.workspace, "nobody-here");
	cleanup();
});

test("a named agent that is gone is blocked, not a crash", () => {
	const { service, cleanup } = harness([ada]);
	const result = service.create({ text: "x", agentId: "ghost" });
	assert.equal(result.state, "blocked");
	assert.match(result.why, /named for this task is gone/);
	cleanup();
});

test("cancelling removes the task from the queue, so it cannot run later", () => {
	const { queue, service, cleanup } = harness([ada]);
	const result = service.create({ text: "x" });
	placed(service, queue, result.id, ada);
	assert.equal(queue.get("a")?.length, 1);
	const cancel = service.cancel(result.id);
	assert.equal(cancel.cancelled, true);
	assert.equal(queue.get("a")?.length, 0);
	assert.equal(service.get(result.id)?.state, "cancelled");
	cleanup();
});

test("a done task cannot be cancelled — the work already happened", () => {
	const { queue, service, cleanup } = harness([ada]);
	const result = service.create({ text: "x" });
	placed(service, queue, result.id, ada);
	service.taskStarted(result.id);
	service.taskFinished({ taskId: result.id, ok: true, report: "done", boards: ["boards/out.html"] });
	const cancel = service.cancel(result.id);
	assert.equal(cancel.cancelled, false);
	assert.match(cancel.reason ?? "", /done/);
	cleanup();
});

test("a turn reports back: running → done with the result", () => {
	const { queue, service, cleanup } = harness([ada]);
	const result = service.create({ text: "x" });
	placed(service, queue, result.id, ada);
	service.taskStarted(result.id);
	assert.equal(service.get(result.id)?.state, "running");
	service.taskFinished({ taskId: result.id, ok: true, report: "The report", boards: ["boards/a.html"] });
	const task = service.get(result.id);
	assert.equal(task?.state, "done");
	assert.equal(task?.result?.report, "The report");
	assert.deepEqual(task?.result?.boards, ["boards/a.html"]);
	cleanup();
});

test("a task whose turn threw is failed, with the same record", () => {
	const { queue, service, cleanup } = harness([ada]);
	const result = service.create({ text: "x" });
	placed(service, queue, result.id, ada);
	service.taskStarted(result.id);
	service.taskFinished({ taskId: result.id, ok: false, report: "", boards: [] });
	assert.equal(service.get(result.id)?.state, "failed");
	cleanup();
});

test("removing the assigned agent takes the task out of its queue and asks the dispatcher again", () => {
	const { queue, service, roster, asked, cleanup } = harness([ada, bo]);
	const result = service.create({ text: "x", workspace: "political-llm" });
	placed(service, queue, result.id, ada);
	assert.equal(service.get(result.id)?.agentId, "a");
	// The registry removes the row before telling the dashboard, so the roster is the
	// world minus Ada when `agentRemoved` runs.
	roster.splice(0, 1);
	service.agentRemoved("a");
	const task = service.get(result.id);
	assert.equal(task?.state, "open");
	assert.equal(task?.agentId, undefined);
	assert.equal(queue.get("a")?.length, 0);
	assert.equal(asked.length, 2);
	assert.equal(asked[1]?.id, result.id);
	cleanup();
});

test("retry asks the dispatcher again about a blocked task", () => {
	const { service, asked, cleanup } = harness([ada]);
	const blocked = service.create({ text: "x" });
	service.decided({ taskId: blocked.id, sent: false, report: "Not now." });
	assert.equal(service.get(blocked.id)?.state, "blocked");
	const result = service.retry(blocked.id);
	assert.ok("task" in result);
	if ("task" in result) {
		assert.equal(result.task.state, "open");
		assert.match(result.task.why, /dispatcher is deciding/);
	}
	assert.equal(asked.length, 2);
	cleanup();
});

test("retry refuses a running task", () => {
	const { queue, service, cleanup } = harness([ada]);
	const result = service.create({ text: "x" });
	placed(service, queue, result.id, ada);
	service.taskStarted(result.id);
	const retried = service.retry(result.id);
	assert.ok("error" in retried);
	assert.match(retried.error, /running/);
	cleanup();
});

test("a schedule makes a digest task through the same pipeline", () => {
	const { asked, service, cleanup } = harness([ada]);
	const schedule = service.createSchedule({
		name: "Morning digest",
		at: "09:00",
		days: [0, 1, 2, 3, 4, 5, 6],
		workspace: "political-llm",
		kind: "digest",
	});
	if ("error" in schedule) throw new Error(schedule.error);
	// Run now, at a fixed clock so the digest names a deterministic board.
	const outcome = service.runNow(schedule.id);
	if ("error" in outcome) throw new Error(outcome.error);
	// The same pipeline as the bar: open, and asked of the dispatcher with the digest's text.
	assert.equal(outcome.state, "open");
	assert.equal(asked.length, 1);
	assert.match(asked[0]?.text ?? "", new RegExp(digestBoardPath(Date.now()).replace(/\./g, "\\.")));
	assert.equal(asked[0]?.workspace, "political-llm");
	cleanup();
});

test("a custom schedule runs its own words", () => {
	const { asked, service, cleanup } = harness([ada]);
	const schedule = service.createSchedule({
		name: "Weekly tidy",
		at: "18:00",
		days: [5],
		workspace: "political-llm",
		kind: "custom",
		task: "Tidy the boards directory.",
	});
	if ("error" in schedule) throw new Error(schedule.error);
	const outcome = service.runNow(schedule.id);
	if ("error" in outcome) throw new Error(outcome.error);
	assert.equal(asked[0]?.text, "Tidy the boards directory.");
	cleanup();
});

test("a bad schedule is refused with a sentence", () => {
	const { service, cleanup } = harness([ada]);
	const outcome = service.createSchedule({ name: "x", at: "nine", days: [1], workspace: "w", kind: "digest" });
	assert.ok("error" in outcome);
	assert.match(outcome.error, /HH:MM/);
	cleanup();
});

test("a tick runs a due schedule's task through the same pipeline, once", () => {
	const { asked, service, cleanup } = harness([ada]);
	const schedule = service.createSchedule({
		name: "Morning check",
		at: "09:00",
		days: [0, 1, 2, 3, 4, 5, 6],
		workspace: "political-llm",
		kind: "custom",
		task: "Check the inbox.",
	});
	if ("error" in schedule) throw new Error(schedule.error);
	// Backdate the cursor so today's 09:00 is due: the tick's clock is the test's.
	const today = new Date();
	today.setHours(9, 0, 0, 0);
	schedule.lastRunAt = today.getTime() - 24 * 60 * 60 * 1000;
	schedule.nextRunAt = today.getTime();
	service.tick(today.getTime() + 5 * 60 * 1000); // the scheduler looks at 09:05
	assert.equal(asked.length, 1);
	assert.equal(asked[0]?.text, "Check the inbox.");
	assert.equal(schedule.lastRunAt, today.getTime());
	// A second look, before the first task has ended, creates nothing: one in flight is
	// one too many, which is what stops a daily digest from stacking.
	service.tick(today.getTime() + 6 * 60 * 1000);
	assert.equal(asked.length, 1);
	cleanup();
});

test("a tick counts and skips a run from before today, then fires today's", () => {
	const { asked, service, cleanup } = harness([ada]);
	const schedule = service.createSchedule({
		name: "Morning digest",
		at: "09:00",
		days: [0, 1, 2, 3, 4, 5, 6],
		workspace: "political-llm",
		kind: "digest",
	});
	if ("error" in schedule) throw new Error(schedule.error);
	const today = new Date();
	today.setHours(11, 0, 0, 0);
	schedule.lastRunAt = today.getTime() - 2 * 24 * 60 * 60 * 1000; // two mornings ago
	service.tick(today.getTime());
	// Yesterday 09:00 was owed and skipped; today's 09:00 is due. One task, one miss.
	assert.equal(schedule.missed, 1);
	assert.equal(asked.length, 1);
	assert.match(asked[0]?.text ?? "", /digest/);
	cleanup();
});