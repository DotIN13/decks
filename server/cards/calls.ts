import { calls, events, layout, Refused, type Handled } from "../../protocol/index.ts";
import type * as S from "./shapes.ts";
import { handleAll, type Context, type Kernel } from "../kernel/types.ts";
import { canvasOf, cardPath, claim, createCard, describe, listCards } from "./cards.ts";
import { fence, fenceDir } from "./fence.ts";
import { applyEdits, checkRev, fileOf, globToRegex, LIMIT, matchesGlob, readText, slice, stat, walk, writeText } from "./files.ts";
import { FILES } from "./page.ts";

// One short handler per call. The file calls, then the card calls.

const { file, card } = calls;
const decoder = new TextDecoder("utf-8", { fatal: true });

async function answerOf(ctx: Context, path: ReturnType<typeof fence>): Promise<S.File> {
	const entry = await stat(ctx.deck, path);
	if (!entry) throw new Refused("not_found", `There is nothing at ${path}.`, "file.list");
	const by = (await ctx.deck.revisions?.(path))?.at(-1)?.by;
	return { ...fileOf(entry), ...(by ? { by } : {}) };
}

const FILE = { list: file.list, find: file.find, read: file.read, write: file.write, edit: file.edit, grep: file.grep, move: file.move, remove: file.remove, url: file.url };

export const fileCalls: Handled<Context>[] = handleAll(FILE, {
	list: async (ctx, { path, deep }) => (await walk(ctx.deck, fenceDir(path), !!deep)).map(fileOf),
	find: async (ctx, { pattern, path, limit }) => {
		const under = fenceDir(path);
		const glob = globToRegex(pattern);
		const found = (await walk(ctx.deck, under, true, under === "")).filter((e) => e.kind === "file" && matchesGlob(glob, pattern.includes("/"), e.path, under));
		return found.slice(0, limit ?? LIMIT).map(fileOf);
	},
	read: async (ctx, { path, from, lines, sha }) => {
		const at = fence(path);
		if (sha !== undefined) return readPast(ctx, at, sha, from, lines);
		const got = await readText(ctx.deck, at);
		const part = slice(got.text, from, lines);
		return { path: at, text: part.text, rev: got.rev, ...(got.truncated || part.cut ? { truncated: true } : {}) };
	},
	write: async (ctx, { path, text, rev }) => {
		const at = fence(path);
		await checkRev(ctx.deck, at, rev);
		return writeText(ctx.deck, at, text, ctx.caller);
	},
	edit: async (ctx, { path, edits, rev }) => {
		const at = fence(path);
		await checkRev(ctx.deck, at, rev);
		const got = await readText(ctx.deck, at);
		if (got.truncated) throw new Refused("invalid", `${at} is over 1 MB: write it whole with file.write.`, "file.write");
		return writeText(ctx.deck, at, applyEdits(at, got.text, edits), ctx.caller);
	},
	grep: async (ctx, { pattern, path, glob, limit }) => grep(ctx, pattern, fenceDir(path), glob, limit ?? LIMIT),
	move: async (ctx, { path, to }) => {
		const target = fence(to, "destination");
		await ctx.deck.move(fence(path), target, ctx.caller);
		return answerOf(ctx, target);
	},
	remove: async (ctx, { path }) => {
		const at = fence(path);
		await ctx.deck.remove(at, ctx.caller);
		return { deleted: at };
	},
	url: async (_ctx, { path }) => FILES + encodeURI(fence(path)),
});

async function readPast(ctx: Context, path: ReturnType<typeof fence>, sha: string, from?: number, lines?: number): Promise<S.FileText> {
	const rev = Number(sha);
	if (!Number.isInteger(rev) || rev < 0) throw new Refused("invalid", `${sha} is not a version: file.versions lists them.`, "file.versions");
	if (!ctx.deck.readAt) throw new Refused("unavailable", "This server keeps no history of files.", "file.read");
	const part = slice(decoder.decode(await ctx.deck.readAt(path, rev)), from, lines);
	return { path, text: part.text, rev, ...(part.cut ? { truncated: true } : {}) };
}

