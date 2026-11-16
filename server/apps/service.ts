import type { ChildProcess } from "node:child_process";
import { toDeckPath, type Deck, type Store } from "../kernel/index.ts";
import { Logs } from "./logs.ts";
import { freePort, kill, listening, AppFolders } from "./folders.ts";
import { folderOf, manifestOf, sourceFiles, type Manifest } from "./manifest.ts";

// Apps built and run: their state, their jobs and their processes. Rules 2 to 5.

export type AppStatus = "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken" | "missing";
export type Kept = { status?: AppStatus; port?: number; error?: string; at?: number; seenAt?: number; seen?: number };
type Running = { child: ChildProcess; port: number; ready: Promise<boolean>; unwatch?: () => void };

export const WAIT_MS = 15_000;
const START_MS = 45_000;
const IDLE_MINUTES = 10;

export type AppsOptions = { workdir: string; env?: (name: string) => Record<string, string>; clock?: () => number };

export class Apps {
	readonly folders: AppFolders;
	readonly logs: Logs;
	private kept = new Map<string, Kept>();
	private running = new Map<string, Running>();
	private jobs = new Map<string, Promise<boolean>>();
	private clock: () => number;
	onChange?: (name: string) => void;

	constructor(private deck: Deck, store: Store, private options: AppsOptions) {
		this.folders = new AppFolders(options.workdir);
		this.logs = new Logs(store);
		this.clock = options.clock ?? Date.now;
	}

	// What an app is now
	/** The app's manifest, with where it builds and runs told to the machine. Rule 14. */
	async manifest(name: string): Promise<Manifest> {
		const manifest = await manifestOf(this.deck, name);
		this.folders.place(name, manifest.source?.path);
		return manifest;
	}

	/** What happened to an app, merged with what it is when nothing has. */
	async stateOf(name: string, manifest: Manifest): Promise<Kept & { status: AppStatus }> {
		const kept = this.kept.get(name) ?? {};
		if (manifest.source && !(await this.folders.look(manifest.source.path)).exists) return { ...kept, status: "missing" };
		return { ...kept, status: kept.status ?? (await this.idleStatus(name, manifest)) };
	}

	private async idleStatus(name: string, manifest: Manifest): Promise<AppStatus> {
		if (manifest.kind === "server") return "stopped";
		if (manifest.kind === "build") return (await this.folders.isDir(name, manifest.root ?? "dist")) ? "running" : "stopped";
		return "running";
	}

	set(name: string, patch: Kept): void {
		const was = this.kept.get(name) ?? {};
		const next: Kept = { ...was, ...patch };
		for (const key of Object.keys(patch) as (keyof Kept)[]) if (patch[key] === undefined) delete next[key];
		this.kept.set(name, next);
		if (was.status !== next.status) this.onChange?.(name);
	}

	seen(name: string): void {
		if (this.kept.has(name) || this.running.has(name)) this.set(name, { seenAt: this.clock() });
	}

	isRunning(name: string): boolean {
		return this.running.has(name);
	}

	// Building and running
	/** Install and build as the manifest says. A second call joins the first. */
	build(name: string): Promise<boolean> {
		return this.job(name, async () => this.runBuild(name, await this.manifest(name)));
	}

	/** Start a server app, building it first when it needs it; any other kind is built. */
	async run(name: string): Promise<boolean> {
		const manifest = await this.manifest(name);
		if (manifest.kind !== "server") return this.build(name);
		const live = this.running.get(name);
		if (live) {
			this.seen(name);
			return live.ready;
		}
		return this.job(name, async () => {
			if (!(await this.runBuild(name, manifest))) return false;
			return this.start(name, manifest);
		});
	}

	/** The port a server app answers on, starting it when it sleeps. */
	async portFor(name: string): Promise<number | undefined> {
		const live = this.running.get(name);
		if (live) {
			this.seen(name);
			return (await live.ready) ? live.port : undefined;
		}
		return (await this.run(name)) ? this.running.get(name)?.port : undefined;
	}

	private job(name: string, work: () => Promise<boolean>): Promise<boolean> {
		const had = this.jobs.get(name);
		if (had) return had;
		const job = work()
			.catch((error: Error) => this.failed(name, error.message))
			.finally(() => {
				this.jobs.delete(name);
				void this.logs.save();
			});
		this.jobs.set(name, job);
		return job;
	}

	private failed(name: string, error: string): false {
		this.logs.write(name, `error: ${error}`);
		this.set(name, { status: "broken", error: error.split("\n")[0]!.slice(0, 300), at: this.clock() });
		return false;
	}

	private async runBuild(name: string, manifest: Manifest): Promise<boolean> {
		const t0 = this.clock();
		if (manifest.source && !(await this.folders.look(manifest.source.path)).exists) {
			return this.failed(name, `${manifest.source.path} is not on this machine; app.clone takes it from ${manifest.source.repo ?? "its repository"}.`);
		}
		await this.sync(name);
		const out = (text: string) => this.logs.write(name, text);
		if ((await this.needsInstall(name)) && !(await this.folders.isDir(name, "node_modules"))) {
			this.set(name, { status: "installing", error: undefined });
			const install = manifest.install ?? "npm install --include=dev --no-audit --no-fund";
			const code = await this.folders.exec(name, install, this.env(name), out);
			if (code !== 0) return this.failed(name, `${install} exited with code ${code}`);
		}
		const command = manifest.build ?? (manifest.kind === "build" ? "npm run build" : undefined);
		if (command) {
			this.set(name, { status: "building", error: undefined });
			const code = await this.folders.exec(name, command, this.env(name), out);
			if (code !== 0) return this.failed(name, `${command} exited with code ${code}`);
		}
		if (manifest.kind === "build" && !(await this.folders.isDir(name, manifest.root ?? "dist"))) {
			return this.failed(name, `the build wrote no ${manifest.root ?? "dist"}/ folder to serve`);
		}
		const status: AppStatus = manifest.kind === "server" ? (this.running.has(name) ? "running" : "stopped") : "running";
		this.set(name, { status, at: this.clock(), error: undefined });
		out(`built in ${((this.clock() - t0) / 1000).toFixed(1)} s`);
		return true;
	}

