import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheControlFor, compressedStatic } from "./static.ts";
import { appRequest } from "./apps/route.ts";
import { forwardRequest } from "./ports.ts";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { MAX_UPLOAD_BYTES } from "@decks/protocol";
import { NotFound, PathRefused } from "./deck/roots.ts";
import { UploadRefused } from "./files/upload.ts";
import { verbRoutes } from "./verbs/router.ts";
import type { App } from "./app.ts";
import { guard } from "./auth/guard.ts";
import { extraHosts, hostAllowed, hostRefusal } from "./auth/hosts.ts";
import { doorRoutes, isTopNavigation, tabToken, withSession } from "./auth/issue.ts";
import { actsAsPerson } from "./auth/principal.ts";
import { Relay } from "./share/relay.ts";
import { asyncRoute } from "./routes/shared.ts";
import { register as registerAgents } from "./routes/agents.ts";
import { register as registerApps } from "./routes/apps.ts";
import { register as registerBoardPath } from "./routes/board-path.ts";
import { register as registerDeck } from "./routes/deck.ts";
import { register as registerFiles } from "./routes/files.ts";
import { register as registerGoogle } from "./routes/google.ts";
import { register as registerHarness } from "./routes/harness.ts";
import { register as registerPictures } from "./routes/pictures.ts";

/**
 * The HTTP surface: reading files, writing one kind of file, and the built UI.
 *
 * Almost everything that *changes* something goes over the WebSocket, because the
 * socket is where state lives — but bytes are not state. A file the user drags in
 * from the desktop has to arrive as a body on a request (`POST /api/upload`), so
 * this file does have one mutating route, and it is the only way anything in Decks
 * writes a file the user did not name.
 *
 * The routes that turn a URL into a file, plus that one, are the security boundary
 * of the whole app. Every one of them asks `deck/roots.ts` where the path may go
 * and nothing else makes that decision. The upload route adds its own guards, all
 * in `files/upload.ts`: a size cap refused before the body is buffered, a name
 * derived rather than trusted, a refusal to overwrite, and one `Sec-Fetch-Site`
 * check so it is not the easiest way in.
 *
 * Who may ask for any of it is decided once, before every route, by the gate (`auth/guard.ts`): a
 * request carries a token, and the token's principal is who is calling.
 */
