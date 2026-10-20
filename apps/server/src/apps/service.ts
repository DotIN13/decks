import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { TokenStore } from "../auth/tokens.ts";

/** The SDK a server app imports to call Decks' verbs (`packages/sdk`), told to it as `DECKS_SDK`. */
export const SDK_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../packages/sdk/src/index.js");

/**
 * Apps an agent builds, each a folder in the deck's `apps/` (DESIGN: the app ladder).
 *
 * An app climbs a ladder only as far as it has to. A **board** is one HTML file and needs none
 * of this. A **static** app is a folder of files served as they are. A **build** app has a
 * `package.json` whose build writes a folder of files, which are then served the same way. A
 * **server** app is any program that listens on the `PORT` it is given; Decks starts it, sends it
 * the requests for its address, and stops it when nobody has looked at it for a while, starting it
 * again on the next request.
 *
 * Every app is reached at `/app/<name>/` on Decks' own address (`http.ts`), and shown on the canvas
 * as a board that is the app (`boards/apps/<name>.html`, drawn by `lib/live-app.js`). The folder is
 * the agent's: it writes the files with its own tools. `app.json` says which rung it is on:
 *
 *     { "title": "Trip planner", "kind": "server", "start": "node server.js" }
 *
 * The processes are this server's children. A restart of Decks stops them all, and each starts
 * again when it is next asked for, which is what a sleeping app does anyway.
 */

export type AppKind = "static" | "build" | "server";
export type AppStatus = "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken";

export interface AppManifest {
	title?: string;
	kind: AppKind;
	/** What is served, for `static` and `build`: the folder itself, or the build's output (`dist`). */
	root?: string;
	/** Run before a build when there is a `package.json`; devDependencies included, whatever `NODE_ENV` says. */
	install?: string;
	/** For `build`, and for a `server` that needs one first (Next.js). */
	build?: string;
	/** For `server`: a command that listens on `$PORT`. */
	start?: string;
	/**
	 * Whether the server sees the whole path, `/app/<name>/…`, rather than the path inside the app.
	 * For a framework that is told its base path (Next.js `basePath`, Vite `--base`), which Decks
	 * also passes as `BASE_PATH`. Most servers think they are at the root, and get the path inside.
	 */
	prefix?: boolean;
	/** Minutes unseen before a server app is put to sleep. */
	idleMinutes?: number;
}

export interface AppState {
	name: string;
	title: string;
	kind: AppKind;
	status: AppStatus;
	/** Where it is reached, on Decks' own address. */
	url: string;
	/** The board that shows it. */
	board: string;
	port?: number;
	/** What went wrong, in a line, when it is broken. */
	error?: string;
	/** When its board was last seen or it last answered a request. */
	seenAt?: number;
	/** When the last install, build or start finished. */
	at?: number;
	/**
	 * What the board would show if it loaded the app now, as a number that changes when that does:
	 * a static app's newest file, a built app's last build, a server app's last start. The board
	 * loads the app again when it changes, so an agent's edit shows without anyone pressing Reload.
	 */
	version?: number;
	/**
	 * Something the person should know about a running server app: that it listens on more than
	 * this Mac's loopback, where anyone on the network can reach it without Decks in the way.
	 */
	warning?: string;
}

/** What a build or a start answers with: how it went, and the lines worth reading. */
export interface AppOutcome {
	ok: boolean;
	status: AppStatus;
	ms: number;
	/** The lines that look like errors, last first-to-last, at most twenty. */
	errors: string[];
	/** Still going after the wait: ask again with `decks.apps.status`. */
	pending?: true;
}

export const APP_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
const LOG_LINES = 600;
const START_MS = 45_000;
const IDLE_MINUTES = 10;

interface Running {
	child: ChildProcess;
	port: number;
	ready: Promise<boolean>;
	/** The id of the token it was started with, taken back when it stops (`auth/tokens.ts`). */
	token?: string;
}

