import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, watch } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { dirname, join, resolve, sep } from "node:path";

// Where an app builds and runs on this machine (its copy, or its folder outside the deck): its
// files, its commands and its processes. The feature's only module on node:fs; it never writes the deck.

export type Output = (text: string) => void;

export class AppFolders {
	private outside = new Map<string, string>();

	constructor(readonly workdir: string) {}

	// Where the app builds and runs
	/** Where the app builds and runs: its source folder outside the deck, else its copy here. */
	folder(name: string): string {
		return this.outside.get(name) ?? join(this.workdir, name);
	}

	/** Say that an app's source lives in a folder outside the deck, or (undefined) in the deck. */
	place(name: string, outside: string | undefined): void {
		if (outside) this.outside.set(name, outside);
		else this.outside.delete(name);
	}

	isOutside(name: string): boolean {
		return this.outside.has(name);
	}

	/** A path inside the running copy, or undefined when it climbs out or is hidden. */
	inside(name: string, path: string): string | undefined {
		const root = this.folder(name);
		const target = resolve(root, `.${path.startsWith("/") ? path : `/${path}`}`);
		if (target !== root && !target.startsWith(root + sep)) return undefined;
		if (target.slice(root.length).split(sep).some((part) => part.startsWith("."))) return undefined;
		return target;
	}

	// Its files
	/** Whether a folder exists, and how many names it holds. */
	async look(folder: string): Promise<{ exists: boolean; entries: number }> {
		const names = await readdir(folder).catch(() => undefined);
		return { exists: names !== undefined, entries: names?.length ?? 0 };
	}

	async read(name: string, path: string): Promise<Uint8Array | undefined> {
		const file = this.inside(name, path);
		if (!file) return undefined;
		return readFile(file).then((buf) => new Uint8Array(buf), () => undefined);
	}

	async isFile(name: string, path: string): Promise<boolean> {
		const file = this.inside(name, path);
		return file ? stat(file).then((s) => s.isFile(), () => false) : false;
	}

	async isDir(name: string, path: string): Promise<boolean> {
		const file = this.inside(name, path);
		return file ? stat(file).then((s) => s.isDirectory(), () => false) : false;
	}

	/** Every file of the copy, by path inside it, leaving out hidden parts and node_modules. */
	async files(name: string): Promise<string[]> {
		const root = this.folder(name);
		const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
		return entries
			.filter((one) => one.isFile())
			.map((one) => join(one.parentPath, one.name).slice(root.length + 1).split(sep).join("/"))
			.filter((path) => !path.split("/").some((part) => part.startsWith(".") || part === "node_modules"))
			.sort();
	}

	/** Write a file of the copy only when its bytes differ; answers whether it wrote. */
	async put(name: string, path: string, bytes: Uint8Array): Promise<boolean> {
		const file = this.inside(name, path);
		if (!file) return false;
		const was = await readFile(file).catch(() => undefined);
		if (was && Buffer.compare(was, Buffer.from(bytes)) === 0) return false;
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, bytes);
		return true;
	}

	/** Remove a file of the copy, when its deck file went. */
	async drop(name: string, path: string): Promise<void> {
		const file = this.inside(name, path);
		if (file && !this.isOutside(name)) await rm(file, { force: true });
	}

	/** Remove the copy, as when an app is deleted. */
	remove(name: string): Promise<void> {
		return rm(this.folder(name), { recursive: true, force: true });
	}

	/** Hear writes under a folder of the app's copy; answers how to stop. */
	watchCopy(name: string, sub: string, hear: (path: string) => void): () => void {
		const root = join(this.workdir, name);
		let watcher: ReturnType<typeof watch> | undefined;
		try {
			mkdirSync(join(root, sub), { recursive: true });
			watcher = watch(join(root, sub), { recursive: true }, (_kind, file) => file && hear(`${sub}/${String(file).split(sep).join("/")}`));
			watcher.on("error", () => watcher?.close());
		} catch {
			watcher = undefined;
		}
		return () => watcher?.close();
	}

	// Its commands
	/** The environment of an app's commands: this process's, with no secret and no NODE_ENV=production. */
	env(extra: Record<string, string>): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = {};
		for (const [key, value] of Object.entries(process.env)) if (!secretEnv(key)) env[key] = value;
		if (env.NODE_ENV === "production") delete env.NODE_ENV;
		return { ...env, ...extra };
	}

	/** Start a command in the copy, in a process group of its own. */
	spawn(name: string, command: string, env: Record<string, string>, out: Output): ChildProcess {
		const child = spawn("bash", ["-lc", command], { cwd: this.folder(name), env: this.env(env), stdio: ["ignore", "pipe", "pipe"], detached: true });
		child.stdout?.on("data", (chunk: Buffer) => out(chunk.toString()));
		child.stderr?.on("data", (chunk: Buffer) => out(chunk.toString()));
		return child;
	}

	/** Run a command to its end; answers its exit code. */
	async exec(name: string, command: string, env: Record<string, string>, out: Output): Promise<number> {
		await mkdir(this.folder(name), { recursive: true });
		out(`$ ${command}`);
		return new Promise((done) => {
			const child = this.spawn(name, command, env, out);
			child.on("error", (error) => {
				out(`error: ${error.message}`);
				done(1);
			});
			child.on("close", (code) => done(code ?? 1));
		});
	}
}

// Its processes, and what they inherit
const SECRET = /^(?:ANTHROPIC_|CLAUDE_|OPENAI_|GEMINI_|AWS_)|^(?:GOOGLE_API_KEY|GH_TOKEN|GITHUB_TOKEN|DECKS_STUDIO_KEY)$|_(?:TOKEN|SECRET|API_KEY|KEY|PASSWORD)$/i;
const DECKS_OWN = /^DECKS_/;

/** Whether an environment variable's name says it holds a secret an app is not given. */
export const secretEnv = (name: string): boolean => SECRET.test(name) || DECKS_OWN.test(name);

/** Stop a process and its whole group: TERM, then KILL after 3 s. */
export function kill(child: ChildProcess): void {
	const group = child.pid;
	const send = (signal: NodeJS.Signals) => {
		try {
			if (group) process.kill(-group, signal);
		} catch {
			child.kill(signal);
		}
	};
	send("SIGTERM");
	setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null) send("SIGKILL");
	}, 3000).unref();
}

/** A port nobody listens on, from the system. */
export function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const server = createServer();
		server.unref();
		server.on("error", fail);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => done(port));
		});
	});
}

/** Whether something listens on the port before the time is up or gone() says the process ended. */
export async function listening(port: number, ms: number, gone: () => boolean): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end && !gone()) {
		const open = await new Promise<boolean>((done) => {
			const socket = connect(port, "127.0.0.1");
			socket.once("connect", () => {
				socket.destroy();
				done(true);
			});
			socket.once("error", () => done(false));
		});
		if (open) return true;
		await new Promise((r) => setTimeout(r, 120));
	}
	return false;
}