export function createHttpApp(app: App): Express {
	const server = express();
	server.disable("x-powered-by");
	/*
	 * Before anything else, the name the request was addressed to (`share/hosts.ts`): a page that
	 * pointed its own name at this server (DNS rebinding) is refused here, ahead of the forwarded
	 * ports and apps that would otherwise answer it as one of their own.
	 */
	const hosts = extraHosts(process.env, app.config.host);
	server.use((req, res, next) => {
		if (hostAllowed(req.headers.host, hosts)) return next();
		res.status(403).type("text").send(hostRefusal(req.headers.host));
	});
	/*
	 * Forwarded ports first (`ports.ts`), before any body is read: the request is somebody
	 * else's server's, and a JSON parser here would eat the body it is waiting for.
	 */
	server.use((req, res, next) => {
		if (!forwardRequest(req, res, app.forwards)) next();
	});
	// A tab another site opens an app in: an app pass for that app (`auth/passes.ts`).
	const ticketed = (pass: string | undefined, name: string) => {
		const opened = app.passes.openApp(pass);
		return opened?.holder === "tab" && opened.app === name;
	};
	// A token that is the person's or a paired site's, from the page it came with (`auth/tokens.ts`).
	const paired = (token: string | undefined, origin?: string) => {
		const seen = app.tokens.verify(token, { origin });
		return seen.ok && actsAsPerson(seen.principal);
	};
	// An app inside a canvas frame: an app pass held by a canvas the app is placed on, in the path (`auth/passes.ts`).
	const carried = (pass: string, name: string) => {
		const opened = app.passes.openApp(pass);
		return opened?.holder === "canvas" && opened.app === name;
	};
	// The deck's apps (`apps/route.ts`), for the same reason: a server app's request is the app's.
	server.use((req, res, next) => {
		if (!appRequest(req, res, app.apps, paired, ticketed, carried)) next();
	});

	/*
	 * The gate (`auth/guard.ts`): every request from here on carries a token, and who is calling is
	 * that token's principal, on `req.principal`. Before any body is read: a request refused is not read.
	 */
	server.use(guard(app));
	// Bodies after the gate.
	server.use(express.json({ limit: "8mb" }));

	const api = express.Router();
	// Every verb in the table, for the SDK's three forms (`verbs/router.ts`).
	api.use("/v1", verbRoutes(app));
	// The doors, where tokens are handed out (`auth/issue.ts`).
	api.use(doorRoutes(app));
	const relay = new Relay(join(app.deck.path, ".decks", "relay.json"));
	server.all("/c/:id/*rest", asyncRoute((req, res) => relay.pass(req, res)));

	/*
	 * The routes, by what they serve (`routes/`), registered in the order they always were: no two of
	 * them match the same request, and every one is behind the gate above.
	 */
	const deps = { app, relay };
	registerAgents(api, deps);
	registerHarness(api, deps);
	registerDeck(api, deps);
	registerBoardPath(api, deps);
	registerPictures(api, deps);
	registerFiles(api, deps);
	registerGoogle(api, deps);
	registerApps(api, deps);

	server.use("/api", api);

	// The built UI, when there is one. In development Vite serves it instead and
	// proxies here, so a missing dist is normal rather than an error.
	const webDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
	/**
	 * The Decks page itself, with a fresh person token in it for a tab the person opened
	 * (`auth/issue.ts`): a frame or a script's fetch of the same page gets it without. Never stored, so
	 * a later fetch cannot be answered from a cache with the token in it; and alone in its browsing
	 * context group (`Cross-Origin-Opener-Policy`), so a page that opened it in a new window cannot
	 * reach into it.
	 */
	const shell = async (req: Request, res: Response) => {
		const html = await readFile(join(webDist, "index.html"), "utf8");
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
		res.setHeader("Vary", "Sec-Fetch-Dest, Sec-Fetch-Mode");
		res.type("html").send(isTopNavigation(req.headers) ? withSession(html, tabToken(app.tokens)) : html);
	};
	if (existsSync(webDist)) {
		server.get(["/", "/index.html"], (req, res, next) => void shell(req, res).catch(next));
		// Compressed and cached by name first (`static.ts`); anything it passes on is sent plain,
		// with the same cache rule.
		/*
		 * The app's own scripts, styles, fonts and engine are public, and the canvas frame loads them from a
		 * sandboxed page with no origin: a module script, a font and a fetched `.wasm` are read only with
		 * CORS, so they say anyone may. The Decks page itself (`/`) is not among them.
		 */
		server.use((req, res, next) => {
			if ((req.method === "GET" || req.method === "HEAD") && !req.path.startsWith("/api/") && req.path !== "/" && req.path !== "/index.html") res.setHeader("Access-Control-Allow-Origin", "*");
			next();
		});
		server.use(compressedStatic(webDist));
		server.use(
			express.static(webDist, {
				setHeaders: (res, file) => res.setHeader("Cache-Control", cacheControlFor(file.slice(webDist.length).split(sep).join("/"))),
			}),
		);
		server.get("*any", (req, res, next) => void shell(req, res).catch(next));
	}

	// One error handler, because a refusal should read the same wherever it came
	// from: 403 for a path we would not serve, 404 for one that is not there.
	server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
		if (error instanceof NotFound) {
			res.status(404).type("text/plain").send(error.message);
			return;
		}
		if (error instanceof PathRefused) {
			res.status(403).type("text/plain").send(error.message);
			return;
		}
		if (error instanceof UploadRefused) {
			res.status(error.status).type("text/plain").send(error.message);
			return;
		}
		// Body-parser's own refusal. Mapped rather than left to fall through, because a
		// file over the cap is a 413 the browser can explain, not a 500 that reads as a
		// crash.
		if ((error as { type?: string }).type === "entity.too.large") {
			res.status(413).type("text/plain").send(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`);
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		// A file half sent when the page went away (a frame closed, a picture no longer wanted): nothing to answer.
		if (res.headersSent || /EPIPE|ECONNRESET|aborted/i.test(message)) {
			res.end();
			return;
		}
		const code = /ENOENT/.test(message) ? 404 : 500;
		if (code === 500) console.error("[decks]", error);
		res.status(code).type("text/plain").send(message);
	});

	return server;
}

