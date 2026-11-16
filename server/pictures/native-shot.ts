import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { layout } from "../../protocol/index.ts";
import { toDeckPath, type Bytes, type Context } from "../kernel/index.ts";
import type { Box } from "./shapes.ts";
import { fontFiles, isFallbackFamily, type FontFile, type FontNeed } from "@decks/protocol/fonts";
import type { Answer, Native } from "./native.ts";
import type { Writer } from "./marks.ts";

// A canvas picture drawn by the engine's native tool (rule 17): the drawing, each card as its
// picture, and the fonts, pictures and icons it asks for. What it cannot be given makes the
// call fall back to the browser, saying why.

const PAPER = { light: [245 / 255, 245 / 255, 245 / 255], dark: [30 / 255, 30 / 255, 30 / 255] };
const ROUNDS = 6;

export type NativeArgs = { canvas: string; text: string; box: Box; factor: number; scheme: "light" | "dark"; format: "png" | "jpeg"; writer?: Writer; cardPicture: (card: string, px: number) => Promise<Bytes> };

export type NativeTaken = { bytes: Bytes } | { why: string };

// Drawing a box natively, round by round.
/** Draw the box natively; the picture's bytes, or why not. */
export async function drawNatively(ctx: Context, native: Native, args: NativeArgs): Promise<NativeTaken> {
	const dir = join(tmpdir(), "decks-native-shots", randomUUID());
	await mkdir(dir, { recursive: true });
	try {
		const out = join(dir, `out.${args.format === "jpeg" ? "jpg" : "png"}`);
		const width = Math.round((args.box.x2 - args.box.x1) * args.factor);
		const height = Math.round((args.box.y2 - args.box.y1) * args.factor);
		const base = { doc: args.text, dark: args.scheme === "dark", box: [args.box.x1, args.box.y1, args.box.x2, args.box.y2], scale: args.factor, width, height, paper: PAPER[args.scheme], cards: await cardsIn(ctx, args, dir), out, format: args.format, quality: 90, ...(args.writer ? { writer: args.writer } : {}) };
		const asked = await native.ask({ ...base, fontNeeds: true });
		if (!asked.ok) return { why: `the native tool failed: ${asked.error}` };
		const fonts = await fontsFor(asked.fontNeeds ?? []);
		let more: Record<string, unknown> = { fonts };
		for (let n = 0; n < ROUNDS; n++) {
			const answer = await native.ask({ ...base, ...more });
			if (!answer.ok) return { why: `the native tool failed: ${answer.error}` };
			if (answer.problems?.length) return { why: `a picture in the box cannot be drawn here (${answer.problems.join("; ")})` };
			if (answer.file) return { bytes: new Uint8Array(await readFile(answer.file)) };
			const next = await handover(ctx, args, answer, dir);
			if ("why" in next) return next as { why: string };
			more = next;
		}
		return { why: "the native tool kept asking for more" };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// Each card as its picture.
async function cardsIn(ctx: Context, args: NativeArgs, dir: string): Promise<{ x: number; y: number; w: number; h: number; picture: string }[]> {
	const out = [];
	const b = args.box;
	for (const item of ctx.canvas(args.canvas).read()) {
		const c = item.box;
		if (item.type !== "card" || !c || c.x1 >= b.x2 || c.x2 <= b.x1 || c.y1 >= b.y2 || c.y2 <= b.y1) continue;
		const picture = join(dir, `${randomUUID()}.jpg`);
		await writeFile(picture, await args.cardPicture(String(item.card), (c.x2 - c.x1) * args.factor));
		out.push({ x: c.x1, y: c.y1, w: c.x2 - c.x1, h: c.y2 - c.y1, picture });
	}
	return out;
}

// The font files the words need: the protocol's list, fallback scripts and emoji included.
const FONTS = process.env.DECKS_FONT_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "decks", "fonts");

/** The fonts to hand the tool for a set of needs, each as a file on this machine; one not fetched is left out. */
export async function fontsFor(needs: FontNeed[], path = fontPath): Promise<{ key: string; family: string; path: string; fallback: boolean }[]> {
	const out = [];
	for (const file of fontFiles(needs)) {
		const at = await path(file);
		if (at) out.push({ key: file.key, family: file.family, path: at, fallback: isFallbackFamily(file.family) });
	}
	return out;
}

async function fontPath(file: FontFile): Promise<string | undefined> {
	const path = join(FONTS, `${file.key.replaceAll("/", "_")}.ttf`);
	if (await readFile(path).then(() => true, () => false)) return path;
	for (const url of file.fallback ? [file.url, file.fallback] : [file.url]) {
		const answer = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
		if (!answer?.ok) continue;
		await mkdir(FONTS, { recursive: true });
		await writeFile(path, new Uint8Array(await answer.arrayBuffer()));
		return path;
	}
	return undefined;
}

// What the tool asks for: pictures; maths, markdown cards and icons are the browser's.
/** Answer the tool's needs for one more round, or say why it cannot be drawn natively. */
async function handover(ctx: Context, args: NativeArgs, answer: Answer, dir: string): Promise<Record<string, unknown> | { why: string }> {
	const needs = answer.needs ?? { cards: [], pictures: [], icons: [], math: [] };
	if (needs.math.length) return { why: "the box has maths, which the browser typesets" };
	if (needs.cards.length) return { why: "the box has markdown cards, which the browser lays out" };
	if (needs.icons.length) return { why: "the box has icons, which the browser draws" };
	const pictures = [];
	for (const url of needs.pictures) {
		const path = await pictureFile(ctx, args.canvas, url, dir);
		if (!path) return { why: `a picture in the box cannot be loaded (${url.slice(0, 80)})` };
		pictures.push({ url, path });
	}
	return pictures.length ? { pictures } : { why: "the native tool asked for nothing it could be given" };
}

/** A picture the drawing names, as a file the tool can read: from the deck, a data address or the web. */
async function pictureFile(ctx: Context, canvas: string, url: string, dir: string): Promise<string | undefined> {
	let bytes: Uint8Array | undefined;
	if (url.startsWith("data:")) {
		const comma = url.indexOf(",");
		bytes = url.slice(0, comma).endsWith(";base64") ? Buffer.from(url.slice(comma + 1), "base64") : Buffer.from(decodeURIComponent(url.slice(comma + 1)));
	} else if (/^https?:/.test(url)) {
		const answer = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
		bytes = answer?.ok ? new Uint8Array(await answer.arrayBuffer()) : undefined;
	} else {
		const got = layout.resolveReference(canvas, url);
		bytes = "path" in got ? await ctx.deck.read(toDeckPath(got.path)).catch(() => undefined) : undefined;
	}
	if (!bytes) return undefined;
	const path = join(dir, randomUUID());
	await writeFile(path, bytes);
	return path;
}

