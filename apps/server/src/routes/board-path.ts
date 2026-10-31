import { existsSync, statSync } from "node:fs";
import type { Router } from "express";
import { unstampCard } from "@decks/card-host";
import { LIB_FOREVER, libVersion, splitLibVersion } from "../deck/lib-version.ts";
import { normalizeBoardPath } from "../deck/schema.ts";
import { NotFound, PathRefused, resolveServed } from "../deck/roots.ts";
import { canvasOfPath, isSharedCanvas, servedAs } from "../deck/layout.ts";
import { assetHeaders, boardHeaders } from "../files/serve.ts";
import { assetAnswer } from "./assets.ts";
import { boardPageAnswer } from "./board-pages.ts";
import { cardModuleAnswer, cardPageAnswer } from "./cards.ts";
import { asyncRoute, isBoardPath, sharedHeaders, wildcard, type RouteDeps } from "./shared.ts";

/**
 * `/api/card/*path`, and `/api/board/*path`, its old name, kept until 2026-11-30: the deck's files at
 * the address a card, a board or an asset is read from. The
 * request is matched in one order: a card's script (`cards.ts`), the file resolved and given its
 * headers, a card's page (`cards.ts`), an old board's page (`board-pages.ts`), and the file itself
 * (`assets.ts`).
 */
export function register(api: Router, { app }: RouteDeps): void {
	/**
	 * A board, for the frame it renders in — same origin, no sandbox (§4).
	 *
	 * Path-shaped rather than a query parameter so a board's own relative
	 * references resolve: `../lib/board.css` beside a board asks for the sibling
	 * URL and lands back here, on the same guard.
	 */
	api.get(
		["/card/*path", "/board/*path"],
		asyncRoute(async (req, res) => {
			// A card's folder at a version (`cards/sales@<rev>/`, `@decks/card-host`) is the folder.
			const asked = unstampCard(wildcard(req));
			// A canvas's `lib/`, and the deck's `assets/`, `docs/` and `apps/` beside its boards (`deck/layout.ts`).
			const served = servedAs(asked);
			if ("refused" in served) throw new PathRefused(asked, served.refused);
			let requested = served.path;
			if (await cardModuleAnswer(app, asked, requested, res)) return;
			// The runtime at a versioned address (`deck/lib-version.ts`): the file is the one in `lib/`.
			const versioned = requested.startsWith("lib/") ? splitLibVersion(requested.slice(4)) : undefined;
			if (versioned) requested = `lib/${versioned.file}`;
			const target = resolveServed(app.deck.path, requested);
			if (!existsSync(target) || !statSync(target).isFile()) throw new NotFound(requested);
			// A friend's canvas: every page and file of it sandboxed, whatever frame it is in.
			if (isSharedCanvas(canvasOfPath(asked)?.name ?? "")) sharedHeaders(res);
			/*
			 * This route serves the whole deck, not only its boards — a board's own
			 * `../assets/photo.png` and `../lib/board.css` resolve to sibling URLs and
			 * land here. A *board* is what gets the app's origin (§4); everything else
			 * gets the asset treatment, which sandboxes anything a browser would run.
			 * That distinction started mattering the day the user could drop an HTML
			 * file onto a board and have it stored in `assets/`.
			 */
			if (isBoardPath(requested)) boardHeaders(res);
			else assetHeaders(res, target);
			if (versioned?.version === libVersion(app.deck.path)) res.setHeader("Cache-Control", LIB_FOREVER);

			/*
			 * A board that is not a document gets one made for it.
			 *
			 * Two kinds of file need that, and `board.shell` names which: a `.md` is content
			 * rather than a document, and an HTML page from somewhere else has to be wrapped
			 * so it can be put in a *sandboxed* frame. Everything this app writes — a
			 * component board, a flow board, an HTML deck — is already a document and falls
			 * straight through to the file.
			 *
			 * The board record is what decides, because it already knows the format, the size
			 * and the title; re-deriving them here would be a second opinion that can differ
			 * from the one the canvas laid the board out with.
			 *
			 * Anything the deck knows nothing about — an asset, `lib/board.css` — falls
			 * through as well, which is what every non-board request is.
			 */
			/*
			 * `?raw=1` is the shell asking for the file it wraps.
			 *
			 * Without it the shell — which is served at this very URL — would be what its
			 * own embed fetched, and the board would render empty with nothing in any log to
			 * say why. One query parameter rather than a second route, so the reference in
			 * the shell stays *relative* and a nested board resolves its own sibling.
			 */
			const board = req.query.raw === undefined ? app.deck.board(normalizeBoardPath(requested)) : undefined;
			const raw = req.query.raw !== undefined;
			if (await cardPageAnswer(app, asked, requested, target, board, raw, res)) return;
			if (await boardPageAnswer(app, asked, requested, target, board, raw, res)) return;
			await assetAnswer(asked, requested, target, req.query.guest !== undefined, res);
		}),
	);
}
