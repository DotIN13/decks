import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../kernel/store.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";

// Rule 18: today's forwarded ports and app logs, carried into the store when a deck is opened.

const put = (store: MemoryStore, key: string, text: string) => store.put(key, new TextEncoder().encode(text));

test("rule 18: today's ports.json and each app's log are kept in the store", async () => {
	const old = new MemoryStore();
	await put(old, "ports.json", JSON.stringify([{ port: 3029, label: "preview", by: "Herobrine", at: 1 }]));
	await put(old, "apps/review.log", "$ npm start\nlistening on 4000\n");
	await put(old, "apps/review.built", "2026-11-01\n");
	const s = await testServer({ features: features(), old, deck: { "apps/review/app.json": '{"kind":"static"}' } });
	const ports = await s.value<{ port: number; label: string; stripped: string }[]>("port.list");
	assert.deepEqual(ports.map((one) => [one.port, one.label, one.stripped]), [[3029, "preview", "/rnode/localhost/3029/"]]);
	assert.deepEqual(await s.value("app.logs", { name: "review" }, callers.agent("ann")), ["$ npm start", "listening on 4000"]);
	await s.close();
});
