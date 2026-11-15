import type { Bytes, Context, Route, RouteAnswer } from "../kernel/index.ts";
import type { Reading } from "./reading.ts";

// What a canvas frame showing a card measured (rule 15): POST /pictures/extent { path, w, h, ... }.
// card.fit answers from it, without a browser, while it is fresh and the card unchanged since.

export const EXTENT = "/pictures/extent";
const FRESH_MS = 120_000;
type Kept = Reading & { w: number; at: number };

export class Extents {
	private kept = new Map<string, Kept>();

	constructor(private clock: () => number = Date.now) {}

	note(path: string, w: number, reading: Reading): void {
		this.kept.set(path, { ...reading, w, at: this.clock() });
	}

	/** A report at this width, fresh, and later than the card's last write; else undefined. */
	fresh(path: string, w: number, writtenAt: number): Reading | undefined {
		const kept = this.kept.get(path);
		if (!kept || Math.abs(kept.w - w) > 1 || this.clock() - kept.at > FRESH_MS || kept.at < writtenAt) return undefined;
		const { w: _w, at: _at, ...reading } = kept;
		return reading;
	}
}

export const extentRoute = (extents: Extents): Route => ({ method: "POST", prefix: EXTENT, answer: (ctx, _path, _query, body) => answer(ctx, extents, body) });

async function answer(ctx: Context, extents: Extents, body: Bytes): Promise<RouteAnswer> {
	const json = (status: number, value: unknown): RouteAnswer => ({ status, type: "application/json", body: JSON.stringify(value) });
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(body));
	} catch {
		return json(400, { ok: false, error: "Send { path, w, h }, and what else was measured." });
	}
	const report = reportOf(parsed);
	if (!report) return json(400, { ok: false, error: "Send { path, w, h }, and what else was measured." });
	if (ctx.caller.canvas && !report.path.includes(`/${ctx.caller.canvas}/`)) return json(403, { ok: false, error: "A frame reports only the cards of its own canvas." });
	extents.note(report.path, report.w, report.reading);
	return json(200, { ok: true });
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** A report's reading, or undefined when it lacks path, w or h. */
export function reportOf(body: unknown): { path: string; w: number; reading: Reading } | undefined {
	const read = (body ?? {}) as Record<string, unknown>;
	const w = num(read.w);
	const h = num(read.h);
	if (typeof read.path !== "string" || w === undefined || h === undefined) return undefined;
	const reading: Reading = { h, words: num(read.words) ?? 0 };
	for (const key of ["minFont", "overflowX", "cut", "overlaps"] as const) {
		const value = num(read[key]);
		if (value !== undefined) reading[key] = value;
	}
	return { path: read.path.replace(/^\/+/, ""), w, reading };
}

