import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ClientMessage, ServerMessage } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { Revisions } from "../boards/snapshots.ts";
import { DocSync } from "../../../web/src/docs/doc-sync.ts";
import { DocService } from "./service.ts";

/**
 * Two pages and an agent on one file, with the network in between: every message waits in a
 * queue and is delivered in an order a seeded random picks, the way a slow socket and a fast one
 * interleave. Whatever happens, once everything has been delivered both pages and the file must
 * hold the same text.
 */

function random(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

function run(seed: number, steps: number) {
	const rnd = random(seed);
	const root = mkdtempSync(join(tmpdir(), "decks-converge-"));
	const file = join(root, "paper.md");
	writeFileSync(file, "# Title\n\nFirst paragraph of the paper.\n\nSecond paragraph, longer than the first one.\n\nThird.\n");
	const revisions = new Revisions({ path: root, boards: [] } as unknown as Deck);

	// Server -> browsers, one queue per page; browsers -> server, one queue in all.
	const toServer: Array<{ from: number; message: ClientMessage }> = [];
	const inbox: ServerMessage[][] = [[], []];
	const service = new DocService({ roots: () => ({ deck: root, roots: [] }), revisions, send: (m) => inbox.forEach((q) => q.push(m)) });
	const timers: Array<() => void> = [];
	const pages = [0, 1].map(
		(i) =>
			new DocSync({
				path: "paper.md",
				client: `page-${i}`,
				send: (message) => toServer.push({ from: i, message }),
				onUpdate: () => {},
				schedule: (fn) => timers.push(fn),
			}),
	);
	const serve = () => {
		const next = toServer.shift();
		if (!next) return false;
		const m = next.message;
		const reply = (r: ServerMessage) => inbox[next.from]!.push(r);
		if (m.type === "doc.open") reply(service.opened(m.path, m.client));
		else if (m.type === "doc.patch") reply(service.patch(m.path, m.client, m.rev, m.batch, m.splices));
		else if (m.type === "doc.review") service.review(m.path, m.change, m.accept);
		else if (m.type === "doc.close") service.closed(m.path, m.client);
		return true;
	};
	const deliver = (i: number) => {
		const m = inbox[i]!.shift();
		if (!m) return false;
		pages[i]!.receive(m);
		return true;
	};
	const settle = () => {
		for (let guard = 0; guard < 100_000; guard++) {
			while (timers.length) timers.shift()!();
			if (!serve() && !deliver(0) && !deliver(1) && timers.length === 0) return;
		}
		throw new Error("never settled");
	};

	pages.forEach((p) => p.open());
	settle();
	let agentWrites = 0;
	for (let step = 0; step < steps; step++) {
		const roll = rnd();
		if (roll < 0.55) {
			// A keystroke on one page: insert, delete or replace near a random spot.
			const page = pages[rnd() < 0.5 ? 0 : 1]!;
			if (!page.ready) continue;
			const at = Math.floor(rnd() * (page.text.length + 1));
			const kind = rnd();
			if (kind < 0.6 || page.text.length === 0) page.edit({ at, before: "", text: "abcdefghij"[Math.floor(rnd() * 10)]! });
			else {
				const len = Math.min(page.text.length - Math.min(at, page.text.length - 1), 1 + Math.floor(rnd() * 3));
				const from = Math.min(at, page.text.length - len);
				page.edit({ at: from, before: page.text.slice(from, from + len), text: kind < 0.8 ? "" : "XY" });
			}
		} else if (roll < 0.62) {
			// The agent's own tool, straight to the file.
			const now = readFileSync(file, "utf8");
			const at = now.indexOf("\n\n", Math.floor(rnd() * now.length));
			const where = at === -1 ? now.length : at;
			writeFileSync(file, `${now.slice(0, where)}\n\nAgent line ${++agentWrites}.${now.slice(where)}`);
		} else if (roll < 0.66) {
			// A person rejects or accepts whatever change is waiting.
			const page = pages[0]!;
			const change = page.changes[0];
			if (change) rnd() < 0.5 ? page.reject(change.id) : page.accept(change.id);
		} else if (roll < 0.8) {
			if (timers.length) timers.shift()!();
		} else if (roll < 0.9) serve();
		else deliver(rnd() < 0.5 ? 0 : 1);
	}
	// The watcher's quiet has not passed in a test this fast: a last patch asks the disk, as typing would.
	settle();
	pages[0]!.edit({ at: 0, before: "", text: "" });
	pages[0]!.flush();
	settle();
	const disk = readFileSync(file, "utf8");
	service.closeAll();
	rmSync(root, { recursive: true, force: true });
	return { disk, a: pages[0]!.text, b: pages[1]!.text, agentWrites };
}

test("two pages and an agent typing over one another end on the same text as the file", () => {
	for (let seed = 1; seed <= Number(process.env.SEEDS ?? 60); seed++) {
		const { disk, a, b } = run(seed, 400);
		assert.equal(a, disk, `seed ${seed}: page A drifted from the file`);
		assert.equal(b, disk, `seed ${seed}: page B drifted from the file`);
	}
});
