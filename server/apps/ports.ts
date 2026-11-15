import { Refused } from "../../protocol/index.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context, Store } from "../kernel/index.ts";
import { pipeTo, send, withoutPass } from "./proxy.ts";

// Forwarded ports: kept in the store, reached at /node/ and /rnode/. Rule 11.

export type Forward = { port: number; label?: string; by?: string; at: number; path: string; stripped: string };
const KEY = "ports.json";
const HOST = "localhost";

const addresses = (port: number) => ({ path: `/node/${HOST}/${port}/`, stripped: `/rnode/${HOST}/${port}/` });

export async function forwards(store: Store): Promise<Forward[]> {
	const bytes = await store.get(KEY);
	if (!bytes) return [];
	try {
		const raw = JSON.parse(new TextDecoder().decode(bytes)) as Omit<Forward, "path" | "stripped">[];
		return raw.filter((one) => Number.isInteger(one?.port)).map((one) => ({ ...one, ...addresses(one.port) }));
	} catch {
		return [];
	}
}

async function save(store: Store, list: Forward[]): Promise<void> {
	const kept = list.map(({ path: _p, stripped: _s, ...one }) => one);
	await store.put(KEY, new TextEncoder().encode(`${JSON.stringify(kept, null, "\t")}\n`));
}

export function checkPort(port: number): void {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Refused("invalid", `A port is a whole number from 1 to 65535; not ${port}.`, "port.open");
}

export async function open(store: Store, port: number, label: string | undefined, by: string, at: number): Promise<Forward> {
	checkPort(port);
	const clean = label?.trim().slice(0, 80);
	const next: Forward = { port, ...(clean ? { label: clean } : {}), by, at, ...addresses(port) };
	const list = [...(await forwards(store)).filter((one) => one.port !== port), next].sort((a, b) => a.port - b.port);
	await save(store, list);
	return next;
}

export async function close(store: Store, port: number): Promise<void> {
	const list = await forwards(store);
	if (!list.some((one) => one.port === port)) throw new Refused("not_found", `Port ${port} is not forwarded.`, "port.list");
	await save(store, list.filter((one) => one.port !== port));
}

/** The port and the path passed on, from /node/<host>/<port>/x or /rnode/<host>/<port>/x. */
export function forwardTarget(path: string): { port: number; path: string } | undefined {
	const match = /^\/(r?node)\/([^/]+)\/(\d{1,5})(\/.*)?$/.exec(path);
	if (!match) return undefined;
	const [, kind, host, digits, tail = "/"] = match;
	const port = Number(digits);
	if (port < 1 || port > 65535) return undefined;
	return { port, path: kind === "node" ? `/node/${host}/${port}${tail}` : tail };
}

/** Answer one request under /node/ or /rnode/, streamed. */
export async function serveForward(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url ?? "/", "http://decks.local");
	const target = forwardTarget(url.pathname);
	const text = (status: number, words: string) => send(res, { status, type: "text/plain; charset=utf-8", body: words });
	if (!target) return text(404, "A forwarded port's address is /node/<host>/<port>/ or /rnode/<host>/<port>/.");
	if (!(await forwards(ctx.store)).some((one) => one.port === target.port)) return text(404, `Port ${target.port} is not forwarded; port.open forwards it.`);
	return pipeTo(req, res, target.port, withoutPass(target.path, url.search), "");
}
