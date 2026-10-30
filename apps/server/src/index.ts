import { socketPrincipal } from "./auth/guard.ts";
import { actsAsPerson } from "./auth/principal.ts";
import { extraHosts, hostAllowed } from "./auth/hosts.ts";
import { writeCliToken, type CliToken } from "./auth/cli-token.ts";
import { createServer } from "node:http";
import { appUpgrade } from "./apps/route.ts";
import { forwardUpgrade } from "./ports.ts";
import { App } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createHttpApp } from "./http.ts";
import { installDir } from "@decks/runtime";
import { Hub } from "./ws.ts";
import { startStudio } from "./studio/index.ts";
import { DryRun } from "./migrations/index.ts";

const config = loadConfig();

// The agent's tools inherit this process's environment, and a script the agent
// writes runs with the deck as its cwd — from where Decks' own `node_modules` is
// not reachable. `??=` so an explicit value still wins.
process.env.DECKS_APP_DIR ??= installDir();

let app: App;
try {
	app = App.open(config);
} catch (error) {
	// A dry run of the migrations (`DECKS_MIGRATE_DRY_RUN=1`): every move printed, nothing changed, and no harness.
	if (error instanceof DryRun) {
		for (const line of error.lines) console.log(line);
		console.log("[decks] dry run: nothing was changed; start again without DECKS_MIGRATE_DRY_RUN to migrate.");
		process.exit(0);
	}
	console.error(`[decks] cannot open ${config.dataDir}: ${(error as Error).message}`);
	process.exit(1);
}

const httpServer = createServer(createHttpApp(app));
const hub = new Hub(
	httpServer,
	(message, reply, view) => app.handle(message, reply, view),
	(reply, view) => app.greet(reply, view),
);
app.attach(hub);

// Decks Studio: syncs the deck in the background once this harness has a key (`studio/index.ts`).
// Its app list goes to Studio too, so Studio can list the apps beside the canvases.
// It asks this harness for canvas pictures as the person, with a token of its own that it renews when it runs out.
let syncToken: string | undefined;
const studioToken = () => {
	if (!syncToken || !app.tokens.verify(syncToken).ok) syncToken = app.tokens.issue({ kind: "person" }, { label: "Studio sync" }).token;
	return syncToken;
};
const studio = startStudio(app.deck.path, process.env, `http://127.0.0.1:${config.port}`, () => app.apps.list(), studioToken);

/*
 * One upgrade listener, two websockets.
 *
 * `/ws` is the browser; `/api/web/relay` is the Decks extension in the user's own Chrome,
 * dialling in with its pairing code (`browser/bridge.ts`); `/node/…` and `/rnode/…` are a
 * forwarded port's own websockets (`ports.ts`). Anything else is not a websocket this
 * server has, and is dropped rather than left hanging.
 */
const hosts = extraHosts(process.env, config.host);
httpServer.on("upgrade", (request, socket, head) => {
	// A socket addressed to a name that is not this server's is a rebinding page, as for requests (`auth/hosts.ts`).
	if (!hostAllowed(request.headers.host, hosts)) {
		socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		socket.destroy();
		return;
	}
	const path = new URL(request.url ?? "/", "http://decks").pathname;
	if (path === "/ws") {
		/*
		 * The socket runs the person's commands, so it is opened only with the person's token or a
		 * paired site's, in its address (`decks_token`): from this machine as from anywhere (`auth/guard.ts`).
		 */
		if (!socketPrincipal(app, request)) {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		hub.handleUpgrade(request, socket, head);
	}
	else if (path === "/api/web/relay") app.web.handleUpgrade(request, socket, head);
	else if (
		appUpgrade(request, socket, head, app.apps, (token, origin) => {
			const seen = app.tokens.verify(token, { origin });
			return seen.ok && actsAsPerson(seen.principal);
		})
	)
		return;
	else if (!forwardUpgrade(request, socket, head, app.forwards)) socket.destroy();
});

httpServer.on("error", (error) => {
	console.error(`[decks] cannot listen on ${config.host}:${config.port}: ${(error as Error).message}`);
	process.exit(1);
});

// `decks login` with no code, on this machine (`auth/cli-token.ts`): a token for this start, taken back at stop.
let cliToken: CliToken | undefined;
httpServer.listen(config.port, config.host, () => {
	console.log(`[decks] ${app.deck.name} — http://${config.host}:${config.port}`);
	console.log(`[decks] data: ${config.dataDir}`);
	const local = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host.includes(":") ? `[${config.host}]` : config.host;
	try {
		cliToken = writeCliToken(app.tokens, config.dataDir, `http://${local}:${config.port}`);
		app.cliTokenId = cliToken.id;
	} catch (error) {
		console.warn(`[decks] could not write the token for decks login: ${(error as Error).message}`);
	}
});

const shutdown = () => {
	cliToken?.stop();
	app.cliTokenId = undefined;
	void studio.stop();
	app.dispose();
	hub.close();
	httpServer.close(() => process.exit(0));
	// A socket that will not close must not hold the process open forever.
	setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
