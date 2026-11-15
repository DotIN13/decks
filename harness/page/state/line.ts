import { clientFor, DecksError, Line, type Client, type Heard, type Typed } from "@decks-next/sdk/browser";
import { batch } from "solid-js";
import { openOldLine } from "./compat/line.ts";

// The page's one line to the server: every call through @decks-next/sdk, and
// one socket (the sdk's Line) for the events, handed to listeners by name in
// one batch per paint, and for the calls tied to this screen (view.move).

export type Answer<T = unknown> = { ok: true; value: T; notes: string[] } | { ok: false; error: string; code: string; notes: string[] };
type Hear = (payload: Record<string, unknown>, name: string) => void;

/** The page's address book: who it is and how it calls. Not reactive; `connected` in state/deck is. */
const line = {
	client: undefined as Client | undefined,
	socket: undefined as Line | undefined,
	stopped: false,
	attempt: 0,
	hearers: new Map<string, Set<Hear>>(),
	arrived: [] as Heard[],
	painting: false,
	up: (_up: boolean) => {},
};

/** The server and token the page calls with: /page.json, else ?token= in the address, kept for this tab. */
export async function findServer(): Promise<{ url: string; token: string | undefined; compat?: boolean }> {
	const fromAddress = new URLSearchParams(location.search).get("token");
	if (fromAddress) sessionStorage.setItem("decks-token", fromAddress);
	try {
		const response = await fetch("/page.json", { cache: "no-store" });
		if (response.ok) {
			const page = (await response.json()) as { url?: string; token?: string; compat?: boolean };
			if (page.token) return { url: page.url || location.origin, token: page.token, ...(page.compat ? { compat: true } : {}) };
		}
	} catch {
		// No /page.json: the token from the address, below.
	}
	return { url: location.origin, token: sessionStorage.getItem("decks-token") ?? undefined };
}

/** Open the line: a client, then the event stream, reopened when it drops. `onUp` runs each time it comes up. */
export async function start(onUp: (up: boolean) => void): Promise<Client> {
	const { url, token, compat } = await findServer();
	line.client = clientFor(url, token);
	if (compat && token) openOldLine(url, token);
	line.up = onUp;
	line.stopped = false;
	listen();
	return line.client;
}

function listen(): void {
	const client = line.client;
	if (!client || line.stopped || !client.token) return;
	const socket = new Line(client.url, client.token);
	line.socket = socket;
	socket.on(arrive);
	socket.caller.then(
		() => {
			socket.watch();
			line.attempt = 0;
			line.up(true);
		},
		() => {},
	);
	void socket.closed.then(() => {
		if (line.stopped || line.socket !== socket) return;
		line.up(false);
		window.setTimeout(listen, Math.min(2000, 150 * 2 ** line.attempt++));
	});
}

/** A call on this page's socket, for what is tied to this screen (view.move registers it). Never throws. */
export async function callOnLine<T = unknown>(name: string, args: unknown = {}): Promise<Answer<T>> {
	if (!line.socket) return call<T>(name, args);
	try {
		const answered = await line.socket.call(name, args);
		return { ok: true, value: answered.value as T, notes: answered.notes };
	} catch (error) {
		const refusal = error instanceof DecksError ? error : undefined;
		return { ok: false, error: (error as Error).message, code: refusal?.code ?? "unavailable", notes: refusal?.notes ?? [] };
	}
}

function arrive(event: Heard): void {
	line.arrived.push(event);
	if (line.painting) return;
	line.painting = true;
	const wave = () => {
		if (!line.painting) return;
		line.painting = false;
		const events = line.arrived.splice(0);
		batch(() => {
			for (const one of events) for (const hear of [...(line.hearers.get(one.name) ?? []), ...(line.hearers.get("*") ?? [])]) hear((one.payload ?? {}) as Record<string, unknown>, one.name);
		});
	};
	requestAnimationFrame(wave);
	window.setTimeout(wave, 50);
}

/** Hear one event by name, or "*" for every one. Answers the stop. */
export function on(name: string, hear: Hear): () => void {
	const set = line.hearers.get(name) ?? new Set<Hear>();
	set.add(hear);
	line.hearers.set(name, set);
	return () => void set.delete(hear);
}

const need = (): Client => {
	if (!line.client) throw new Error("The line is not open yet: state/line.ts start() runs from the shell's mount.");
	return line.client;
};

/** Every call, typed: decks.<noun>.<verb>(args). Throws a DecksError on a refusal. */
export const decks: Typed = new Proxy({} as Typed, { get: (_, noun: string) => (need().decks as unknown as Record<string, unknown>)[noun] });

/** Any call by name; never throws. A refusal comes back as { ok: false, error, code }. */
export async function call<T = unknown>(name: string, args: unknown = {}): Promise<Answer<T>> {
	try {
		const answered = await need().call(name, args);
		return { ok: true, value: answered.value as T, notes: answered.notes };
	} catch (error) {
		const refusal = error instanceof DecksError ? error : undefined;
		return { ok: false, error: (error as Error).message, code: refusal?.code ?? "unavailable", notes: refusal?.notes ?? [] };
	}
}

/** Whether the line has been opened (not whether it is up). */
export const started = (): boolean => line.client !== undefined;

/** The token the page calls with, for an address that cannot carry a header. */
export const token = (): string | undefined => line.client?.token;

/** Close the line for good. */
export function stop(): void {
	line.stopped = true;
	line.socket?.close();
	line.socket = undefined;
	line.client = undefined;
}

/** Where a failed call's words go: the shell gives it the notices. */
const failures = { say: (_text: string) => {} };
export function setFailureSink(say: (text: string) => void): void {
	failures.say = say;
}

/** Say a failed call's error as a notice; the answer comes back unchanged. */
export function warnIfFailed<T>(answer: Answer<T>): Answer<T> {
	if (!answer.ok) failures.say(answer.error);
	return answer;
}
