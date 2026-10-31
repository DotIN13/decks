import { readFile } from "node:fs/promises";
import type { Response } from "express";
import type { Page } from "@decks/protocol";
import { renderShell } from "../boards/shell.ts";
import { canvasOfPath, isSharedCanvas } from "../deck/layout.ts";
import { libVersion, versionLibRefs } from "../deck/lib-version.ts";
import { isBoardPath, withGuest, withScript } from "./shared.ts";
import type { App } from "../app.ts";

/**
 * An old board's page under `/api/card/*path` (`board-path.ts`): rendered into a shell, or served
 * with its runtime at the versioned address and the guest bridge put in. Kept for the boards a
 * deck still has until they are gone. Returns true when it answered the request.
 */
export async function boardPageAnswer(app: App, asked: string, requested: string, target: string, board: Page | undefined, raw: boolean, res: Response): Promise<boolean> {
	// A board that has to be rendered *into* a document: a `.md`, or a page
	// from somewhere else (`deck/kinds.ts`).
	if (board?.shell) {
		res.type("html").send(
			versionLibRefs(renderShell({
				path: board.path,
				shell: board.shell,
				title: board.title,
				w: board.w,
				h: board.h,
			}), libVersion(app.deck.path)),
		);
		return true;
	}
	// A board's page, with its runtime at the versioned address; the file itself is untouched,
	// and `?raw=1` (its text, for the editor) is the file as it is.
	if (!raw && isBoardPath(requested) && /\.html?$/i.test(requested)) {
		let page = versionLibRefs(await readFile(target, "utf8"), libVersion(app.deck.path));
		// A friend's board has no storage of its own: the shim keeps it in the page around (`lib/storage-shim.js`).
		const shared = canvasOfPath(asked);
		if (shared && isSharedCanvas(shared.name)) page = withScript(page, `${"../".repeat(shared.rest.split("/").length - 1)}lib/storage-shim.js`);
		/*
		 * The canvas's bridge beside the board's own `board.js`: the editor hands a board's page the
		 * pointer only once it has said it is a guest (`plain-board.tsx`), as Studio's pages do, so
		 * without it no board here could be used, only selected.
		 */
		const own = /<script[^>]*\ssrc="([^"]*?)board\.js"/i.exec(page);
		if (own) page = withGuest(page, `${own[1]}embed-guest.js`);
		res.type("html").send(page);
		return true;
	}
	return false;
}
