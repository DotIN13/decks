import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LOCK_FILE, type Infer, type wire } from "../../protocol/index.ts";

// The lock file clients find a running server by: <deck>/.decks/server.json,
// readable by this user only, holding the person's token. A second server on
// the same deck is refused while the first one's process lives.

export type Lock = Infer<typeof wire.Lock>;

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

export async function readLock(root: string): Promise<Lock | undefined> {
	try {
		return JSON.parse(await readFile(join(root, LOCK_FILE), "utf8")) as Lock;
	} catch {
		return undefined;
	}
}

/** Refuses if another live server holds this deck. */
export async function checkLock(root: string): Promise<void> {
	const held = await readLock(root);
	if (held && alive(held.pid)) throw new Error(`Another server is serving this deck at ${held.url} (process ${held.pid}).`);
}

/** Writes the lock, user-only; the answer takes it back if it is still ours. */
export async function takeLock(root: string, lock: Lock): Promise<() => Promise<void>> {
	await checkLock(root);
	const file = join(root, LOCK_FILE);
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	await writeFile(file, `${JSON.stringify(lock, null, "\t")}\n`, { mode: 0o600 });
	await chmod(file, 0o600);
	return async () => {
		const now = await readLock(root);
		if (now?.pid === lock.pid && now.started === lock.started) await rm(file, { force: true });
	};
}
