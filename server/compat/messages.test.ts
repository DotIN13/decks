// Every message the canvas library sends on the old line is answered by compat, and every one it hears
// is told by compat on purpose, read from the library's own code; anything else is a listed gap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { GAPS, NOT_THIS_LINE } from "./messages.gaps.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const typesIn = (text: string) => [...text.matchAll(/type: "([a-z]+\.[a-zA-Z.]+)"/g)].map((m) => m[1]!);
const union = (text: string, name: string) => typesIn(text.slice(text.indexOf(`export type ${name} =`), text.indexOf(";\n", text.indexOf(`export type ${name} =`))));

/** What the frame sends on the line: its client message union and the document page's. */
export function sent(): string[] {
	return [...new Set([...union(read("packages/protocol/src/wire.ts"), "LineClientMessage"), ...union(read("canvas/documents/model.ts"), "DocClientMessage")])].sort();
}

/** What the frame hears from the line: the types its code reads, and every document message, which it passes to the page. */
export function heard(): string[] {
	const inside = readdirSync(`${ROOT}canvas/host/inside`).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.")).map((f) => read(`canvas/host/inside/${f}`)).join("\n");
	const read_ = [...inside.matchAll(/message\.type === "([a-z]+\.[a-zA-Z.]+)"/g)].map((m) => m[1]!);
	const docs = inside.includes('startsWith("doc.")') ? union(read("canvas/documents/model.ts"), "DocServerMessage") : [];
	return [...new Set([...read_, ...docs])].filter((t) => t !== "reconnected").sort();
}

const compat = ["line.ts", "events.ts", "docs.ts", "google.ts"].map((f) => read(`server/compat/${f}`)).join("\n");
const answered = (type: string) => compat.includes(`"${type}"`);
const told = (type: string) => compat.includes(`type: "${type}"`);
const gap = (type: string, way: "sent" | "heard") => GAPS.some((g) => g.type === type && g.way === way) || (way === "heard" && NOT_THIS_LINE.includes(type));

test("every message the frame sends on the line is answered, or listed with its owner", () => {
	const silent = sent().filter((t) => !answered(t) && !gap(t, "sent"));
	assert.deepEqual(silent, [], "sent and not answered by server/compat/line.ts");
	assert.ok(sent().length > 10, `read ${sent().length} sent types`);
});

test("every message the frame hears is told by compat on purpose, or listed with its owner", () => {
	const silent = heard().filter((t) => !told(t) && !gap(t, "heard"));
	assert.deepEqual(silent, [], "heard and never told by server/compat (line.ts, events.ts) in its shape");
	assert.ok(heard().length > 5, `read ${heard().length} heard types`);
});

test("a listed gap is still a gap: one handled leaves the list", () => {
	const stale = GAPS.filter((g) => (g.way === "sent" ? answered(g.type) : told(g.type)) || !(g.way === "sent" ? sent() : heard()).includes(g.type));
	assert.deepEqual(stale.map((g) => `${g.way} ${g.type}`), []);
});