/** An install, a build or a start in progress, which a second call joins rather than repeating. */
type Job = Promise<AppOutcome>;

export class Apps {
	private readonly states = new Map<string, Omit<AppState, "name" | "title" | "kind" | "url" | "board">>();
	private readonly logs = new Map<string, string[]>();
	private readonly running = new Map<string, Running>();
	private readonly jobs = new Map<string, Job>();
	private readonly writes = new Map<string, number>();
	private sweep: ReturnType<typeof setInterval> | undefined;
	/**
	 * The harness's tokens (`auth/tokens.ts`), set by `app.ts`: a server app is given an `app` token as
	 * `DECKS_TOKEN` when it starts, and it is taken back when the app stops or exits. Build and install
	 * commands are given none.
	 */
	tokens: Pick<TokenStore, "issue" | "revoke"> | undefined;
	/** Decks' own port, set by `app.ts`, so a server app is told where to call back for stage code. */
	decksPort: number | undefined;

	constructor(private deckPath: string) {
		this.sweep = setInterval(() => this.sleepUnseen(), 60_000);
		this.sweep.unref?.();
		process.once("exit", () => this.stopAll());
	}

	setDeck(deckPath: string): void {
		this.stopAll();
		this.deckPath = deckPath;
	}

	get root(): string {
		return join(this.deckPath, "apps");
	}

	folder(name: string): string {
		if (!APP_NAME.test(name)) throw new Error(`An app's name is lower-case letters, digits and dashes, as in "trip-planner"; not ${JSON.stringify(name)}.`);
		return join(this.root, name);
	}

	exists(name: string): boolean {
		return APP_NAME.test(name) && existsSync(join(this.folder(name), "app.json"));
	}

