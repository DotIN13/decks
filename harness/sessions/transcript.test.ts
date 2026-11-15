// The transcript kept in the harness's folder, and paging back through its archive.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatItem } from "../runtimes/types/index.ts";
import { Transcripts } from "./transcript.ts";

const item = (n: number): ChatItem => ({ kind: "notice", id: `n${n}`, level: "info", text: String(n), at: n }) as ChatItem;

test("the transcript is kept in the harness's folder and pages back through the archive", () => {
	const home = mkdtempSync(join(tmpdir(), "helm-"));
	try {
		const t = new Transcripts(home);
		t.archive("a", [item(1), item(2), item(3)]);
		const current = [item(4), item(5)];
		t.write({ id: "a", kind: "pi", token: "tok", items: current });
		assert.equal(t.read("a")!.token, "tok");
		assert.deepEqual(t.page("a", current, undefined, 10).map((i) => i.id), ["n4", "n5"], "the window first");
		assert.deepEqual(t.page("a", current, "n4", 2).map((i) => i.id), ["n2", "n3"], "then older, newest last");
		assert.equal(t.find("a", current, "n1")?.id, "n1");
		assert.ok(t.dir.startsWith(home));
		t.forget("a");
		assert.equal(t.read("a"), undefined);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
