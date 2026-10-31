import { existsSync, statSync } from "node:fs";
import type { Router } from "express";
import { unstampCard } from "@decks/card-host";
import { LIB_FOREVER, libVersion, splitLibVersion } from "../deck/lib-version.ts";
import { normalizeBoardPath } from "../deck/schema.ts";
import { NotFound, PathRefused, resolveServed } from "../deck/roots.ts";
import { canvasOfPath, isCardPath, isSharedCanvas, servedAs } from "../deck/layout.ts";
import { assetHeaders, boardHeaders } from "../files/serve.ts";
import { assetAnswer } from "./assets.ts";
import { cardModuleAnswer, cardPageAnswer } from "./cards.ts";
import { asyncRoute, isBoardPath, sharedHeaders, wildcard, type RouteDeps } from "./shared.ts";

/**
 * `/api/card/*path`: the deck's files at the address a card or an asset is read from. The request is
 * matched in one order: a card's script (`cards.ts`), the file resolved and given its headers, a
 * card's page (`cards.ts`), and the file itself (`assets.ts`).
 *
 * Path-shaped rather than a query parameter so a card's own relative references resolve:
 * `../lib/card.css` beside it asks for the sibling URL and lands back here, on the same guard.
 */
export function register(api: Router, { app }: RouteDeps): void {
	api.get(
		"/card/*path",
		asyncRoute(async (req, res) => {
			// A card's folder at a version (`cards/sales@<rev>/`, `@decks/card-host`) is the folder.
			const asked = unstampCard(wildcard(req));
			// A canvas's `lib/`, and the deck's `assets/`, `docs/` and `apps/` beside its cards (`deck/layout.ts`).
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
			 * A card's page is ours and keeps the app's origin. An old board's page (a library board, one
			 * a picture card links to, a friend's) is a plain file now, sent as it is with the card sandbox
			 * (`CARD_SANDBOX`): its scripts run in a blank origin and reach nothing of the harness's, and
			 * its `../lib/board.css|js` land on card.css and card.js (`libName`). Anything else is an
			 * asset, which sandboxes whatever a browser would run.
			 */
			if (isCardPath(requested)) boardHeaders(res);
			else if (isBoardPath(requested)) {
				boardHeaders(res);
				sharedHeaders(res);
			} else assetHeaders(res, target);
			if (versioned?.version === libVersion(app.deck.path)) res.setHeader("Cache-Control", LIB_FOREVER);
			// `?raw=1` is the card's file as it is, for the editor; without it a card is its page.
			const raw = req.query.raw !== undefined;
			const card = raw ? undefined : app.deck.board(normalizeBoardPath(requested));
			if (await cardPageAnswer(app, asked, requested, target, card, raw, res)) return;
			await assetAnswer(asked, requested, target, req.query.guest !== undefined, res);
		}),
	);
}