	manifest(name: string): AppManifest {
		const file = join(this.folder(name), "app.json");
		if (!existsSync(file)) throw new Error(`There is no app called ${name}: apps/${name}/app.json is missing.`);
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(file, "utf8"));
		} catch (error) {
			throw new Error(`apps/${name}/app.json is not JSON: ${(error as Error).message}`);
		}
		const read = (raw ?? {}) as Record<string, unknown>;
		const kind = read.kind === "build" || read.kind === "server" ? read.kind : "static";
		const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
		const manifest: AppManifest = { kind };
		const title = text(read.title);
		if (title) manifest.title = title;
		for (const field of ["root", "install", "build", "start"] as const) {
			const value = text(read[field]);
			if (value) manifest[field] = value;
		}
		if (read.prefix === true) manifest.prefix = true;
		if (typeof read.idleMinutes === "number" && read.idleMinutes > 0) manifest.idleMinutes = read.idleMinutes;
		return manifest;
	}

	list(): AppState[] {
		if (!existsSync(this.root)) return [];
		return readdirSync(this.root)
			.filter((name) => this.exists(name))
			.sort()
			.map((name) => this.state(name));
	}

	state(name: string): AppState {
		const manifest = this.manifest(name);
		const kept = this.states.get(name) ?? { status: this.idleStatus(name, manifest) };
		const version = this.version(name, manifest, kept.at);
		return { name, title: manifest.title ?? name, kind: manifest.kind, url: `/app/${name}/`, board: `boards/apps/${name}.html`, ...kept, ...(version ? { version } : {}) };
	}

	private version(name: string, manifest: AppManifest, at: number | undefined): number | undefined {
		if (manifest.kind === "server") return at;
		if (manifest.kind === "build") {
			try {
				return Math.round(statSync(join(this.deckPath, ".decks", "apps", `${name}.built`)).mtimeMs);
			} catch {
				return at;
			}
		}
		// The newest of a static app's files, looked for in at most a few hundred of them.
		let newest = 0;
		let seen = 0;
		const walk = (dir: string, depth: number) => {
			if (depth > 4 || seen > 400) return;
			let entries;
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				const path = join(dir, entry.name);
				if (entry.isDirectory()) walk(path, depth + 1);
				else if (entry.isFile()) {
					seen += 1;
					try {
						newest = Math.max(newest, statSync(path).mtimeMs);
					} catch {
						/* gone between the listing and the look */
					}
				}
			}
		};
		try {
			walk(this.servedRoot(name, manifest), 0);
		} catch {
			return undefined;
		}
		return newest ? Math.round(newest) : undefined;
	}

	/** What an app is when nothing has happened to it yet: a static or built one is ready to serve, a server is stopped. */
	private idleStatus(name: string, manifest: AppManifest): AppStatus {
		if (manifest.kind === "server") return "stopped";
		if (manifest.kind === "build" && !existsSync(this.servedRoot(name, manifest))) return "stopped";
		return "running";
	}

	private firstStatus(name: string): AppStatus {
		try {
			return this.idleStatus(name, this.manifest(name));
		} catch {
			return "stopped";
		}
	}

	private set(name: string, patch: Partial<Omit<AppState, "name" | "title" | "kind" | "url" | "board">>): void {
		const was = this.states.get(name) ?? { status: this.firstStatus(name) };
		const next = { ...was, ...patch };
		for (const key of Object.keys(patch) as Array<keyof typeof patch>) if (patch[key] === undefined) delete next[key];
		this.states.set(name, next);
	}

	log(name: string, tail = 200): string[] {
		const lines = this.logs.get(name) ?? this.readLogFile(name);
		return lines.slice(-Math.max(1, Math.min(tail, LOG_LINES)));
	}

	private logFile(name: string): string {
		return join(this.deckPath, ".decks", "apps", `${name}.log`);
	}

	private readLogFile(name: string): string[] {
		try {
			return readFileSync(this.logFile(name), "utf8").split("\n").filter(Boolean).slice(-LOG_LINES);
		} catch {
			return [];
		}
	}

	private write(name: string, text: string): void {
		const lines = this.logs.get(name) ?? this.readLogFile(name);
		for (const line of text.replace(/\r/g, "").split("\n")) if (line.length) lines.push(line.slice(0, 2000));
		if (lines.length > LOG_LINES) lines.splice(0, lines.length - LOG_LINES);
		this.logs.set(name, lines);
		try {
			mkdirSync(join(this.deckPath, ".decks", "apps"), { recursive: true });
			// Kept to what the memory holds, now and then, so a chatty server cannot fill the disk.
			const writes = (this.writes.get(name) ?? 0) + 1;
			this.writes.set(name, writes);
			if (writes % 500 === 0) writeFileSync(this.logFile(name), `${lines.join("\n")}\n`);
			else appendFileSync(this.logFile(name), text.endsWith("\n") ? text : `${text}\n`);
		} catch {
			/* the log in memory is enough to read; the file is for after a restart */
		}
	}

	/** The folder a static or built app is served from, kept inside the app's own. */
	servedRoot(name: string, manifest = this.manifest(name)): string {
		const folder = this.folder(name);
		const root = resolve(folder, manifest.root ?? (manifest.kind === "build" ? "dist" : "."));
		if (root !== folder && !root.startsWith(folder + sep)) throw new Error(`apps/${name}/app.json names a root outside the app.`);
		return root;
	}

	/** The file a path inside a static or built app names, or undefined. A path with no file in it is its folder's `index.html`, and an address with no file at all is the app's (one-page apps route in the page). */
	file(name: string, path: string): string | undefined {
		const root = this.servedRoot(name);
		let inner: string;
		try {
			inner = decodeURIComponent(path.split("?")[0] ?? "/");
		} catch {
			return undefined;
		}
		const target = resolve(root, `.${inner.startsWith("/") ? inner : `/${inner}`}`);
		if (target !== root && !target.startsWith(root + sep)) return undefined;
		if (target.split(sep).some((part) => part.startsWith(".") && part.length > 1 && part !== "..")) return undefined;
		const isFile = (file: string) => existsSync(file) && statSync(file).isFile();
		if (isFile(target)) return target;
		if (existsSync(target) && statSync(target).isDirectory() && isFile(join(target, "index.html"))) return join(target, "index.html");
		// A one-page app's own route, `/trips/3`: its page, unless it asked for a file that is not there.
		if (!/\.[a-z0-9]{1,8}$/i.test(target) && isFile(join(root, "index.html"))) return join(root, "index.html");
		return undefined;
	}

	/** The board was seen, or the app answered a request: it is not to be put to sleep. */
	seen(name: string): void {
		if (!this.states.has(name) && !this.exists(name)) return;
		this.set(name, { seenAt: Date.now() });
	}

	/**
	 * Install and build, as the manifest says, and answer with how it went. Waits up to `waitMs` and
	 * then answers `pending`: an install can take minutes, and a stage run is abandoned after twenty
	 * seconds, so the agent asks again with `status`.
	 */
	async build(name: string, waitMs = 15_000): Promise<AppOutcome> {
		const manifest = this.manifest(name);
		const job = this.jobs.get(name) ?? this.startJob(name, () => this.runBuild(name, manifest));
		return this.within(name, job, waitMs);
	}

	/** Start a server app, building it first when it has never been built; answers as `build` does. */
	async run(name: string, waitMs = 15_000): Promise<AppOutcome> {
		const manifest = this.manifest(name);
		if (manifest.kind !== "server") return this.build(name, waitMs);
		const live = this.running.get(name);
		if (live) {
			this.seen(name);
			return this.within(name, live.ready.then((ok) => this.outcome(name, ok, 0)), waitMs);
		}
		const job =
			this.jobs.get(name) ??
			this.startJob(name, async () => {
				const t0 = Date.now();
				if (this.needsInstall(name) || (manifest.build && !this.builtOnce(name))) {
					const built = await this.runBuild(name, manifest);
					if (!built.ok) return built;
				}
				return this.startServer(name, manifest, t0);
			});
		return this.within(name, job, waitMs);
	}

	stop(name: string, status: AppStatus = "stopped"): boolean {
		const live = this.running.get(name);
		if (!live) {
			if (this.states.get(name)?.status === "asleep" && status === "stopped") this.set(name, { status });
			return false;
		}
		this.running.delete(name);
		if (live.token) this.tokens?.revoke(live.token);
		this.set(name, { status, port: undefined, warning: undefined });
		this.kill(live.child);
		this.write(name, status === "asleep" ? "— asleep: not seen for a while; the next request starts it again" : "— stopped");
		return true;
	}

	/** The port a server app answers on, starting it if it is not running. Undefined when it cannot be started. */
	async portFor(name: string): Promise<number | undefined> {
		const live = this.running.get(name);
		if (live) {
			this.seen(name);
			return (await live.ready) ? live.port : undefined;
		}
		const outcome = await this.run(name, START_MS + 5_000);
		if (!outcome.ok) return undefined;
		return this.running.get(name)?.port;
	}

	stopAll(): void {
		for (const name of [...this.running.keys()]) this.stop(name);
	}

	dispose(): void {
		clearInterval(this.sweep);
		this.stopAll();
	}

	// --- inside --------------------------------------------------------------------------

	private startJob(name: string, work: () => Promise<AppOutcome>): Job {
		const job = work()
			.catch((error: Error) => {
				this.write(name, `error: ${error.message}`);
				this.set(name, { status: "broken", error: error.message.split("\n")[0]!.slice(0, 300) });
				return this.outcome(name, false, 0);
			})
			.finally(() => this.jobs.delete(name));
		this.jobs.set(name, job);
		return job;
	}

	private async within(name: string, job: Job, waitMs: number): Promise<AppOutcome> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const late = new Promise<AppOutcome>((resolveLate) => {
			timer = setTimeout(() => resolveLate({ ...this.outcome(name, false, waitMs), pending: true }), waitMs);
		});
		try {
			return await Promise.race([job, late]);
		} finally {
			clearTimeout(timer);
		}
	}

	private outcome(name: string, ok: boolean, ms: number): AppOutcome {
		const status = this.state(name).status;
		const errors = this.log(name, 400).filter((line) => /\berr(or)?\b|ERR!|failed|exception|cannot|not found|traceback/i.test(line)).slice(-20);
		return { ok, status, ms, errors: ok ? [] : errors };
	}

	private needsInstall(name: string): boolean {
		const folder = this.folder(name);
		const manifest = join(folder, "package.json");
		if (!existsSync(manifest)) return false;
		// A package.json with nothing to install (the node starter's) installs nothing, and leaves no node_modules to compare with.
		try {
			const read = JSON.parse(readFileSync(manifest, "utf8")) as { dependencies?: object; devDependencies?: object };
			if (Object.keys(read.dependencies ?? {}).length === 0 && Object.keys(read.devDependencies ?? {}).length === 0) return false;
		} catch {
			/* a package.json npm itself will complain about, in the log */
		}
		const modules = join(folder, "node_modules");
		if (!existsSync(modules)) return true;
		return statSync(manifest).mtimeMs > statSync(modules).mtimeMs;
	}

	private builtOnce(name: string): boolean {
		return existsSync(join(this.deckPath, ".decks", "apps", `${name}.built`));
	}

	private async runBuild(name: string, manifest: AppManifest): Promise<AppOutcome> {
		const t0 = Date.now();
		if (this.needsInstall(name)) {
			this.set(name, { status: "installing", error: undefined });
			const install = manifest.install ?? "npm install --include=dev --no-audit --no-fund";
			const code = await this.exec(name, install);
			if (code !== 0) return this.failed(name, `${install} exited with code ${code}`, t0);
		}
		const command = manifest.build ?? (manifest.kind === "build" ? "npm run build" : undefined);
		if (command) {
			this.set(name, { status: "building", error: undefined });
			const code = await this.exec(name, command);
			if (code !== 0) return this.failed(name, `${command} exited with code ${code}`, t0);
			try {
				mkdirSync(join(this.deckPath, ".decks", "apps"), { recursive: true });
				writeFileSync(join(this.deckPath, ".decks", "apps", `${name}.built`), `${new Date().toISOString()}\n`);
			} catch {
				/* only a hint for the next run */
			}
		}
		if (manifest.kind === "build" && !existsSync(this.servedRoot(name, manifest))) {
			return this.failed(name, `the build wrote no ${manifest.root ?? "dist"}/ folder to serve`, t0);
		}
		this.set(name, { status: manifest.kind === "server" ? (this.running.has(name) ? "running" : "stopped") : "running", at: Date.now(), error: undefined });
		this.write(name, `— built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
		return this.outcome(name, true, Date.now() - t0);
	}

	private failed(name: string, error: string, t0: number): AppOutcome {
		this.write(name, `error: ${error}`);
		this.set(name, { status: "broken", error, at: Date.now() });
		return this.outcome(name, false, Date.now() - t0);
	}

	/**
	 * The environment an app's commands run in: this server's, minus `NODE_ENV=production`, which
	 * makes npm leave out a build's tools, and minus its secrets (`secretEnv`): an app is code an
	 * agent wrote, often from a starter, and has no business with the person's API keys.
	 */
	private env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...process.env };
		for (const key of Object.keys(env)) if (secretEnv(key)) delete env[key];
		// Who an app calls Decks as is its own, never inherited from whoever started Decks (an agent's shell sets these).
		for (const key of ["DECKS_STAGE_URL", "DECKS_STAGE_TOKEN", "DECKS_URL", "DECKS_AGENT", "DECKS_APP", "DECKS_TOKEN", "DECKS_SESSION"]) delete env[key];
		Object.assign(env, extra);
		if (env.NODE_ENV === "production") delete env.NODE_ENV;
		delete env.DECKS_DATA_DIR;
		return env;
	}

	private exec(name: string, command: string): Promise<number> {
		this.write(name, `$ ${command}`);
		return new Promise((resolveCode) => {
			// The base path too, which a framework has to know when it builds (Next.js `basePath`).
			const child = spawn("bash", ["-lc", command], { cwd: this.folder(name), env: this.env({ BASE_PATH: `/app/${name}` }), stdio: ["ignore", "pipe", "pipe"], detached: true });
			child.stdout?.on("data", (chunk: Buffer) => this.write(name, chunk.toString()));
			child.stderr?.on("data", (chunk: Buffer) => this.write(name, chunk.toString()));
			child.on("error", (error) => {
				this.write(name, `error: ${error.message}`);
				resolveCode(1);
			});
			child.on("close", (code) => resolveCode(code ?? 1));
		});
	}

	private async startServer(name: string, manifest: AppManifest, t0: number): Promise<AppOutcome> {
		const command = manifest.start ?? (existsSync(join(this.folder(name), "package.json")) ? "npm start" : undefined);
		if (!command) return this.failed(name, `apps/${name}/app.json has no "start" command`, t0);
		const port = await freePort();
		this.set(name, { status: "starting", port, error: undefined, warning: undefined, seenAt: Date.now() });
		this.write(name, `$ ${command}    (PORT=${port})`);
		// Its own token, for the SDK's calls: who it is comes from this alone, and it ends with the process.
		const minted = this.tokens?.issue({ kind: "app", name });
		const child = spawn("bash", ["-lc", command], {
			cwd: this.folder(name),
			env: this.env({
				PORT: String(port),
				HOST: "127.0.0.1",
				HOSTNAME: "127.0.0.1",
				BASE_PATH: `/app/${name}`,
				// Where Decks is, for the SDK's verbs (`/api/v1`), and the app they are called as.
				...(this.decksPort ? { DECKS_URL: `http://127.0.0.1:${this.decksPort}` } : {}),
				...(minted ? { DECKS_TOKEN: minted.token } : {}),
				// Which app this is, for a log line; who is calling is the token's to say.
				DECKS_APP: name,
				// `const { decks } = await import(process.env.DECKS_SDK)` reads DECKS_URL and DECKS_TOKEN; see packages/sdk.
				DECKS_SDK: SDK_FILE,
			}),
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		child.stdout?.on("data", (chunk: Buffer) => this.write(name, chunk.toString()));
		child.stderr?.on("data", (chunk: Buffer) => this.write(name, chunk.toString()));
		let exited = false;
		const ready = new Promise<boolean>((resolveReady) => {
			child.once("exit", () => resolveReady(false));
			void listening(port, START_MS, () => exited).then(resolveReady);
		});
		child.on("exit", (code, signal) => {
			exited = true;
			if (minted) this.tokens?.revoke(minted.id);
			if (this.running.get(name)?.child !== child) return;
			this.running.delete(name);
			const error = `exited with ${signal ?? `code ${code}`}`;
			this.write(name, `— ${error}`);
			this.set(name, { status: "broken", error, port: undefined, warning: undefined, at: Date.now() });
		});
		this.running.set(name, { child, port, ready, ...(minted ? { token: minted.id } : {}) });
		const ok = await ready;
		if (!ok) {
			if (this.running.get(name)?.child === child) {
				this.running.delete(name);
				this.kill(child);
				return this.failed(name, `nothing listened on PORT ${port} within ${START_MS / 1000} s; a server app has to listen on the port it is given`, t0);
			}
			return this.outcome(name, false, Date.now() - t0);
		}
		this.set(name, { status: "running", at: Date.now(), seenAt: Date.now() });
		this.write(name, `— running on ${port}, in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
		// The child was started detached, so its pid is its process group: npm and the server under it too.
		if (child.pid !== undefined) {
			void openListeners(child.pid).then((open) => {
				if (!open.length || this.running.get(name)?.child !== child) return;
				const warning = `Unguarded: listens on ${open.join(", ")}, not only this Mac`;
				this.set(name, { warning });
				this.write(name, `— ${warning}. Listen on 127.0.0.1 ($HOST) so it is reached only through Decks.`);
			});
		}
		return this.outcome(name, true, Date.now() - t0);
	}

	private kill(child: ChildProcess): void {
		if (child.pid === undefined || child.exitCode !== null) return;
		try {
			// The whole group: `bash -lc "npm start"` is three processes deep before the server.
			process.kill(-child.pid, "SIGTERM");
		} catch {
			child.kill("SIGTERM");
		}
		setTimeout(() => {
			if (child.exitCode !== null || child.pid === undefined) return;
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				/* gone */
			}
		}, 3000).unref?.();
	}

	private sleepUnseen(): void {
		const now = Date.now();
		for (const name of [...this.running.keys()]) {
			let minutes = IDLE_MINUTES;
			try {
				minutes = this.manifest(name).idleMinutes ?? IDLE_MINUTES;
			} catch {
				/* its folder went: it stops below like any unseen app */
			}
			const seenAt = this.states.get(name)?.seenAt ?? 0;
			if (now - seenAt > minutes * 60_000) this.stop(name, "asleep");
		}
	}
}

/*
 * Environment variables an app is not given. Decks' own (`DECKS_*`) are set again explicitly where
 * an app needs them; the Studio key is not one of them.
 */
const SECRET_ENV = /^(?:ANTHROPIC_|CLAUDE_|OPENAI_|GEMINI_|AWS_)|^(?:GOOGLE_API_KEY|GH_TOKEN|GITHUB_TOKEN|DECKS_STUDIO_KEY)$|_(?:TOKEN|SECRET|API_KEY|PASSWORD)$/i;

/** Whether an environment variable's name says it holds a secret, which an app's commands do not inherit. */
export function secretEnv(name: string): boolean {
	return SECRET_ENV.test(name);
}

/**
 * The addresses in `lsof -nP -iTCP -sTCP:LISTEN` output that are not loopback: `*:3000`,
 * `0.0.0.0:3000`, `192.168.1.5:3000`, `[::]:3000`. One per address, in the order listed.
 */
export function outsideListeners(lsof: string): string[] {
	const out: string[] = [];
	for (const line of lsof.split("\n")) {
		const match = /\s(\S+):(\d+|\*)\s+\(LISTEN\)\s*$/.exec(line);
		if (!match) continue;
		const host = match[1]!.replace(/^\[|\]$/g, "");
		if (host === "127.0.0.1" || host === "::1" || host === "localhost" || /^127\./.test(host)) continue;
		const address = `${match[1]}:${match[2]}`;
		if (!out.includes(address)) out.push(address);
	}
	return out;
}

/** What a process group listens on beyond loopback, by `lsof`; nothing when lsof is missing or fails. */
function openListeners(group: number): Promise<string[]> {
	return new Promise((resolveOpen) => {
		execFile("lsof", ["-nP", "-a", "-g", String(group), "-iTCP", "-sTCP:LISTEN"], { timeout: 5000 }, (error, stdout) => {
			resolveOpen(error ? [] : outsideListeners(String(stdout)));
		});
	});
}

/** A port nobody is listening on, from the system. */
function freePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close(() => resolvePort(port));
		});
	});
}

/** Whether something comes to listen on the port before the time is up or the process is gone. */
async function listening(port: number, ms: number, gone: () => boolean): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end && !gone()) {
		const open = await new Promise<boolean>((resolveOpen) => {
			const socket = connect(port, "127.0.0.1");
			socket.once("connect", () => {
				socket.destroy();
				resolveOpen(true);
			});
			socket.once("error", () => resolveOpen(false));
		});
		if (open) return true;
		await new Promise((r) => setTimeout(r, 150));
	}
	return false;
}
