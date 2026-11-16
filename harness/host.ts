import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCK_FILE } from "@decks/protocol";
import { host as openHost, type Host } from "@decks/sdk";
import { ClaudeAccounts } from "./accounts/index.ts";
import { harnessAnswers, type Parts } from "./calls.ts";
import { AGENT_KINDS, type RunKind } from "./runtimes/types/index.ts";
import { runtimeOf } from "./runtimes/registry.ts";
import { harnessHome } from "./runtimes/shared/home.ts";
import { Sessions, specOf, Transcripts, type HostLink, type SessionDeps } from "./sessions/index.ts";
import { Settings } from "./runtimes/settings.ts";

// The harness's line to a server: offer the kinds it runs and the calls it
// answers, start the agents the server asks for, deliver their mail, and
// connect again when the line drops, to the server the deck's lock file names
// then: a restarted one has a new token. Agents keep running across a drop, and
// the server adopts them again when the harness says hello.

export type HarnessOptions = {
	url: string;
	token: string;
	/** The deck folder: each agent's working folder. */
	deck: string;
	home?: string;
	kinds?: RunKind[];
	/** Opens each agent's runtime instead of the registry: a test's fake runtime. */
	open?: SessionDeps["open"];
	/** On a deck with no agent at all, start one, as a first run of Decks does; its home canvas when named. */
	firstAgent?: false | { canvas?: string };
	/** Where the server is now, asked at each connection: the deck's lock file when left out, else `url` and `token`. */
	where?: () => { url: string; token: string } | undefined;
};

export type Harness = { sessions: Sessions; url: string; connected(): boolean; stop(): Promise<void> };
type Mailed = { id: string; from: string; to: string; task: string; cards: string[]; reply?: boolean; state?: string };

export async function startHarness(options: HarnessOptions): Promise<Harness> {
	const home = options.home ?? harnessHome();
	let line: Host | undefined;
	let stopping = false;
	const link: HostLink = {
		tell: (name, payload) => line?.tell(name, payload),
		call: async (name, args) => {
			if (!line) throw Object.assign(new Error("The harness is not connected to Decks."), { code: "unavailable" });
			return (await line.line.call(name, args ?? {})).value;
		},
	};
	const accounts = new ClaudeAccounts(home);
	const transcripts = new Transcripts(home);
	const sessions = new Sessions({ url: options.url, deckPath: options.deck, transcripts, host: link, accounts, ...(options.open ? { open: options.open } : {}) });
	const parts: Parts = { sessions, accounts, settings: new Settings(home), host: link, forks: new Map() };

	const where = options.where ?? (() => readLock(options.deck));
	let url = options.url;
	const connect = async (): Promise<void> => {
		const now = where() ?? { url: options.url, token: options.token };
		const next = await openHost({
			url: now.url,
			token: now.token,
			kinds: offeredKinds(options.kinds),
			answers: harnessAnswers(parts),
			start: (spec, agent) => started(parts, spec, agent),
			mail: (message, agent) => sessions.get(agent)?.mail(message as Mailed),
		});
		next.line.watch(["agent.requested", "agent.mailed", "agent.changed", "agent.deleted"]);
		next.line.on((event) => void heard(parts, event.name, event.payload as { ids?: string[] }));
		line = next;
		url = now.url;
		void next.closed.then(() => {
			line = undefined;
			if (!stopping) void retry(connect, () => stopping);
		});
	};
	await connect();
	if (options.firstAgent !== false) await firstAgent(link, offeredKinds(options.kinds)[0], options.firstAgent?.canvas);
	return {
		sessions,
		get url() {
			return url;
		},
		connected: () => !!line,
		stop: async () => {
			stopping = true;
			sessions.dispose();
			line?.close();
		},
	};
}

/** The kinds this machine can run, or those named. */
export function offeredKinds(asked?: RunKind[]): RunKind[] {
	return (asked ?? [...AGENT_KINDS]).filter((kind) => runtimeOf(kind)?.availability().available);
}

/** agent.requested: a session, dormant, or one already running picked up again with its new token; the server told its state. */
async function started(parts: Parts, raw: unknown, agent: string): Promise<void> {
	const session = parts.sessions.start(specOf(raw, agent));
	const fork = parts.forks.get(session.id);
	if (fork) {
		session.resumeFrom(fork);
		parts.forks.delete(session.id);
	}
	await parts.host.call("agent.update", { agent: session.id, change: { state: session.state, queued: session.queues.length } }).catch(() => {});
}

/** A record changed or went: follow its model and mode, or end its session. */
async function heard(parts: Parts, name: string, payload: { ids?: string[] }): Promise<void> {
	for (const id of payload.ids ?? []) {
		const session = parts.sessions.get(id);
		if (!session) continue;
		if (name === "agent.deleted") parts.sessions.drop(id);
		if (name !== "agent.changed") continue;
		const record = await parts.host.call("agent.get", { agent: id }).catch(() => undefined);
		if (record) await session.follow(record as { model?: string; thinking?: string; mode?: string });
	}
}

async function retry(connect: () => Promise<void>, stopped: () => boolean): Promise<void> {
	for (let wait = 500; !stopped(); wait = Math.min(wait * 2, 10_000)) {
		await new Promise((resolve) => setTimeout(resolve, wait));
		if (stopped()) return;
		try {
			return await connect();
		} catch {
			// The server is not back yet: try again, more slowly.
		}
	}
}

/** A deck with no agent gets one of the first kind offered, named by the server, at home on the canvas named, else the deck's first, else a new one. */
async function firstAgent(link: HostLink, kind: RunKind | undefined, canvas: string | undefined): Promise<void> {
	if (!kind) return;
	const agents = (await link.call("agent.list").catch(() => [undefined])) as unknown[];
	if (agents.length) return;
	const first = canvas ?? ((await link.call("canvas.list").catch(() => [])) as Array<{ name: string }>)[0]?.name;
	await link.call("agent.create", { kind, ...(first ? { canvas: first } : {}) }).catch(() => {});
}

// Where the deck's server is now
/** The lock file a server writes (`.decks/server.json`): its address, its token and its process. A restarted server writes a new one, with a new token. */
export type Lock = { url: string; token: string; pid: number };

/** The running server's lock, when its process is alive. */
export function readLock(deck: string): Lock | undefined {
	const file = join(deck, LOCK_FILE);
	if (!existsSync(file)) return undefined;
	try {
		const lock = JSON.parse(readFileSync(file, "utf8")) as Lock;
		process.kill(lock.pid, 0);
		return lock;
	} catch {
		return undefined;
	}
}
