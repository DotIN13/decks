import assert from "node:assert/strict";
import { test } from "node:test";
import type { Draft } from "./draft.ts";
import { DRAFTS_KEY, DRAFTS_LIMIT, pageKey, parkedDrafts, reconcilePills } from "./parked.ts";

const memory = () => {
	const held = new Map<string, string>();
	return { held, getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), removeItem: (key: string) => void held.delete(key) };
};
const words = (text: string): Draft => [{ type: "text", text }];
const pill = (id: string) => ({ type: "mention" as const, kind: "comment" as const, id, label: `“${id}”` });

test("Home is one page and each agent's stage is one, whoever is behind the bar", () => {
	assert.equal(pageKey("dispatch", "dispatcher-pi"), "home");
	assert.equal(pageKey("dispatch", "dispatcher-claude"), "home", "choosing the dispatcher's runtime does not change the page");
	assert.equal(pageKey("stage", "a1"), "agent:a1");
	assert.equal(pageKey("stage", undefined), "agent:none");
});

test("each page keeps its own draft, and a reload reads them back", () => {
	const store = memory();
	const drafts = parkedDrafts(store);
	drafts.set("home", words("a task, half written"));
	drafts.set("agent:a1", [...words("see "), pill("c1")]);
	assert.deepEqual(drafts.get("home"), words("a task, half written"));
	const again = parkedDrafts(store);
	assert.deepEqual(again.get("home"), words("a task, half written"));
	assert.deepEqual(again.get("agent:a1"), [...words("see "), pill("c1")]);
	assert.equal(again.get("agent:a2"), undefined);
});

test("a sent or cleared draft is forgotten, and nothing at all is nothing stored", () => {
	const store = memory();
	const drafts = parkedDrafts(store);
	drafts.set("home", words("x"));
	drafts.set("home", words("  "));
	assert.equal(drafts.get("home"), undefined);
	assert.equal(store.held.has(DRAFTS_KEY), false);
});

test("the oldest pages go once there are too many, and a broken store is an empty one", () => {
	const store = memory();
	const drafts = parkedDrafts(store);
	for (let i = 0; i <= DRAFTS_LIMIT; i++) drafts.set(`agent:${i}`, words(`draft ${i}`), i);
	assert.equal(drafts.get("agent:0"), undefined);
	assert.deepEqual(drafts.get(`agent:${DRAFTS_LIMIT}`), words(`draft ${DRAFTS_LIMIT}`));
	store.held.set(DRAFTS_KEY, "{not json");
	assert.equal(parkedDrafts(store).get("home"), undefined);
	assert.equal(parkedDrafts(undefined).get("home"), undefined);
});

test("a restored draft agrees with the comments still waiting", () => {
	const draft: Draft = [...words("see "), pill("gone"), ...words(" and "), pill("c1")];
	assert.deepEqual(reconcilePills(draft, ["c1", "c2"], pill), [...words("see  and "), pill("c1"), ...words(" "), pill("c2")]);
	assert.deepEqual(reconcilePills([], ["c1"], pill), [pill("c1")]);
	assert.deepEqual(reconcilePills(words("plain"), [], pill), words("plain"));
});

test("two tabs typing on different pages do not write over each other", () => {
	const store = memory();
	const one = parkedDrafts(store);
	const two = parkedDrafts(store);
	one.set("home", words("typed in the first tab"), 1);
	two.set("agent:a1", words("typed in the second"), 2);
	assert.deepEqual(parkedDrafts(store).get("home"), words("typed in the first tab"));
	assert.deepEqual(parkedDrafts(store).get("agent:a1"), words("typed in the second"));
});
