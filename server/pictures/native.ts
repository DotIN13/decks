import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { FontNeed } from "@decks/protocol/fonts";
import { fileURLToPath } from "node:url";

// The engine's native screenshot tool (rule 17): one JSON request a line on its
// stdin, one answer a line on stdout. Kept running, stopped ten minutes after its last picture.

const ANSWER_MS = 30_000;
const IDLE_MS = 10 * 60_000;

export type Answer = { ok: boolean; error?: string; fontNeeds?: FontNeed[]; needs?: { cards: string[]; pictures: string[]; icons: string[]; math: string[] }; problems?: string[]; file?: string; width?: number; height?: number };

/** The release binary: DECKS_NATIVE_SHOT, else the engine crate's own build. */
export function nativeBinary(): string | undefined {
	const named = process.env.DECKS_NATIVE_SHOT;
	if (named) return existsSync(named) ? named : undefined;
	const built = resolve(dirname(fileURLToPath(import.meta.url)), "../../engine/target/release/stage-shot");
	return existsSync(built) ? built : undefined;
}

export class Native {
	private child: ChildProcessWithoutNullStreams | undefined;
	private ready: Promise<void> | undefined;
	private waiting = new Map<number, (answer: Answer) => void>();
	private next = 1;
	private idle: ReturnType<typeof setTimeout> | undefined;
	broken: string | undefined;

	constructor(readonly binary: string) {}

	/** Ask once; a failure answers { ok: false, error }. */
	async ask(message: Record<string, unknown>): Promise<Answer> {
		try {
			await this.start();
		} catch (error) {
			return { ok: false, error: (error as Error).message };
		}
		const child = this.child!;
		const id = this.next++;
		clearTimeout(this.idle);
		const answer = await new Promise<Answer>((done) => {
			const timer = setTimeout(() => {
				this.waiting.delete(id);
				child.kill("SIGKILL");
				done({ ok: false, error: `no answer in ${ANSWER_MS / 1000} s` });
			}, ANSWER_MS);
			this.waiting.set(id, (got) => (clearTimeout(timer), done(got)));
			child.stdin.write(`${JSON.stringify({ ...message, id })}\n`);
		});
		this.idle = setTimeout(() => this.stop(), IDLE_MS);
		this.idle.unref();
		return answer;
	}

	private start(): Promise<void> {
		if (this.broken) return Promise.reject(new Error(this.broken));
		if (this.child && this.ready) return this.ready;
		const child = spawn(this.binary, [], { stdio: ["pipe", "pipe", "pipe"] });
		this.child = child;
		let buffered = "";
		this.ready = new Promise<void>((started, failed) => {
			const end = (why: string) => {
				if (this.child !== child) return;
				this.child = undefined;
				this.ready = undefined;
				failed(new Error(why));
				for (const one of this.waiting.values()) one({ ok: false, error: why });
				this.waiting.clear();
			};
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => {
				buffered += chunk;
				for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
					const line = buffered.slice(0, at);
					buffered = buffered.slice(at + 1);
					let message: (Answer & { id?: number; ready?: boolean }) | undefined;
					try {
						message = JSON.parse(line);
					} catch {
						continue;
					}
					if (message?.ready === true) started();
					else if (message?.ready === false) (this.broken = `it cannot draw on this machine: ${message.error}`), end(this.broken);
					else if (typeof message?.id === "number") this.waiting.get(message.id)?.(message), this.waiting.delete(message.id);
				}
			});
			child.stderr.on("data", () => {});
			child.on("error", (error) => ((this.broken = `it would not start: ${error.message}`), end(this.broken)));
			child.on("exit", (code, signal) => end(`it stopped (${signal ?? code})`));
		});
		return this.ready;
	}

	stop(): void {
		clearTimeout(this.idle);
		const child = this.child;
		this.child = undefined;
		this.ready = undefined;
		child?.stdin.end();
		child?.kill();
	}
}
