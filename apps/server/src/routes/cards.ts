import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Response } from "express";
import type { Board } from "@decks/protocol";
import { cardModules, cardPage, readDeckImports } from "../cards/cards.ts";
import { canvasOfPath, isCardPath, isSharedCanvas } from "../deck/layout.ts";
import { libVersion, versionLibRefs } from "../deck/lib-version.ts";
import { NotFound, PathRefused, resolveServed } from "../deck/roots.ts";
import { boardHeaders } from "../files/serve.ts";
import type { App } from "../app.ts";

/**
 * A card's two answers under `/api/board/*path` (`board-path.ts`): one of its scripts, and its page.
 * Each returns true when it answered the request.
 */

/**
 * A card's scripts, each at its own address beside the card (`sales.html.m0.js`), so its relative
 * imports resolve from its folder (`cards/cards.ts`). A friend's card runs none: the stage cleans
 * them out, and none is served either.
 */
export async function cardModuleAnswer(app: App, asked: string, requested: string, res: Response): Promise<boolean> {
	const cardModule = /^(.+\.html?)\.m(\d+)\.js$/i.exec(requested);
	if (!cardModule || !isCardPath(cardModule[1]!)) return false;
	const file = resolveServed(app.deck.path, cardModule[1]!);
	if (!existsSync(file) || !statSync(file).isFile()) throw new NotFound(requested);
	if (isSharedCanvas(canvasOfPath(asked)?.name ?? "")) throw new PathRefused(requested, "a card shared with you runs no scripts");
	const source = cardModules(await readFile(file, "utf8"))[Number(cardModule[2])];
	if (source === undefined) throw new NotFound(requested, "the card has no such script");
	boardHeaders(res);
	res.setHeader("Cache-Control", "no-cache");
	res.type("text/javascript").send(source);
	return true;
}

/** A card opened by itself, or pictured: the piece in a page of its own (`cards/cards.ts`). */
export async function cardPageAnswer(app: App, asked: string, requested: string, target: string, board: Board | undefined, raw: boolean, res: Response): Promise<boolean> {
	if (raw || !isCardPath(requested)) return false;
	const shared = isSharedCanvas(canvasOfPath(asked)?.name ?? "");
	const mapFile = resolveServed(app.deck.path, "assets/importmap.json");
	const deckImports = readDeckImports(existsSync(mapFile) ? await readFile(mapFile, "utf8") : undefined, "../../assets/");
	const page = cardPage({ path: requested, source: await readFile(target, "utf8"), title: board?.title ?? requested, w: board?.w ?? 600, shared, deckImports });
	res.type("html").send(versionLibRefs(page, libVersion(app.deck.path)));
	return true;
}
