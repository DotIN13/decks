import { readFile } from "node:fs/promises";
import type { Response } from "express";
import { isBoardPath, sendFile, withGuest } from "./shared.ts";

/**
 * Anything else under `/api/card/*path` (`board-path.ts`): a file of the deck, already given the
 * asset's headers. Last in the route, so it always answers.
 */
export async function assetAnswer(asked: string, requested: string, target: string, guest: boolean, res: Response): Promise<void> {
	/*
	 * `?guest=1` is a board that is this web page (`data-bare`, an old file board) asking for it
	 * with `lib/embed-guest.js` in it: the page then takes the scrolls it can use and hands the
	 * rest, and every pinch, to the canvas, as a board's own page does, with no click first.
	 * Still the asset's headers, so still sandboxed; the script is ours and reads nothing back.
	 */
	if (guest && !isBoardPath(requested) && /\.html?$/i.test(requested)) {
		res.type("html").send(withGuest(await readFile(target, "utf8"), `${"../".repeat(asked.split("/").length - 1)}lib/embed-guest.js`));
		return;
	}
	await sendFile(res, target);
}