	/** Copy the source into the running copy, writing only what differs. Rule 2. */
	async sync(name: string): Promise<number> {
		let wrote = 0;
		if (this.folders.isOutside(name)) return 0;
		for (const file of await sourceFiles(this.deck, name)) {
			const bytes = await this.deck.read(toDeckPath(`${folderOf(name)}/${file.path}`));
			if (await this.folders.put(name, file.path, bytes)) wrote += 1;
		}
		return wrote;
	}

	private async needsInstall(name: string): Promise<boolean> {
		const bytes = await this.folders.read(name, "package.json");
		if (!bytes) return false;
		try {
			const pkg = JSON.parse(new TextDecoder().decode(bytes)) as { dependencies?: object; devDependencies?: object };
			return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
		} catch {
			return true;
		}
	}

	private env(name: string, extra: Record<string, string> = {}): Record<string, string> {
		return { BASE_PATH: `/app/${name}`, DECKS_APP: name, ...(this.options.env?.(name) ?? {}), ...extra };
	}

	private async start(name: string, manifest: Manifest): Promise<boolean> {
		const command = manifest.start ?? ((await this.folders.isFile(name, "package.json")) ? "npm start" : undefined);
		if (!command) return this.failed(name, `apps/${name}/app.json has no "start" command`);
		const port = await freePort();
		this.set(name, { status: "starting", port, error: undefined, seenAt: this.clock() });
		this.logs.write(name, `$ ${command}    (PORT=${port})`);
		const child = this.folders.spawn(name, command, this.env(name, { PORT: String(port), HOST: "127.0.0.1", HOSTNAME: "127.0.0.1" }), (text) => this.logs.write(name, text));
		let gone = false;
		const ready = listening(port, START_MS, () => gone);
		const live: Running = { child, port, ready };
		this.running.set(name, live);
		this.keepData(name, live, manifest.data ?? "data");
		child.on("exit", (code, signal) => {
			gone = true;
			live.unwatch?.();
			if (this.running.get(name) !== live) return;
			this.running.delete(name);
			this.failed(name, `the server exited (${signal ?? `code ${code}`})`);
		});
		const ok = await ready;
		if (this.running.get(name) !== live) return false;
		if (!ok) {
			this.stop(name);
			return this.failed(name, `nothing listened on port ${port} within ${START_MS / 1000} s`);
		}
		this.set(name, { status: "running", at: this.clock() });
		return true;
	}

	// Its data folder kept in the deck
	/** An in-deck app's data folder (rule 2) is the deck's: what the app writes there in its copy is
	 *  written to the deck, and what a call writes there in the deck reaches the copy, while it runs. */
	private keepData(name: string, live: Running, data: string): void {
		if (this.folders.isOutside(name)) return;
		const by = { kind: "app" as const, id: name, name };
		const folder = `${folderOf(name)}/${data}/`;
		const toDeck = this.folders.watchCopy(name, data, (path) => void this.backToDeck(name, path, by));
		const fromDeck = this.deck.watch((change) => {
			if (!change.path.startsWith(folder) || change.by === name) return;
			const inner = change.path.slice(folderOf(name).length + 1);
			if (change.kind === "deleted") void this.folders.drop(name, inner);
			else void this.deck.read(change.path).then((bytes) => this.folders.put(name, inner, bytes)).catch(() => {});
		});
		live.unwatch = () => (toDeck(), fromDeck());
	}

	private async backToDeck(name: string, path: string, by: { kind: "app"; id: string; name: string }): Promise<void> {
		const at = toDeckPath(`${folderOf(name)}/${path}`);
		const bytes = await this.folders.read(name, path);
		if (!bytes) return void (await this.deck.remove(at, by).catch(() => {}));
		const had = await this.deck.read(at).catch(() => undefined);
		if (had && Buffer.compare(Buffer.from(had), Buffer.from(bytes)) === 0) return;
		await this.deck.write(at, bytes, by).catch(() => {});
	}

	// Stopping
	/** Stop a server app's process group; answers whether one was running. */
	stop(name: string, status: AppStatus = "stopped"): boolean {
		const live = this.running.get(name);
		if (!live) {
			if (this.kept.get(name)?.status === "asleep") this.set(name, { status });
			return false;
		}
		this.running.delete(name);
		this.set(name, { status, port: undefined });
		live.unwatch?.();
		kill(live.child);
		this.logs.write(name, status === "asleep" ? "asleep: not seen for a while; the next request starts it again" : "stopped");
		return true;
	}

	/** Put to sleep every server app unseen for its idleMinutes. Rule 5. */
	async sleepUnseen(): Promise<void> {
		for (const name of [...this.running.keys()]) {
			const minutes = (await this.manifest(name).catch(() => undefined))?.idleMinutes ?? IDLE_MINUTES;
			if (this.clock() - (this.kept.get(name)?.seenAt ?? 0) > minutes * 60_000) this.stop(name, "asleep");
		}
	}

	forget(name: string): Promise<void> {
		this.stop(name);
		this.kept.delete(name);
		return this.logs.forget(name);
	}

	stopAll(): void {
		for (const name of [...this.running.keys()]) this.stop(name);
		void this.logs.save();
	}
}
