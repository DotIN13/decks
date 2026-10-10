import assert from "node:assert/strict";
import { test } from "node:test";
import { ClaudeBackend } from "./backend.ts";

/**
 * What a switch does to a running Claude process.
 *
 * On macOS the token is a keychain entry named when the process started, so a switch has to
 * start the process again; measured 2026-10-10, a repointed link alone left the next turn on
 * the old account. The backend is built without a session: only the fields `accountChanged`
 * reads are set, and `restart` is counted rather than run.
 */
function backend(o: { startedOn?: string; now?: string; streaming?: boolean }) {
	const b = Object.create(ClaudeBackend.prototype) as ClaudeBackend;
	let restarts = 0;
	Object.assign(b, {
		context: { account: o.now ? { id: () => o.now } : undefined },
		startedOn: o.startedOn,
		streaming: o.streaming ?? false,
		restartForAccount: false,
		restart: async () => {
			restarts += 1;
		},
	});
	return { b, restarts: () => restarts };
}

function onPlatform(platform: NodeJS.Platform, run: () => void): void {
	const was = Object.getOwnPropertyDescriptor(process, "platform")!;
	Object.defineProperty(process, "platform", { value: platform });
	try {
		run();
	} finally {
		Object.defineProperty(process, "platform", was);
	}
}

test("on macOS an idle chat moved to another account starts again at once", () => {
	onPlatform("darwin", () => {
		const { b, restarts } = backend({ startedOn: "stanford", now: "tiger" });
		b.accountChanged();
		assert.equal(restarts(), 1);
	});
});

test("on macOS a switch during a turn waits for the turn to end", () => {
	onPlatform("darwin", () => {
		const { b, restarts } = backend({ startedOn: "stanford", now: "tiger", streaming: true });
		b.accountChanged();
		assert.equal(restarts(), 0);
		assert.equal((b as unknown as { restartForAccount: boolean }).restartForAccount, true);
	});
});

test("moving back to the account the process started on needs no restart", () => {
	onPlatform("darwin", () => {
		const { b, restarts } = backend({ startedOn: "tiger", now: "tiger" });
		b.accountChanged();
		assert.equal(restarts(), 0);
	});
});

test("elsewhere the link already carries the token, so nothing restarts", () => {
	onPlatform("linux", () => {
		const { b, restarts } = backend({ startedOn: "stanford", now: "tiger" });
		b.accountChanged();
		assert.equal(restarts(), 0);
	});
});