async function grep(ctx: Context, pattern: string, under: ReturnType<typeof fenceDir>, glob: string | undefined, limit: number): Promise<S.FileMatch[]> {
	let re: RegExp;
	try {
		re = new RegExp(pattern);
	} catch {
		throw new Refused("invalid", `${pattern} is not a regular expression.`, "file.find");
	}
	const only = glob ? globToRegex(glob) : undefined;
	const out: S.FileMatch[] = [];
	for (const entry of await walk(ctx.deck, under, true, under === "")) {
		if (entry.kind !== "file" || (only && !matchesGlob(only, glob!.includes("/"), entry.path, under))) continue;
		let text: string;
		try {
			text = (await readText(ctx.deck, entry.path)).text;
		} catch {
			continue;
		}
		const lines = text.split("\n");
		for (let i = 0; i < lines.length && out.length < limit; i++) if (re.test(lines[i]!)) out.push({ path: entry.path, line: i + 1, text: lines[i]! });
		if (out.length >= limit) break;
	}
	return out;
}

/** The card calls. url issues a card's pass, so it needs the kernel's tokens. */
const CARD = { list: card.list, get: card.get, create: card.create, claim: card.claim, url: card.url };

export function cardCalls(kernel: () => Kernel | undefined): Handled<Context>[] {
	return handleAll(CARD, {
		list: async (ctx) => Promise.all((await listCards(ctx.deck)).map((path) => describe(ctx.deck, ctx.store, path))),
		get: async (ctx, { card: name }) => {
			const path = cardPath(name);
			const found = await describe(ctx.deck, ctx.store, path);
			const placements = placementsOf(ctx, path);
			return placements.length ? { ...found, placements } : found;
		},
		create: async (ctx, { title, w, h, canvas }) => {
			const on = canvas ?? ctx.caller.canvas;
			if (!on) throw new Refused("invalid", "Name the canvas the card goes in: you have no canvas of your own.", "canvas.list");
			if (!layout.canvasNameOk(on)) throw new Refused("invalid", `${on} is not a canvas's name.`, "canvas.list");
			const path = await createCard(ctx.deck, on, title, { w: w ?? 1000, ...(h ? { h } : {}) }, ctx.caller);
			ctx.note(`The card is on no canvas yet: item.insert { type: "card", card: "${path}" } places it.`);
			return describe(ctx.deck, ctx.store, path);
		},
		claim: async (ctx, { cards }) => {
			const out: S.Card[] = [];
			for (const name of Array.isArray(cards) ? cards : [cards]) {
				const path = cardPath(name);
				if (!(await stat(ctx.deck, path))) throw new Refused("not_found", `There is no card at ${path}.`, "card.list");
				const rev = (await stat(ctx.deck, path))?.rev ?? 0;
				await claim(ctx.store, path, ctx.caller, rev);
				ctx.events.emit(events.cardChanged, { canvas: canvasOf(path), ids: [path], by: ctx.caller.id, rev });
				out.push(await describe(ctx.deck, ctx.store, path));
			}
			return out;
		},
		url: async (ctx, { card: name }) => {
			const path = cardPath(name);
			if (!(await stat(ctx.deck, path))) throw new Refused("not_found", `There is no card at ${path}.`, "card.list");
			const pass = kernel()?.callers.issue({ kind: "card", id: path, name: path, canvas: canvasOf(path) }, "card page");
			return FILES + encodeURI(path) + (pass ? `?pass=${encodeURIComponent(pass)}` : "");
		},
	});
}

function placementsOf(ctx: Context, path: string): S.Placement[] {
	const canvas = canvasOf(path);
	try {
		return ctx
			.canvas(canvas)
			.read()
			.filter((item) => item.type === "card" && item.card === path && item.box)
			.map((item) => ({ card: path, canvas, box: item.box! }));
	} catch {
		return [];
	}
}
