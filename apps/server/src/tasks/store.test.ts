import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "./store.ts";
import type { Schedule, Task } from "@decks/protocol";

function deckDir(): string {
	return mkdtempSync(join(tmpdir(), "tasks-store-"));
}

const task: Task = {
	id: "t1",
	text: "Remeasure the panel",
	boards: ["boards/rows.html"],
	dispatch: { at: 1, outcome: "agent", agentId: "a", agentName: "Ada", why: "Ada is the best fit in political-llm." },
	state: "assigned",
	createdAt: 1,
	updatedAt: 2,
	agentId: "a",
	agentName: "Ada",
};

const schedule: Schedule = {
	id: "s1",
	name: "Morning digest",
	at: "09:00",
	days: [1, 2, 3, 4, 5],
	workspace: "political-llm",
	task: "Write the morning digest.",
	boards: [],
	createdAt: 1,
	lastRunAt: 2,
	nextRunAt: 3,
	missed: 0,
	enabled: true,
};

test("a task and a schedule survive a write and a read", () => {
	const dir = deckDir();
	const store = new TaskStore(dir, () => {});
	store.saveTasks([task]);
	store.saveSchedules([schedule]);
	const again = new TaskStore(dir, () => {});
	assert.deepEqual(again.loadTasks(), [task]);
	assert.deepEqual(again.loadSchedules(), [schedule]);
});

test("a task's message is saved as its own file, verbatim, and the path comes back", () => {
	const dir = mkdtempSync(join(tmpdir(), "tasks-store-"));
	const store = new TaskStore(dir, () => {});
	const path = store.savePrompt({ id: "t-1", text: "Line one\nLine two" });
	assert.equal(path, join(dir, ".decks", "tasks", "t-1.md"));
	assert.equal(readFileSync(path!, "utf8"), "Line one\nLine two\n");
	rmSync(dir, { recursive: true, force: true });
});

test("a missing store reads as empty, and reads are clean of state", () => {
	const dir = deckDir();
	const store = new TaskStore(dir, () => {});
	assert.deepEqual(store.loadTasks(), []);
	assert.deepEqual(store.loadSchedules(), []);
});

test("a corrupt file is kept under a corrupt name, warned about, and read as empty", () => {
	const dir = deckDir();
	const file = join(dir, ".decks", "tasks.json");
	mkdirSync(join(dir, ".decks"), { recursive: true });
	writeFileSync(file, "this is not json", "utf8");
	const warnings: string[] = [];
	const store = new TaskStore(dir, (text) => warnings.push(text));
	assert.deepEqual(store.loadTasks(), []);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0]!, /could not be read/);
	assert.ok(existsSync(`${file}.corrupt-`) || readdirSync(join(dir, ".decks")).some((name) => name.startsWith("tasks.json.corrupt-")));
});

test("a corrupt file never destroys a later save: the fresh store starts a new file", () => {
	const dir = deckDir();
	mkdirSync(join(dir, ".decks"), { recursive: true });
	writeFileSync(join(dir, ".decks", "schedules.json"), "{oops", "utf8");
	const store = new TaskStore(dir, () => {});
	assert.deepEqual(store.loadSchedules(), []);
	store.saveSchedules([schedule]);
	const again = new TaskStore(dir, () => {});
	assert.deepEqual(again.loadSchedules(), [schedule]);
});

test("a store it cannot write to keeps the deck alive: a save throws nothing", () => {
	// A directory with no write permission is the read-only-volume case. The store's
	// job is to keep the deck up; the in-memory list is the source during the run.
	const dir = deckDir();
	chmodSync(dir, 0o500);
	try {
		const store = new TaskStore(dir, () => {});
		store.saveTasks([task]); // must not throw
		const again = new TaskStore(dir, () => {});
		assert.deepEqual(again.loadTasks(), []); // nothing on disk, nothing read
	} finally {
		chmodSync(dir, 0o700);
	}
});

test("a task with a bad state reads as open rather than failing the file", () => {
	const dir = deckDir();
	const store = new TaskStore(dir, () => {});
	store.saveTasks([{ ...task, state: "nonsense" as Task["state"] }]);
	const again = new TaskStore(dir, () => {});
	assert.equal(again.loadTasks()[0]?.state, "open");
});

test("a task's dispatcher id survives a round trip through the file", () => {
	const dir = deckDir();
	const store = new TaskStore(dir, () => {});
	store.saveTasks([{ ...task, dispatcherId: "d-1" }]);
	assert.equal(new TaskStore(dir, () => {}).loadTasks()[0]?.dispatcherId, "d-1", "the reader used to drop it, and the row lost its log after a restart");
});

test("a schedule stored as a digest, with no text, is kept as the task it meant", () => {
	const dir = deckDir();
	mkdirSync(join(dir, ".decks"), { recursive: true });
	const { task: _text, ...old } = schedule;
	writeFileSync(join(dir, ".decks", "schedules.json"), JSON.stringify({ version: 1, schedules: [{ ...old, kind: "digest" }] }), "utf8");
	const [read] = new TaskStore(dir, () => {}).loadSchedules();
	assert.match(read?.task ?? "", /digest board/);
	assert.equal("kind" in (read ?? {}), false);
});
